package services

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Cliente de la Plataforma de Confirmación del RHE y de la FE de SUNAT (api-cpe). Fuente: "Manual de servicios web
// — Plataforma de confirmación del RHE y de la FE" (cpe.sunat.gob.pe). Es de solo lectura y usa las mismas
// credenciales de API (Client ID/Secret + usuario/clave SOL) que el SIRE, con el alcance https://api-cpe.sunat.gob.pe.
//
// Importante: NO es un registro completo de recibos por honorarios. Solo devuelve los comprobantes que están en la
// plataforma de confirmación: en compras Pendiente (01), Subsanado (03) y Pendiente por reinicio (06); en ventas
// Disconforme (02). Cada consulta admite como máximo 15 días entre fechas, por eso se trocea el rango pedido.

const (
	cpeScope             = "https://api-cpe.sunat.gob.pe"
	cpeAPIBase           = "https://api-cpe.sunat.gob.pe"
	cpeComprobantesPath  = "/v1/contribuyente/controlcpe/comprobantesext"
	rheAccessTarget      = "rhe"
	rheWindowDays        = 15  // máximo permitido por SUNAT entre fecInicio y fecFin
	rhePageSize          = 100 // SUNAT solo permite 50 o 100
	rheMaxRangeDays      = 190 // tope del rango pedido por consulta (≈ 13 ventanas × estados)
	rheMaxItems          = 5000
	rheMaxPagesPerWindow = 60
	rheWorkers           = 3

	RheTipoCompras = "C"
	RheTipoVentas  = "V"
)

// RheEstados nombres de los estados de la plataforma de confirmación.
var RheEstados = map[string]string{
	"01": "Pendiente",
	"02": "Disconforme",
	"03": "Subsanado",
	"06": "Pendiente por reinicio",
}

// RheMotivos motivos de disconformidad (anexos del manual).
var RheMotivos = map[string]string{
	"1": "Plazo de pago acordado",
	"2": "Monto neto pendiente de pago",
	"3": "Reclamo respecto de bienes adquiridos o servicios prestados",
}

// rheEstadosPorTipo estados consultables según el tipo de pedido.
func rheEstadosPorTipo(tipo string) []string {
	if tipo == RheTipoVentas {
		return []string{"02"}
	}
	return []string{"01", "03", "06"}
}

// flexStr y flexNum aceptan que SUNAT mande el dato como texto o como número.
type flexStr string

func (f *flexStr) UnmarshalJSON(b []byte) error {
	t := strings.TrimSpace(string(b))
	if t == "null" || t == "" {
		*f = ""
		return nil
	}
	if strings.HasPrefix(t, `"`) {
		var s string
		if err := json.Unmarshal(b, &s); err != nil {
			return err
		}
		*f = flexStr(strings.TrimSpace(s))
		return nil
	}
	*f = flexStr(t)
	return nil
}

type flexNum float64

func (f *flexNum) UnmarshalJSON(b []byte) error {
	t := strings.Trim(strings.TrimSpace(string(b)), `"`)
	if t == "null" || t == "" {
		*f = 0
		return nil
	}
	n, err := strconv.ParseFloat(t, 64)
	if err != nil {
		*f = 0
		return nil
	}
	*f = flexNum(n)
	return nil
}

// RheCuota cuota de pago del comprobante.
type RheCuota struct {
	Numero      string  `json:"numero"`
	Monto       float64 `json:"monto"`
	Vencimiento string  `json:"vencimiento"`
}

// RheNota comprobante que subsana una disconformidad.
type RheNota struct {
	CodCpe     string   `json:"cod_cpe"`
	Serie      string   `json:"serie"`
	Numero     string   `json:"numero"`
	Motivos    []string `json:"motivos"`
	Comentario string   `json:"comentario"`
}

// RheComprobante un comprobante (RHE o factura) de la plataforma de confirmación, ya normalizado.
type RheComprobante struct {
	Estado            string     `json:"estado"`
	EstadoDesc        string     `json:"estado_desc"`
	RucEmisor         string     `json:"ruc_emisor"`
	CodCpe            string     `json:"cod_cpe"`
	Serie             string     `json:"serie"`
	Numero            string     `json:"numero"`
	FecEmision        string     `json:"fec_emision"`
	FecPuestaDisp     string     `json:"fec_puesta_disposicion"`
	FecPlazoPago      string     `json:"fec_plazo_pago"`
	Moneda            string     `json:"moneda"`
	MontoPendiente    float64    `json:"monto_pendiente"`
	ImporteFactura    float64    `json:"importe_factura"`
	TotalHonorarios   float64    `json:"total_honorarios"`
	Retencion         float64    `json:"retencion"`
	NetoRecibido      float64    `json:"neto_recibido"`
	Cuotas            []RheCuota `json:"cuotas,omitempty"`
	FecDisconformidad string     `json:"fec_disconformidad,omitempty"`
	MotivosDisconf    []string   `json:"motivos_disconformidad,omitempty"`
	SustentoDisconf   string     `json:"sustento_disconformidad,omitempty"`
	FecSubsanacion    string     `json:"fec_subsanacion,omitempty"`
	NotasSubsanacion  []RheNota  `json:"notas_subsanacion,omitempty"`
}

