package services

import (
	"fmt"
	"net/url"
	"strings"
	"time"
)

// Recibos por honorarios recibidos, leídos en SOL (Menú SOL → Comprobantes de pago → SEE-SOL → Recibo por Honorarios
// Electrónicos → «Consulta Receptor», código 11.5.1.1.14).
//
// A diferencia de la API de la plataforma de confirmación (rhe_service.go, que solo ve los comprobantes pendientes de
// confirmar), esta pantalla lista TODOS los recibos, notas de crédito y otros ingresos de 4.ª categoría emitidos a la
// empresa, de cualquier estado. El servidor entra a SOL con la clave de la empresa, envía el mismo formulario que el
// navegador (máximo 1 mes por búsqueda) y baja el «Reporte» de cada búsqueda: un archivo de texto con `|` que trae
// además la descripción y la observación de cada recibo. Solo lectura. No usa las credenciales de API.

const (
	rheSolMenuCode    = "11.5.1.1.14"
	rheSolFormPath    = "/ol-ti-itreciboelectronico/cpelec001Alias"
	rheSolAppPath     = "/ol-ti-itreciboelectronico/"
	rheSolWindowDays  = 31  // SUNAT no admite más de 1 mes por búsqueda (el formulario valida «más de 32 días»)
	rheSolMaxDays     = 366 // tope del rango por consulta (≈ 12 búsquedas)
	rheSolMaxItems    = 5000
	rheSolReportCols  = 16
	rheSolEmptyMarker = "No se han encontrado registros"
)

// RheSolItem un comprobante recibido (recibo por honorarios, nota de crédito u otro ingreso de 4.ª categoría).
type RheSolItem struct {
	FecEmision    string  `json:"fec_emision"` // AAAA-MM-DD
	Tipo          string  `json:"tipo"`        // RH, NC, …tal como lo muestra SUNAT
	Comprobante   string  `json:"comprobante"` // E001-40
	Estado        string  `json:"estado"`      // NO ANULADO | ANULADO | REVERTIDO
	Anulado       bool    `json:"anulado"`
	EmisorTipoDoc string  `json:"emisor_tipo_doc"`
	EmisorDoc     string  `json:"emisor_doc"`
	EmisorNombre  string  `json:"emisor_nombre"`
	TipoRenta     string  `json:"tipo_renta"`
	Gratuito      bool    `json:"gratuito"`
	Descripcion   string  `json:"descripcion"`
	Observacion   string  `json:"observacion"`
	Moneda        string  `json:"moneda"` // PEN | USD
	RentaBruta    float64 `json:"renta_bruta"`
	ImpuestoRenta float64 `json:"impuesto_renta"`
	RentaNeta     float64 `json:"renta_neta"`
	Pendiente     float64 `json:"monto_pendiente"`
}

// RheSolResult resultado de una consulta (todas las búsquedas del rango).
type RheSolResult struct {
	Items     []RheSolItem `json:"items"`
	Total     int          `json:"total"`
	Consultas int          `json:"consultas"` // búsquedas hechas a SUNAT (una por tramo de 1 mes)
	Desde     string       `json:"desde"`     // AAAA-MM-DD
	Hasta     string       `json:"hasta"`
	Truncado  bool         `json:"truncado"`
}

type RheSolService struct {
	creds   *CompanyAccessCredentialService
	timeout time.Duration
	now     func() time.Time
	// linkFn entrega el enlace de ingreso a SOL (en pruebas se reemplaza).
	linkFn func(companyID uint, allowed []uint, userID uint) (string, error)
}

