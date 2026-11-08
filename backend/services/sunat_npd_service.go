package services

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

// Consulta de NPD (Número de Pago de Detracciones).
//
// SUNAT no ofrece API para esto: es una pantalla del Menú SOL («Detracciones → Consulta de NPD», código 12.4.1.1.6) que
// pide la lista con una llamada AJAX (consultaIndividual.htm?action=consultarPadronIndividual) y la muestra en una
// tabla. El servidor entra a SOL con la clave de la empresa, abre esa opción y hace la misma llamada con el rango de
// fechas de generación. SOLO LECTURA: la pantalla también permite anular un NPD (action=anularNPD) y esa llamada
// no existe en este servicio ni debe agregarse.

const (
	npdMenuCode    = "12.4.1.1.6"
	npdListAction  = "consultarPadronIndividual"
	npdMaxRangeDay = 365
)

// Estados de un NPD según SUNAT (indicadorEstado).
const (
	NPDEstadoVigente    = "00"
	NPDEstadoPagado     = "10"
	NPDEstadoNoVigente  = "11"
	npdSunatDateLayout  = "02/01/2006"
	npdRequestDateLayou = "2006-01-02"
)

// NPDItem un NPD de la lista de SUNAT.
type NPDItem struct {
	Npd           string  `json:"npd"`
	Ruc           string  `json:"ruc"`
	RazonSocial   string  `json:"razon_social"`
	FecRegistro   string  `json:"fec_registro"` // dd/mm/aaaa hh:mm:ss
	FecCreacion   string  `json:"fec_creacion"` // dd/mm/aaaa
	FecLimitePago string  `json:"fec_limite_pago"`
	Estado        string  `json:"estado"`
	EstadoCod     string  `json:"estado_cod"`
	Importe       float64 `json:"importe"`
}

// NPDResult resultado de una consulta de NPD.
type NPDResult struct {
	Desde string    `json:"desde"` // AAAA-MM-DD (fecha de generación)
	Hasta string    `json:"hasta"`
	Items []NPDItem `json:"items"`
	Total int       `json:"total"`
	// Importes: total de la lista y de los que siguen vigentes (pendientes de pago).
	TotalImporte   float64 `json:"total_importe"`
	Vigentes       int     `json:"vigentes"`
	ImporteVigente float64 `json:"importe_vigente"`
}

type SunatNpdService struct {
	creds   *CompanyAccessCredentialService
	timeout time.Duration
	now     func() time.Time
	// linkFn entrega el enlace de ingreso a SOL (en pruebas se reemplaza).
	linkFn func(companyID uint, allowed []uint, userID uint) (string, error)
}

func NewSunatNpdService() *SunatNpdService {
	sol := NewSunatSolAccessService()
	return &SunatNpdService{
		creds:   NewCompanyAccessCredentialService(),
		timeout: 40 * time.Second,
		now:     time.Now,
		linkFn: func(companyID uint, allowed []uint, userID uint) (string, error) {
			res, err := sol.Generate(companyID, allowed, userID, sunatAccessTargetSunat)
			if err != nil {
				return "", err
			}
			return res.URL, nil
		},
	}
}

// InScope valida que la empresa esté dentro del alcance del usuario (nil = todo el estudio).
func (s *SunatNpdService) InScope(companyID uint, allowed []uint) error {
	return s.creds.companyInScope(companyID, allowed)
}

var reNPDDay = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

// ValidateNPDRange valida el rango de fechas de generación (AAAA-MM-DD) como lo exige SUNAT.
func (s *SunatNpdService) ValidateNPDRange(desde, hasta string) (time.Time, time.Time, error) {
	desde, hasta = strings.TrimSpace(desde), strings.TrimSpace(hasta)
	bad := func(msg string) error { return accessErr(SunatAccessInvalidParams, msg, desde+" – "+hasta) }
	if !reNPDDay.MatchString(desde) || !reNPDDay.MatchString(hasta) {
		return time.Time{}, time.Time{}, bad("Indique las fechas con el formato AAAA-MM-DD.")
	}
	d, err1 := time.Parse(npdRequestDateLayou, desde)
	h, err2 := time.Parse(npdRequestDateLayou, hasta)
	if err1 != nil || err2 != nil {
		return time.Time{}, time.Time{}, bad("Indique fechas válidas.")
	}
	if d.After(h) {
		return d, h, bad("La fecha «desde» no puede ser mayor que «hasta».")
	}
	if int(h.Sub(d).Hours()/24)+1 > npdMaxRangeDay {
		return d, h, bad(fmt.Sprintf("El rango máximo es de %d días (12 meses).", npdMaxRangeDay))
	}
	if today := s.now().In(limaLocation()).Format(npdRequestDateLayou); hasta > today {
		return d, h, bad("La fecha «hasta» no puede ser posterior a hoy.")
	}
	return d, h, nil
}