// rawCpe respuesta de SUNAT (cada estado trae campos distintos).
type rawCpePage struct {
	NumTotalReg  flexNum `json:"numTotalReg"`
	NumPag       flexNum `json:"numPag"`
	Comprobantes []struct {
		NumRuc                  flexStr `json:"numRuc"`
		CodCpe                  flexStr `json:"codCpe"`
		NumSerie                flexStr `json:"numSerie"`
		NumCpe                  flexStr `json:"numCpe"`
		FecEmision              flexStr `json:"fecEmision"`
		FecPuestaDisposicion    flexStr `json:"fecPuestaDisposicion"`
		FecPlazoPago            flexStr `json:"fecPlazoPago"`
		MtoPagoPendiente        flexNum `json:"mtoPagoPendiente"`
		CodMoneda               flexStr `json:"codMoneda"`
		MtoImporteTotalFactura  flexNum `json:"mtoImporteTotalFactura"`
		MtoTotalRhe             flexNum `json:"mtoTotalRhe"`
		MtoRetencionRhe         flexNum `json:"mtoRetencionRhe"`
		MtoTotalNetoRecibidoRhe flexNum `json:"mtoTotalNetoRecibidoRhe"`
		Cuotas                  []struct {
			NumCuota            flexStr `json:"numCuota"`
			MtoCuota            flexNum `json:"mtoCuota"`
			FecVencimientoCuota flexStr `json:"fecVencimientoCuota"`
		} `json:"cuotas"`
		Disconformidad *struct {
			FecDisconformidad flexStr   `json:"fecDisconformidad"`
			Motivos           []flexStr `json:"motivos"`
			Sustento          flexStr   `json:"sustento"`
		} `json:"disconformidad"`
		Subsanacion *struct {
			FecSubsanacion flexStr `json:"fecSubsanacion"`
			NotasCpe       []struct {
				CodCpe     flexStr   `json:"codCpe"`
				NumSerie   flexStr   `json:"numSerie"`
				NumCpe     flexStr   `json:"numCpe"`
				Motivos    []flexStr `json:"motivos"`
				Comentario flexStr   `json:"comentario"`
			} `json:"notasCpe"`
		} `json:"subsanacion"`
	} `json:"comprobantes"`
}

func flexStrings(in []flexStr) []string {
	out := make([]string, 0, len(in))
	for _, v := range in {
		out = append(out, string(v))
	}
	return out
}

// RheQuery filtros de la consulta.
type RheQuery struct {
	Tipo    string   // C (compras: soy el adquirente) o V (ventas: soy el emisor)
	CodCpe  string   // 02 recibo por honorarios (por defecto) o 01 factura
	Desde   string   // AAAA-MM-DD (fecha de emisión)
	Hasta   string   // AAAA-MM-DD
	Estados []string // opcional: subconjunto de los estados permitidos para el tipo
}

// RheResult resultado agregado de todas las ventanas y estados consultados.
type RheResult struct {
	Items     []RheComprobante `json:"items"`
	Total     int              `json:"total"`
	Consultas int              `json:"consultas"`
	Desde     string           `json:"desde"`
	Hasta     string           `json:"hasta"`
	Truncado  bool             `json:"truncado"`
	Estados   []string         `json:"estados"`
}

func rheParseDay(s string) (time.Time, bool) {
	t, err := time.Parse("2006-01-02", strings.TrimSpace(s))
	return t, err == nil
}

