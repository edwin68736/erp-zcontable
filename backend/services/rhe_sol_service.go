package services

import (
	"fmt"
	"net/url"
	"regexp"
	"strings"
	"time"
)

// Recibos por honorarios leídos en SOL (Menú SOL → Comprobantes de pago → SEE-SOL → Recibo por Honorarios Electrónicos):
//   - «Consulta Receptor» (código 11.5.1.1.14): los recibos que RECIBIÓ la empresa (lado «receptor»);
//   - «Consulta Emisor» (código 11.5.1.1.13): los recibos que EMITIÓ la persona natural (lado «emisor»; solo quien es
//     emisor electrónico: a una empresa SUNAT le responde «Ud. no es Emisor Electrónico»).
//
// A diferencia de la API de la plataforma de confirmación (rhe_service.go, que solo ve los comprobantes pendientes de
// confirmar), esta pantalla lista TODOS los recibos, notas de crédito y otros ingresos de 4.ª categoría emitidos a la
// empresa, de cualquier estado. El servidor entra a SOL con la clave de la empresa, envía el mismo formulario que el
// navegador (máximo 1 mes por búsqueda) y baja el «Reporte» de cada búsqueda: un archivo de texto con `|` que trae
// además la descripción y la observación de cada recibo. Solo lectura. No usa las credenciales de API.

const (
	rheSolFormPath    = "/ol-ti-itreciboelectronico/cpelec001Alias"
	rheSolAppPath     = "/ol-ti-itreciboelectronico/"
	rheSolMaxDays     = 366 // tope del rango por consulta
	rheSolMaxItems    = 5000
	rheSolReportCols  = 16
	rheSolEmptyMarker = "No se han encontrado registros"
)

// Lados de la consulta.
const (
	RheSolReceptor = "receptor" // recibos recibidos por la empresa
	RheSolEmisor   = "emisor"   // recibos emitidos por la persona natural
)

// rheSolLado diferencias entre las dos pantallas de SOL.
type rheSolLado struct {
	menuCode   string
	windowDays int    // máximo de días por búsqueda que acepta el formulario de SUNAT
	searchAcc  string // accion de la búsqueda
	reportAcc  string // accion del «Descargar Reporte»
}

var rheSolLados = map[string]rheSolLado{
	// El formulario de receptor valida «más de 32 días»: tramos de 31.
	RheSolReceptor: {menuCode: "11.5.1.1.14", windowDays: 31, searchAcc: "CapturaCriterioConsulatRec1", reportAcc: "descargaConsultaReceptor"},
	// El de emisor valida «más de 184 días»: tramos de 180.
	RheSolEmisor: {menuCode: "11.5.1.1.13", windowDays: 180, searchAcc: "CapturaCriterioBusqueda1", reportAcc: "descargaConsultaEmisor"},
}

// RheSolNormalizeLado devuelve el lado válido (receptor por defecto).
func RheSolNormalizeLado(s string) (string, bool) {
	s = strings.ToLower(strings.TrimSpace(s))
	if s == "" {
		return RheSolReceptor, true
	}
	_, ok := rheSolLados[s]
	return s, ok
}

// RheSolItem un comprobante (recibido o emitido). EmisorXxx es la contraparte: en «receptor» quien emitió el recibo; en
// «emisor» el usuario del servicio (el cliente al que se le emitió). Los nombres JSON se conservan por compatibilidad. (recibo por honorarios, nota de crédito u otro ingreso de 4.ª categoría).
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
	Lado      string       `json:"lado"`
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

// rheSolWindows parte el rango en tramos de a lo más windowDays días (el máximo que acepta SUNAT en cada pantalla).
func rheSolWindows(d, h time.Time, windowDays int) [][2]time.Time {
	var out [][2]time.Time
	for s := d; !s.After(h); s = s.AddDate(0, 0, windowDays) {
		e := s.AddDate(0, 0, windowDays-1)
		if e.After(h) {
			e = h
		}
		out = append(out, [2]time.Time{s, e})
	}
	return out
}