// Query consulta los NPD de la empresa generados entre dos fechas (AAAA-MM-DD, ambas incluidas).
func (s *SunatNpdService) Query(companyID uint, allowed []uint, userID uint, desde, hasta string) (*NPDResult, error) {
	d, h, err := s.ValidateNPDRange(desde, hasta)
	if err != nil {
		return nil, err
	}
	if _, err := s.creds.GetByCompanyID(companyID, allowed); err != nil {
		return nil, err
	}
	link, err := s.linkFn(companyID, allowed, userID)
	if err != nil {
		return nil, err
	}
	sess, err := openSolMenu(link, s.timeout)
	if err != nil {
		return nil, err
	}
	defer sess.close()

	// 1) Pantalla «Consulta de NPD».
	resp, _, err := sess.execute(npdMenuCode)
	if err != nil {
		return nil, err
	}
	app := resp.Request.URL
	if resp.StatusCode != 200 || !strings.Contains(app.Path, "/cl-ti-itnumpagdetr/") {
		return nil, accessErr(SunatAccessUnexpected, "SUNAT no abrió la consulta de NPD (la empresa podría no tener acceso).",
			fmt.Sprintf("NPD: HTTP %d %s", resp.StatusCode, safeURL(app)))
	}

	// 2) La llamada que hace la pantalla al pulsar «Buscar» por fecha de generación.
	q := url.Values{
		"action":       {npdListAction},
		"fecIni":       {d.Format(npdSunatDateLayout)},
		"fecFin":       {h.Format(npdSunatDateLayout)},
		"tipoConsulta": {"2"},
		"num_npd":      {""},
	}
	endpoint := app.Scheme + "://" + app.Host + app.Path + "?" + q.Encode()
	listResp, body, err := sess.do(http.MethodPost, endpoint, nil, app.String(), map[string]string{
		"Content-Type":     "application/json; charset=utf-8",
		"Accept":           "application/json, text/javascript, */*; q=0.01",
		"X-Requested-With": "XMLHttpRequest",
	})
	if err != nil {
		return nil, err
	}
	if listResp.StatusCode != 200 {
		return nil, accessErr(SunatAccessUnexpected, "SUNAT respondió de forma inesperada a la consulta de NPD.", fmt.Sprintf("NPD consulta: HTTP %d", listResp.StatusCode))
	}
	res, perr := parseNPDResult(body)
	if perr != nil {
		return nil, perr
	}
	res.Desde, res.Hasta = d.Format(npdRequestDateLayou), h.Format(npdRequestDateLayou)
	return res, nil
}

// parseNPDResult lee la respuesta JSON de la lista de NPD.
func parseNPDResult(raw []byte) (*NPDResult, error) {
	var payload struct {
		Resultado []struct {
			NumNpd          string  `json:"numNpd"`
			NumRuc          string  `json:"numRuc"`
			DesRazonSocial  string  `json:"desRazonSocial"`
			FecRegistro     string  `json:"fecRegistro"`
			FecCreacion     string  `json:"fecCreacion"`
			FecLimitePago   string  `json:"fecLimitePago"`
			Estado          string  `json:"estado"`
			IndicadorEstado string  `json:"indicadorEstado"`
			Importe         float64 `json:"importe"`
		} `json:"resultado"`
		BeanErr *struct {
			Mensaje string `json:"mensajeerror"`
		} `json:"beanErr"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, accessErr(SunatAccessUnexpected, "SUNAT devolvió la lista de NPD en un formato inesperado.", "respuesta: "+truncateStr(htmlText(string(raw)), 200))
	}
	if payload.BeanErr != nil {
		return nil, accessErr(SunatAccessUnexpected, "SUNAT no pudo procesar la consulta de NPD.", truncateStr(strings.TrimSpace(payload.BeanErr.Mensaje), 400))
	}
	res := &NPDResult{Items: []NPDItem{}}
	for _, r := range payload.Resultado {
		it := NPDItem{
			Npd: strings.TrimSpace(r.NumNpd), Ruc: strings.TrimSpace(r.NumRuc), RazonSocial: strings.TrimSpace(r.DesRazonSocial),
			FecRegistro: strings.TrimSpace(r.FecRegistro), FecCreacion: strings.TrimSpace(r.FecCreacion), FecLimitePago: strings.TrimSpace(r.FecLimitePago),
			Estado: strings.TrimSpace(r.Estado), EstadoCod: strings.TrimSpace(r.IndicadorEstado), Importe: r.Importe,
		}
		res.Items = append(res.Items, it)
		res.TotalImporte += it.Importe
		if it.EstadoCod == NPDEstadoVigente {
			res.Vigentes++
			res.ImporteVigente += it.Importe
		}
	}
	res.Total = len(res.Items)
	return res, nil
}