// normalize valida y completa los filtros.
func (q RheQuery) normalize() (RheQuery, time.Time, time.Time, error) {
	q.Tipo = strings.ToUpper(strings.TrimSpace(q.Tipo))
	if q.Tipo == "" {
		q.Tipo = RheTipoCompras
	}
	if q.Tipo != RheTipoCompras && q.Tipo != RheTipoVentas {
		return q, time.Time{}, time.Time{}, sireErr(SireErrInvalidParams, "Tipo no válido: use compras (C) o ventas (V).", q.Tipo)
	}
	q.CodCpe = strings.TrimSpace(q.CodCpe)
	if q.CodCpe == "" {
		q.CodCpe = "02"
	}
	if q.CodCpe != "01" && q.CodCpe != "02" {
		return q, time.Time{}, time.Time{}, sireErr(SireErrInvalidParams, "Tipo de comprobante no válido: solo 01 (factura) o 02 (recibo por honorarios).", q.CodCpe)
	}
	d, ok1 := rheParseDay(q.Desde)
	h, ok2 := rheParseDay(q.Hasta)
	if !ok1 || !ok2 {
		return q, d, h, sireErr(SireErrInvalidParams, "Use fechas válidas con el formato AAAA-MM-DD.", q.Desde+" – "+q.Hasta)
	}
	if h.Before(d) {
		return q, d, h, sireErr(SireErrInvalidParams, "La fecha «desde» no puede ser mayor que «hasta».", "")
	}
	if int(h.Sub(d).Hours()/24) > rheMaxRangeDays {
		return q, d, h, sireErr(SireErrInvalidParams, fmt.Sprintf("El rango máximo por consulta es de %d días.", rheMaxRangeDays), "")
	}
	allowed := rheEstadosPorTipo(q.Tipo)
	if len(q.Estados) == 0 {
		q.Estados = allowed
	} else {
		var keep []string
		for _, e := range q.Estados {
			e = strings.TrimSpace(e)
			if containsStr(allowed, e) && !containsStr(keep, e) {
				keep = append(keep, e)
			}
		}
		if len(keep) == 0 {
			return q, d, h, sireErr(SireErrInvalidParams, "Ningún estado válido para este tipo de consulta.", strings.Join(q.Estados, ","))
		}
		q.Estados = keep
	}
	return q, d, h, nil
}

type rheJob struct {
	start, end time.Time
	estado     string
}

// List consulta todas las ventanas de 15 días y estados del rango y devuelve los comprobantes unificados.
func (ss *SireSession) RheList(q RheQuery) (*RheResult, error) {
	q, desde, hasta, err := q.normalize()
	if err != nil {
		return nil, err
	}
	var jobs []rheJob
	for s := desde; !s.After(hasta); s = s.AddDate(0, 0, rheWindowDays) {
		e := s.AddDate(0, 0, rheWindowDays-1)
		if e.After(hasta) {
			e = hasta
		}
		for _, st := range q.Estados {
			jobs = append(jobs, rheJob{start: s, end: e, estado: st})
		}
	}

	var (
		mu       sync.Mutex
		firstErr error
		items    []RheComprobante
		truncado bool
		wg       sync.WaitGroup
	)
	queue := make(chan rheJob)
	// Se pide un token antes de abrir los workers para no pedir varios a la vez si no hay uno en caché.
	if _, terr := ss.tokenFor(cpeScope); terr != nil {
		return nil, terr
	}
	for i := 0; i < rheWorkers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := range queue {
				mu.Lock()
				stop := firstErr != nil || truncado
				mu.Unlock()
				if stop {
					continue
				}
				got, jerr := ss.rheFetchWindow(q, j)
				mu.Lock()
				if jerr != nil {
					if firstErr == nil {
						firstErr = jerr
					}
				} else {
					items = append(items, got...)
					if len(items) > rheMaxItems {
						items = items[:rheMaxItems]
						truncado = true
					}
				}
				mu.Unlock()
			}
		}()
	}
	for _, j := range jobs {
		queue <- j
	}
	close(queue)
	wg.Wait()
	if firstErr != nil {
		return nil, firstErr
	}

	seen := map[string]bool{}
	uniq := items[:0]
	for _, it := range items {
		k := it.Estado + "|" + it.RucEmisor + "|" + it.CodCpe + "|" + it.Serie + "|" + it.Numero
		if !seen[k] {
			seen[k] = true
			uniq = append(uniq, it)
		}
	}
	sort.SliceStable(uniq, func(a, b int) bool { return uniq[a].FecEmision > uniq[b].FecEmision })
	return &RheResult{Items: uniq, Total: len(uniq), Consultas: len(jobs), Desde: q.Desde, Hasta: q.Hasta, Truncado: truncado, Estados: q.Estados}, nil
}

