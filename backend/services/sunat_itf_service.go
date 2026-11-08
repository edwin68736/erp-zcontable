package services

import (
	"fmt"
	"html"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

// Consulta de ITF (Impuesto a las Transacciones Financieras · Formulario 0695).
//
// SUNAT no ofrece API para esto: es una pantalla del Menú SOL («Declaraciones y pagos → ITF → Consulta de ITF», código
// 13.6.1.1.1). El servidor entra a SOL con la clave de la empresa, abre esa opción, envía el formulario de períodos y
// lee las tres tablas del resultado: movimientos acumulados, contra asientos por error y exoneraciones/convenios/
// inafectación. Solo lectura. No usa las credenciales de API: basta la clave SOL.

const (
	itfMenuCode      = "13.6.1.1.1"
	itfFormPath      = "/cl-at-itconitf/sci01Alias"
	itfMinPeriod     = "200403" // SUNAT no consulta antes de marzo de 2004
	itfMaxRangeMonth = 60
)

// ITFTable una tabla del resultado: columnas tal como las muestra SUNAT y sus filas.
type ITFTable struct {
	Titulo           string     `json:"titulo"`
	Columnas         []string   `json:"columnas"`
	Filas            [][]string `json:"filas"`
	Registros        int        `json:"registros"`
	TotalImpuesto    *float64   `json:"total_impuesto,omitempty"`
	TotalMovimientos *float64   `json:"total_movimientos,omitempty"`
}

// ITFResult resultado de una consulta de ITF.
type ITFResult struct {
	Desde          string   `json:"desde"` // AAAAMM
	Hasta          string   `json:"hasta"`
	Documento      string   `json:"documento"`
	RazonSocial    string   `json:"razon_social"`
	Acumulados     ITFTable `json:"acumulados"`
	ContraAsientos ITFTable `json:"contra_asientos"`
	Exoneraciones  ITFTable `json:"exoneraciones"`
	Nota           string   `json:"nota,omitempty"`
}

// Total de registros de las tres tablas.
func (r *ITFResult) Total() int {
	return r.Acumulados.Registros + r.ContraAsientos.Registros + r.Exoneraciones.Registros
}

type SunatItfService struct {
	creds   *CompanyAccessCredentialService
	timeout time.Duration
	now     func() time.Time
	// linkFn entrega el enlace de ingreso a SOL (en pruebas se reemplaza).
	linkFn func(companyID uint, allowed []uint, userID uint) (string, error)
}

func NewSunatItfService() *SunatItfService {
	sol := NewSunatSolAccessService()
	return &SunatItfService{
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

// SunatAccessInvalidParams los datos de la consulta no son válidos (no se llama a SUNAT).
const SunatAccessInvalidParams = "parametros_invalidos"

var reITFPeriod = regexp.MustCompile(`^\d{6}$`)

// ValidateITFPeriods valida el rango de períodos (AAAAMM) como lo exige SUNAT y devuelve el rango normalizado.
func (s *SunatItfService) ValidateITFPeriods(desde, hasta string) (string, string, error) {
	desde, hasta = strings.TrimSpace(desde), strings.TrimSpace(hasta)
	bad := func(msg string) error { return accessErr(SunatAccessInvalidParams, msg, desde+" – "+hasta) }
	if !reITFPeriod.MatchString(desde) || !reITFPeriod.MatchString(hasta) {
		return "", "", bad("Indique los períodos con el formato AAAAMM.")
	}
	for _, p := range []string{desde, hasta} {
		if mo, _ := strconv.Atoi(p[4:]); mo < 1 || mo > 12 {
			return "", "", bad("El mes de un período debe estar entre 01 y 12.")
		}
	}
	if desde < itfMinPeriod {
		return "", "", bad("El período inicial debe ser 200403 o posterior.")
	}
	if desde > hasta {
		return "", "", bad("El período inicial no puede ser mayor que el final.")
	}
	if cur := s.now().In(limaLocation()).Format("200601"); hasta > cur {
		return "", "", bad("El período final no puede ser posterior al mes actual (" + cur + ").")
	}
	if months := itfMonthsBetween(desde, hasta); months > itfMaxRangeMonth {
		return "", "", bad(fmt.Sprintf("El rango máximo es de %d meses.", itfMaxRangeMonth))
	}
	return desde, hasta, nil
}

func limaLocation() *time.Location {
	if loc, err := time.LoadLocation("America/Lima"); err == nil {
		return loc
	}
	return time.FixedZone("-05", -5*3600)
}

func itfMonthsBetween(desde, hasta string) int {
	y1, _ := strconv.Atoi(desde[:4])
	m1, _ := strconv.Atoi(desde[4:])
	y2, _ := strconv.Atoi(hasta[:4])
	m2, _ := strconv.Atoi(hasta[4:])
	return (y2-y1)*12 + (m2 - m1) + 1
}

// Query consulta el ITF de la empresa entre dos períodos (AAAAMM, ambos incluidos).
func (s *SunatItfService) Query(companyID uint, allowed []uint, userID uint, desde, hasta string) (*ITFResult, error) {
	desde, hasta, err := s.ValidateITFPeriods(desde, hasta)
	if err != nil {
		return nil, err
	}
	cred, err := s.creds.GetByCompanyID(companyID, allowed)
	if err != nil {
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

	// 1) Pantalla de períodos de «Consulta de ITF».
	resp, body, err := sess.execute(itfMenuCode)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != 200 || !strings.Contains(resp.Request.URL.Path, "/cl-at-itconitf/") {
		return nil, accessErr(SunatAccessUnexpected, "SUNAT no abrió la consulta de ITF (la empresa podría no tener acceso).",
			fmt.Sprintf("ITF: HTTP %d %s", resp.StatusCode, safeURL(resp.Request.URL)))
	}
	_ = body
	formURL := resp.Request.URL.Scheme + "://" + resp.Request.URL.Host + itfFormPath

	// 2) El mismo formulario que envía el botón «Siguiente».
	resp2, body2, err := sess.postForm(formURL, url.Values{
		"tipdocdec":    {"06"},
		"numdocdec":    {strings.TrimSpace(cred.RUC)},
		"ejercicio":    {desde},
		"ejerciciofin": {hasta},
		"accion":       {"ppsiguiente"},
	}, resp.Request.URL.String())
	if err != nil {
		return nil, err
	}
	if resp2.StatusCode != 200 {
		return nil, accessErr(SunatAccessUnexpected, "SUNAT respondió de forma inesperada a la consulta de ITF.", fmt.Sprintf("ITF consulta: HTTP %d", resp2.StatusCode))
	}
	res, perr := parseITFResult(body2)
	if perr != nil {
		return nil, perr
	}
	res.Desde, res.Hasta = desde, hasta
	return res, nil
}

// ───────────────────────────── Lectura del resultado ─────────────────────────────

var (
	reHTMLComment  = regexp.MustCompile(`(?s)<!--.*?-->`)
	reITFHeading   = regexp.MustCompile(`(?is)<td class="beta"><b><center>(.*?)</center></b></td>`)
	reITFTable     = regexp.MustCompile(`(?is)<table[^>]*border=['"]1['"][^>]*>(.*?)</table>`)
	reHTMLRow      = regexp.MustCompile(`(?is)<tr[^>]*>(.*?)</tr>`)
	reHTMLCell     = regexp.MustCompile(`(?is)<t[dh][^>]*>(.*?)</t[dh]>`)
	reHTMLTag      = regexp.MustCompile(`(?s)<[^>]+>`)
	reITFRegistros = regexp.MustCompile(`(?i)Cantidad de registros:\s*([\d,]+)`)
	reITFImpuesto  = regexp.MustCompile(`(?i)Total Impuesto:\s*([\d,]+(?:\.\d+)?)`)
	reITFMovs      = regexp.MustCompile(`(?i)Total Movimientos:\s*([\d,]+(?:\.\d+)?)`)
	reITFIdent     = regexp.MustCompile(`(?is)Documento:\s*(.*?)</b>`)
	reITFRazon     = regexp.MustCompile(`(?is)Nombre/Raz[^:]*:\s*(.*?)</b>`)
	reITFNota      = regexp.MustCompile(`(?is)NOTA:\s*(.*?)<`)
)

// htmlText quita las etiquetas, convierte las entidades y compacta los espacios.
func htmlText(s string) string {
	s = html.UnescapeString(reHTMLTag.ReplaceAllString(s, " "))
	return strings.Join(strings.Fields(strings.ReplaceAll(s, " ", " ")), " ")
}

// sunatBodyToUTF8 las páginas viejas de SUNAT llegan en ISO-8859-1: se pasan a UTF-8 si hace falta.
func sunatBodyToUTF8(b []byte) string {
	if utf8.Valid(b) {
		return string(b)
	}
	r := make([]rune, len(b))
	for i, c := range b {
		r[i] = rune(c)
	}
	return string(r)
}

func parseFlexFloat(s string) *float64 {
	v, err := strconv.ParseFloat(strings.ReplaceAll(strings.TrimSpace(s), ",", ""), 64)
	if err != nil {
		return nil
	}
	return &v
}

// parseITFResult lee las tres tablas del resultado de «Consulta de ITF».
func parseITFResult(raw []byte) (*ITFResult, error) {
	page := reHTMLComment.ReplaceAllString(sunatBodyToUTF8(raw), "")
	if !strings.Contains(page, "Resultado de la Consulta") {
		return nil, accessErr(SunatAccessUnexpected, "SUNAT no devolvió el resultado de la consulta de ITF.", "página: "+truncateStr(htmlText(page), 300))
	}
	res := &ITFResult{}
	if m := reITFIdent.FindStringSubmatch(page); m != nil {
		res.Documento = htmlText(m[1])
	}
	if m := reITFRazon.FindStringSubmatch(page); m != nil {
		res.RazonSocial = htmlText(m[1])
	}
	if m := reITFNota.FindStringSubmatch(page); m != nil {
		res.Nota = htmlText(m[1])
	}

	heads := reITFHeading.FindAllStringSubmatchIndex(page, -1)
	if len(heads) == 0 {
		return nil, accessErr(SunatAccessUnexpected, "SUNAT devolvió la consulta de ITF en un formato inesperado.", "sin secciones")
	}
	for i, h := range heads {
		title := htmlText(page[h[2]:h[3]])
		end := len(page)
		if i+1 < len(heads) {
			end = heads[i+1][0]
		}
		table := parseITFSection(title, page[h[1]:end])
		switch low := strings.ToLower(title); {
		case strings.Contains(low, "acumulado"):
			res.Acumulados = table
		case strings.Contains(low, "contra"):
			res.ContraAsientos = table
		case strings.Contains(low, "exonera"):
			res.Exoneraciones = table
		}
	}
	return res, nil
}

func parseITFSection(title, seg string) ITFTable {
	t := ITFTable{Titulo: title, Columnas: []string{}, Filas: [][]string{}}
	if m := reITFTable.FindStringSubmatch(seg); m != nil {
		for _, r := range reHTMLRow.FindAllStringSubmatch(m[1], -1) {
			var cells []string
			for _, c := range reHTMLCell.FindAllStringSubmatch(r[1], -1) {
				cells = append(cells, htmlText(c[1]))
			}
			switch {
			case len(cells) == 0:
			case len(t.Columnas) == 0:
				t.Columnas = cells
			case len(cells) == len(t.Columnas):
				t.Filas = append(t.Filas, cells)
			}
		}
	}
	// Los totales vienen después de la tabla.
	tail := htmlText(seg)
	if m := reITFRegistros.FindStringSubmatch(tail); m != nil {
		if n, err := strconv.Atoi(strings.ReplaceAll(m[1], ",", "")); err == nil {
			t.Registros = n
		}
	} else {
		t.Registros = len(t.Filas)
	}
	if m := reITFImpuesto.FindStringSubmatch(tail); m != nil {
		t.TotalImpuesto = parseFlexFloat(m[1])
	}
	if m := reITFMovs.FindStringSubmatch(tail); m != nil {
		t.TotalMovimientos = parseFlexFloat(m[1])
	}
	return t
}

// InScope valida que la empresa esté dentro del alcance del usuario (nil = todo el estudio).
func (s *SunatItfService) InScope(companyID uint, allowed []uint) error {
	return s.creds.companyInScope(companyID, allowed)
}