// Query consulta los recibos (recibidos o emitidos, según `lado`) entre dos fechas de emisión (AAAA-MM-DD, ambas incluidas).
func (s *RheSolService) Query(companyID uint, allowed []uint, userID uint, lado, desde, hasta string) (*RheSolResult, error) {
	lado, okLado := RheSolNormalizeLado(lado)
	if !okLado {
		return nil, accessErr(SunatAccessInvalidParams, "Lado de consulta no válido: use receptor o emisor.", lado)
	}
	cfg := rheSolLados[lado]
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

	// 1) Pantalla de consulta (receptor o emisor).
	resp, opening, err := sess.execute(cfg.menuCode)
	if err != nil {
		return nil, err
	}
	if msg := rheSolSunatMessage(opening); msg != "" {
		return nil, accessErr(SunatAccessUnexpected, "SUNAT no permite esta consulta a la empresa: "+msg, "RHE "+lado+": "+msg)
	}
	if resp.StatusCode != 200 || !strings.Contains(resp.Request.URL.Path, rheSolAppPath) {
		return nil, accessErr(SunatAccessUnexpected, "SUNAT no abrió la consulta de recibos por honorarios (la empresa podría no tener acceso).",
			fmt.Sprintf("RHE: HTTP %d %s", resp.StatusCode, safeURL(resp.Request.URL)))
	}
	formURL := resp.Request.URL.Scheme + "://" + resp.Request.URL.Host + rheSolFormPath
	referer := resp.Request.URL.String()

	extra := rheSolHiddenFields(opening)
	res := &RheSolResult{Lado: lado, Items: []RheSolItem{}, Desde: d.Format("2006-01-02"), Hasta: h.Format("2006-01-02")}
	seen := map[string]bool{}
	for _, w := range rheSolWindows(d, h, cfg.windowDays) {
		res.Consultas++
		// 2) La búsqueda: los mismos campos que arma el botón «Buscar» (tipocomprobante = los 3 tipos marcados).
		form := url.Values{
			"accion":           {cfg.searchAcc},
			"tipocomprobante":  {"01;02;03;"},
			"num_serie":        {""},
			"num_comprob":      {""},
			"fec_desde":        {w[0].Format("02/01/2006")},
			"fec_hasta":        {w[1].Format("02/01/2006")},
			"tipoestado":       {"00"},
			"tipocomprobante1": {"01", "02", "03"},
		}
		if lado == RheSolReceptor {
			form.Set("ruc_emisor", "")
		} else {
			form.Set("cod_docide", "-")
			form.Set("num_docide", "")
			for k, v := range extra { // proceso e indicadoralta: los campos ocultos que trae la pantalla de emisor
				form.Set(k, v)
			}
		}
		r2, page, err := sess.postForm(formURL, form, referer)
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
		r3, report, err := sess.postForm(formURL, url.Values{"accion": {cfg.reportAcc}}, r2.Request.URL.String())
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

var (
	reRheHidden  = regexp.MustCompile(`(?i)<input[^>]*type=["']?hidden["']?[^>]*name=["'](proceso|indicadoralta)["'][^>]*value=["']([^"']*)["']`)
	reRheMsgInfo = regexp.MustCompile(`(?is)Informaci(?:&oacute;|ó)n adicional(.*)$`)
)

// rheSolHiddenFields campos ocultos que la pantalla de emisor exige reenviar (proceso, indicadoralta).
func rheSolHiddenFields(page []byte) map[string]string {
	out := map[string]string{"proceso": "31196ALTA", "indicadoralta": "PNAT"} // los que entrega SUNAT hoy, por si faltaran
	for _, m := range reRheHidden.FindAllStringSubmatch(sunatBodyToUTF8(page), -1) {
		out[strings.ToLower(m[1])] = m[2]
	}
	return out
}

// rheSolSunatMessage el motivo cuando SUNAT responde con su «Página de Mensajes» en vez de la pantalla (por ejemplo
// «Ud. no es Emisor Electrónico»). Vacío si la página es la pantalla normal.
func rheSolSunatMessage(page []byte) string {
	text := sunatBodyToUTF8(page)
	if !strings.Contains(text, "Pagina de Mensajes") && !strings.Contains(text, "Página de Mensajes") {
		return ""
	}
	if m := reRheMsgInfo.FindStringSubmatch(text); m != nil {
		// Lo que sigue a «Información adicional :» es el motivo («- Ud. no es Emisor Electrónico»).
		rest := regexp.MustCompile(`(?is)<(script|style)[^>]*>.*?</(script|style)>`).ReplaceAllString(m[1], " ")
		msg := strings.TrimLeft(htmlText(rest), ": -")
		msg = strings.ReplaceAll(msg, "Electr�nico", "Electrónico") // SUNAT ya manda la «ó» dañada
		if msg != "" {
			return truncateStr(msg, 200)
		}
	}
	return "SUNAT devolvió un mensaje en vez de la pantalla: " + truncateStr(htmlText(text), 200)
}