// rheFetchWindow baja todas las páginas de una ventana/estado.
func (ss *SireSession) rheFetchWindow(q RheQuery, j rheJob) ([]RheComprobante, error) {
	var out []RheComprobante
	for page := 1; page <= rheMaxPagesPerWindow; page++ {
		qs := url.Values{
			"codCpe":        {q.CodCpe},
			"fecInicio":     {j.start.Format("2006-01-02")},
			"fecFin":        {j.end.Format("2006-01-02")},
			"indTipoPedido": {q.Tipo},
			"codEstado":     {j.estado},
			"numPag":        {strconv.Itoa(page)},
			"numRegPag":     {strconv.Itoa(rhePageSize)},
		}
		r, err := ss.doCall(cpeScope, ss.svc.cpeBase+cpeComprobantesPath, http.MethodGet, qs)
		if err != nil {
			return nil, err
		}
		var pg rawCpePage
		if err := json.Unmarshal(r.Body, &pg); err != nil {
			return nil, sireErr(SireErrUnexpected, "SUNAT no devolvió un JSON válido.", fmt.Sprintf("%d bytes, %s", len(r.Body), r.ContentType))
		}
		for _, c := range pg.Comprobantes {
			it := RheComprobante{
				Estado: j.estado, EstadoDesc: RheEstados[j.estado],
				RucEmisor: string(c.NumRuc), CodCpe: string(c.CodCpe), Serie: string(c.NumSerie), Numero: string(c.NumCpe),
				FecEmision: string(c.FecEmision), FecPuestaDisp: string(c.FecPuestaDisposicion), FecPlazoPago: string(c.FecPlazoPago),
				Moneda: string(c.CodMoneda), MontoPendiente: float64(c.MtoPagoPendiente), ImporteFactura: float64(c.MtoImporteTotalFactura),
				TotalHonorarios: float64(c.MtoTotalRhe), Retencion: float64(c.MtoRetencionRhe), NetoRecibido: float64(c.MtoTotalNetoRecibidoRhe),
			}
			for _, cu := range c.Cuotas {
				it.Cuotas = append(it.Cuotas, RheCuota{Numero: string(cu.NumCuota), Monto: float64(cu.MtoCuota), Vencimiento: string(cu.FecVencimientoCuota)})
			}
			if d := c.Disconformidad; d != nil {
				it.FecDisconformidad, it.MotivosDisconf, it.SustentoDisconf = string(d.FecDisconformidad), flexStrings(d.Motivos), string(d.Sustento)
			}
			if s := c.Subsanacion; s != nil {
				it.FecSubsanacion = string(s.FecSubsanacion)
				for _, n := range s.NotasCpe {
					it.NotasSubsanacion = append(it.NotasSubsanacion, RheNota{
						CodCpe: string(n.CodCpe), Serie: string(n.NumSerie), Numero: string(n.NumCpe), Motivos: flexStrings(n.Motivos), Comentario: string(n.Comentario),
					})
				}
			}
			out = append(out, it)
		}
		total := int(pg.NumTotalReg)
		if len(pg.Comprobantes) == 0 || page*rhePageSize >= total {
			return out, nil
		}
	}
	return out, nil
}

// cpeHTTPError traduce un error de api-cpe (formato {"cod","msg","errors":[{"codError","desError"}]}).
func cpeHTTPError(status int, body []byte) *SireError {
	info := sunatErrorSummary(body)
	var v struct {
		Msg    string `json:"msg"`
		Errors []struct {
			CodError any    `json:"codError"`
			DesError string `json:"desError"`
		} `json:"errors"`
	}
	_ = json.Unmarshal(body, &v)
	switch {
	case status == http.StatusUnprocessableEntity || status == http.StatusBadRequest:
		msg, cod := strings.TrimSpace(v.Msg), ""
		if len(v.Errors) > 0 {
			msg, cod = strings.TrimSpace(v.Errors[0].DesError), fmt.Sprintf("%v", v.Errors[0].CodError)
		}
		if msg == "" {
			msg = "SUNAT no aceptó la consulta."
		}
		return sireErr(SireErrValidation, msg, "cod "+cod+" · "+info)
	case status == http.StatusUnauthorized:
		return sireErr(SireErrBadCreds, "SUNAT rechazó el acceso con estas credenciales.", "HTTP 401 · "+info)
	case status == http.StatusForbidden:
		return sireErr(SireErrForbidden, "Las credenciales de API de esta empresa no tienen permiso para consultar la plataforma de confirmación de comprobantes. Verifique en SOL que la aplicación de API tenga acceso a Comprobantes de pago.", "HTTP 403 · "+info)
	case status == http.StatusNotFound:
		return sireErr(SireErrValidation, "SUNAT no encontró información para esta consulta.", "HTTP 404 · "+info)
	case status >= 500:
		return sireErr(SireErrUnavailable, "SUNAT no pudo atender la consulta en este momento. Intente de nuevo en unos minutos.", fmt.Sprintf("HTTP %d · %s", status, info))
	}
	return sireErr(SireErrUnexpected, "SUNAT respondió de forma inesperada.", fmt.Sprintf("HTTP %d · %s", status, info))
}