func NewRheSolService() *RheSolService {
	sol := NewSunatSolAccessService()
	return &RheSolService{
		creds:   NewCompanyAccessCredentialService(),
		timeout: 60 * time.Second,
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
func (s *RheSolService) InScope(companyID uint, allowed []uint) error {
	return s.creds.companyInScope(companyID, allowed)
}

// ValidateRange valida el rango de fechas de emisión (AAAA-MM-DD) y lo devuelve normalizado.
func (s *RheSolService) ValidateRange(desde, hasta string) (time.Time, time.Time, error) {
	desde, hasta = strings.TrimSpace(desde), strings.TrimSpace(hasta)
	bad := func(msg string) error { return accessErr(SunatAccessInvalidParams, msg, desde+" – "+hasta) }
	loc := limaLocation()
	d, e1 := time.ParseInLocation("2006-01-02", desde, loc)
	h, e2 := time.ParseInLocation("2006-01-02", hasta, loc)
	if e1 != nil || e2 != nil {
		return d, h, bad("Use fechas válidas con el formato AAAA-MM-DD.")
	}
	if h.Before(d) {
		return d, h, bad("La fecha «desde» no puede ser mayor que «hasta».")
	}
	today := s.now().In(loc)
	if h.After(time.Date(today.Year(), today.Month(), today.Day(), 0, 0, 0, 0, loc)) {
		return d, h, bad("La fecha «hasta» no puede ser posterior a hoy.")
	}
	if int(h.Sub(d).Hours()/24)+1 > rheSolMaxDays {
		return d, h, bad(fmt.Sprintf("El rango máximo es de %d días.", rheSolMaxDays))
	}
	return d, h, nil
}

// rheSolWindows parte el rango en tramos de a lo más rheSolWindowDays días (el máximo que acepta SUNAT).
func rheSolWindows(d, h time.Time) [][2]time.Time {
	var out [][2]time.Time
	for s := d; !s.After(h); s = s.AddDate(0, 0, rheSolWindowDays) {
		e := s.AddDate(0, 0, rheSolWindowDays-1)
		if e.After(h) {
			e = h
		}
		out = append(out, [2]time.Time{s, e})
	}
	return out
}

// Query consulta los recibos recibidos por la empresa entre dos fechas de emisión (AAAA-MM-DD, ambas incluidas).
func (s *RheSolService) Query(companyID uint, allowed []uint, userID uint, desde, hasta string) (*RheSolResult, error) {
	d, h, err := s.ValidateRange(desde, hasta)
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

	// 1) Pantalla «Consulta Receptor».
	resp, _, err := sess.execute(rheSolMenuCode)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != 200 || !strings.Contains(resp.Request.URL.Path, rheSolAppPath) {
		return nil, accessErr(SunatAccessUnexpected, "SUNAT no abrió la consulta de recibos por honorarios (la empresa podría no tener acceso).",
			fmt.Sprintf("RHE: HTTP %d %s", resp.StatusCode, safeURL(resp.Request.URL)))
	}
	formURL := resp.Request.URL.Scheme + "://" + resp.Request.URL.Host + rheSolFormPath
	referer := resp.Request.URL.String()

	res := &RheSolResult{Items: []RheSolItem{}, Desde: d.Format("2006-01-02"), Hasta: h.Format("2006-01-02")}
	seen := map[string]bool{}
	for _, w := range rheSolWindows(d, h) {
		res.Consultas++
		// 2) La búsqueda: los mismos campos que arma el botón «Buscar» (tipocomprobante = los 3 tipos marcados).
		r2, page, err := sess.postForm(formURL, url.Values{
			"accion":           {"CapturaCriterioConsulatRec1"},
			"tipocomprobante":  {"01;02;03;"},
			"ruc_emisor":       {""},
			"num_serie":        {""},
			"num_comprob":      {""},
			"fec_desde":        {w[0].Format("02/01/2006")},
			"fec_hasta":        {w[1].Format("02/01/2006")},
			"tipoestado":       {"00"},
			"tipocomprobante1": {"01", "02", "03"},
		}, referer)
		if err != nil {
			return nil, err
		}
		if r2.StatusCode != 200 {
			return nil, accessErr(SunatAccessUnexpected, "SUNAT respondió de forma inesperada a la búsqueda de recibos.", fmt.Sprintf("RHE búsqueda: HTTP %d", r2.StatusCode))
		}
		text := sunatBodyToUTF8(page)
		switch {
		case strings.Contains(text, rheSolEmptyMarker):
			continue
		case strings.Contains(text, "Pagina de Error") || strings.Contains(text, "Página de Error"):
			return nil, accessErr(SunatAccessUnexpected, "SUNAT no pudo atender la búsqueda de recibos. Intente de nuevo en unos minutos.",
				"RHE: "+truncateStr(htmlText(text), 300))
		case !strings.Contains(text, "descargaArchivo"):
			return nil, accessErr(SunatAccessUnexpected, "SUNAT devolvió la búsqueda de recibos en un formato inesperado.", "RHE: "+truncateStr(htmlText(text), 300))
		}
		// 3) El «Descargar Reporte» de esa búsqueda: todos los recibos del tramo, con descripción y observación.
		r3, report, err := sess.postForm(formURL, url.Values{"accion": {"descargaConsultaReceptor"}}, r2.Request.URL.String())
		if err != nil {
			return nil, err
		}
		if r3.StatusCode != 200 {
			return nil, accessErr(SunatAccessUnexpected, "SUNAT no entregó el reporte de recibos.", fmt.Sprintf("RHE reporte: HTTP %d", r3.StatusCode))
		}
		items, perr := parseRheSolReport(report)
		if perr != nil {
			return nil, perr
		}
		for _, it := range items {
			key := it.Tipo + "|" + it.Comprobante + "|" + it.EmisorDoc
			if seen[key] {
				continue
			}
			seen[key] = true
			if len(res.Items) >= rheSolMaxItems {
				res.Truncado = true
				break
			}
			res.Items = append(res.Items, it)
		}
		if res.Truncado {
			break
		}
	}
	// Los más recientes primero.
	sortRheSolItems(res.Items)
	res.Total = len(res.Items)
	return res, nil
}

func sortRheSolItems(items []RheSolItem) {
	// inserción estable simple: el volumen es chico (miles como máximo) y evita importar sort solo para esto
	for i := 1; i < len(items); i++ {
		for j := i; j > 0 && items[j].FecEmision > items[j-1].FecEmision; j-- {
			items[j], items[j-1] = items[j-1], items[j]
		}
	}
}

// parseRheSolReport lee el «Reporte» de SUNAT: texto con columnas separadas por `|`, primera línea de encabezados.
func parseRheSolReport(raw []byte) ([]RheSolItem, error) {
	text := strings.ReplaceAll(sunatBodyToUTF8(raw), "\r\n", "\n")
	lines := strings.Split(strings.TrimSpace(text), "\n")
	if len(lines) == 0 || !strings.Contains(strings.ToLower(lines[0]), "fecha de emisi") || strings.Count(lines[0], "|") < rheSolReportCols-1 {
		return nil, accessErr(SunatAccessUnexpected, "SUNAT entregó el reporte de recibos en un formato inesperado.", "RHE reporte: "+truncateStr(strings.Join(strings.Fields(text), " "), 300))
	}
	items := []RheSolItem{}
	for _, line := range lines[1:] {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		c := strings.Split(line, "|")
		if len(c) < rheSolReportCols {
			continue
		}
		for i := range c {
			c[i] = strings.TrimSpace(c[i])
		}
		fecha, ok := rheSolDate(c[0])
		if !ok {
			continue
		}
		it := RheSolItem{
			FecEmision: fecha, Tipo: c[1], Comprobante: c[2], Estado: c[3],
			Anulado:       !strings.EqualFold(c[3], "NO ANULADO"),
			EmisorTipoDoc: c[4], EmisorDoc: c[5], EmisorNombre: c[6], TipoRenta: c[7], Gratuito: strings.EqualFold(c[8], "SI"),
			Descripcion: rheSolDash(c[9]), Observacion: rheSolDash(c[10]), Moneda: rheSolMoneda(c[11]),
		}
		if f := parseFlexFloat(c[12]); f != nil {
			it.RentaBruta = *f
		}
		if f := parseFlexFloat(c[13]); f != nil {
			it.ImpuestoRenta = *f
		}
		if f := parseFlexFloat(c[14]); f != nil {
			it.RentaNeta = *f
		}
		if f := parseFlexFloat(c[15]); f != nil {
			it.Pendiente = *f
		}
		items = append(items, it)
	}
	return items, nil
}

// rheSolDate «04/06/2026» → «2026-06-04».
func rheSolDate(s string) (string, bool) {
	t, err := time.Parse("02/01/2006", strings.TrimSpace(s))
	if err != nil {
		return "", false
	}
	return t.Format("2006-01-02"), true
}

func rheSolDash(s string) string {
	if s == "-" {
		return ""
	}
	return s
}

func rheSolMoneda(s string) string {
	switch up := strings.ToUpper(strings.TrimSpace(s)); {
	case strings.HasPrefix(up, "SOL"), up == "PEN":
		return "PEN"
	case strings.HasPrefix(up, "D"), up == "USD":
		return "USD"
	default:
		return up
	}
}
