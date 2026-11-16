package services

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"miappfiber/database"
	"miappfiber/models"

	"github.com/xuri/excelize/v2"
	"gorm.io/gorm/clause"
)

// Consulta de Detracciones (SPOT): constancias de depósito de los pagos de detracciones de una empresa.
//
// NO está en el Menú SOL clásico (el ícono «Consulta de detracciones» da «Acceso no autorizado»): vive en la plataforma
// de Pagos de SUNAT, opción 55.2.1.1.4 «Consulta de Pago de Detracciones». Esa opción abre una aplicación web
// (e-plataformaunica.sunat.gob.pe) que llama a una API REST con el token de la sesión (cabecera IdCache). El servidor
// entra a Pagos con la clave SOL de la empresa, abre la opción, hace las mismas llamadas que la pantalla (consultar la
// lista y bajar la constancia de cada pago) y arma el Excel y el ZIP. SOLO LECTURA: no se envía correo ni se crea nada.
//
// Filtros de la pantalla de SUNAT: fecha de pago (rango de máximo 30 días) o periodo tributario (solo pagos
// individuales), tipo de cuenta (convencional, especial IVAP, Ley 30737) y tipo de pago (individuales, masivos,
// transporte de pasajeros). Se verificó con pagos individuales; los pagos masivos y de pasajeros siguen el código de
// la pantalla y no se probaron con datos reales.

const (
	spotAppCode      = "55.2.1.1.4"
	spotAPIBase      = "https://e-plataformaunica.sunat.gob.pe/v1/recaudacion/tributaria/declapago/detracciones"
	spotAppOrigin    = "https://e-plataformaunica.sunat.gob.pe/"
	spotMaxRangeDays = 30
	// spotMaxConstancias constancias por descarga: se piden de a una; más tiempo seguido cansa a SUNAT. Si hay más pagos, la
	// siguiente descarga con los mismos filtros baja las que faltan (ver models.DetraccionConstancia).
	spotMaxConstancias = 250
	spotStaleAfter     = 20 * time.Minute
	spotHistoryKeep    = 100
	spotPace           = 250 * time.Millisecond
	spotMinPeriodo     = 200409
)

// Tipos de pago de la pantalla de SUNAT.
const (
	SpotPagoIndividuales = "individuales"
	SpotPagoMasivos      = "masivos"
	SpotPagoPasajeros    = "pasajeros"
	SpotModoFecha        = "fecha"
	SpotModoPeriodo      = "periodo"
)

var spotTipoConsulta = map[string]string{
	SpotPagoIndividuales: "pagosIndividuales",
	SpotPagoMasivos:      "pagosMasivos",
	SpotPagoPasajeros:    "pagosTransPasajeros",
}

// spotCuentaNombre nombre corto del tipo de cuenta (columna «Desc. Cuenta» del Excel).
var spotCuentaNombre = map[string]string{"1": "Convencional", "2": "Especial IVAP", "3": "Ley 30737"}

// SpotCuentaNombre nombre del tipo de cuenta para mostrar.
func SpotCuentaNombre(id string) string {
	if n, ok := spotCuentaNombre[id]; ok {
		return n
	}
	return id
}

// SpotFilter los filtros de una consulta.
type SpotFilter struct {
	TipoCuenta string `json:"tipo_cuenta"` // 1, 2 o 3
	TipoPago   string `json:"tipo_pago"`   // individuales | masivos | pasajeros
	Modo       string `json:"modo"`        // fecha | periodo
	Desde      string `json:"desde"`       // AAAA-MM-DD (modo fecha)
	Hasta      string `json:"hasta"`
	Periodo    string `json:"periodo"` // AAAAMM (modo periodo)
}

// spotRow una fila de la respuesta de SUNAT con todos los valores como texto.
type spotRow map[string]string

// spotAPI la sesión abierta en la plataforma de Pagos (en pruebas se reemplaza).
type spotAPI interface {
	consultar(f SpotFilter) ([]spotRow, error)
	// constancia baja la constancia del pago que está en esa posición de la lista (indice) con ese número.
	constancia(numero string, indice int) ([]byte, error)
	constanciaMasiva(numero string) ([]byte, error)
	close()
}

type SunatSpotService struct {
	creds   *CompanyAccessCredentialService
	timeout time.Duration
	now     func() time.Time
	// async: la descarga corre en segundo plano (siempre en producción; las pruebas la ejecutan en línea).
	async bool
	pace  time.Duration
	mu    sync.Mutex
	// linkFn entrega el enlace de ingreso a la plataforma de Pagos (en pruebas se reemplaza).
	linkFn func(companyID uint, allowed []uint, userID uint) (string, error)
	// openFn abre la sesión de la plataforma con ese enlace (en pruebas se reemplaza).
	openFn func(link string, timeout time.Duration) (spotAPI, error)
}

func NewSunatSpotService() *SunatSpotService {
	sol := NewSunatSolAccessService()
	return &SunatSpotService{
		creds: NewCompanyAccessCredentialService(), timeout: 60 * time.Second, now: time.Now, async: true, pace: spotPace,
		linkFn: func(companyID uint, allowed []uint, userID uint) (string, error) {
			res, err := sol.Generate(companyID, allowed, userID, sunatAccessTargetPagos)
			if err != nil {
				return "", err
			}
			return res.URL, nil
		},
		openFn: func(link string, timeout time.Duration) (spotAPI, error) { return openSpotSession(link, timeout) },
	}
}

// InScope valida que la empresa esté dentro del alcance del usuario (nil = todo el estudio).
func (s *SunatSpotService) InScope(companyID uint, allowed []uint) error {
	return s.creds.companyInScope(companyID, allowed)
}

var reSpotPeriodo = regexp.MustCompile(`^\d{6}$`)
var reSpotScript = regexp.MustCompile(`(?is)<script[^>]*>.*?</script>`)

// Validate normaliza y valida los filtros como lo exige la pantalla de SUNAT.
func (s *SunatSpotService) Validate(f SpotFilter) (SpotFilter, error) {
	f.TipoCuenta, f.TipoPago, f.Modo = strings.TrimSpace(f.TipoCuenta), strings.TrimSpace(f.TipoPago), strings.TrimSpace(f.Modo)
	f.Desde, f.Hasta, f.Periodo = strings.TrimSpace(f.Desde), strings.TrimSpace(f.Hasta), strings.TrimSpace(f.Periodo)
	bad := func(msg string) error {
		return accessErr(SunatAccessInvalidParams, msg, f.TipoCuenta+"/"+f.TipoPago+"/"+f.Modo+" "+f.Desde+" "+f.Hasta+" "+f.Periodo)
	}
	if _, ok := spotCuentaNombre[f.TipoCuenta]; !ok {
		return f, bad("Elija el tipo de cuenta.")
	}
	if _, ok := spotTipoConsulta[f.TipoPago]; !ok {
		return f, bad("Elija el tipo de pago.")
	}
	// Combinaciones que ofrece la pantalla de SUNAT.
	allowed := map[string][]string{
		"1": {SpotPagoIndividuales, SpotPagoMasivos, SpotPagoPasajeros},
		"2": {SpotPagoIndividuales},
		"3": {SpotPagoIndividuales, SpotPagoMasivos},
	}[f.TipoCuenta]
	okPago := false
	for _, p := range allowed {
		okPago = okPago || p == f.TipoPago
	}
	if !okPago {
		return f, bad("Ese tipo de pago no existe para el tipo de cuenta elegido.")
	}
	now := s.now().In(limaLocation())
	switch f.Modo {
	case SpotModoPeriodo:
		if f.TipoPago != SpotPagoIndividuales {
			return f, bad("Por periodo solo se consultan los pagos individuales: use la fecha de pago.")
		}
		if !reSpotPeriodo.MatchString(f.Periodo) {
			return f, bad("Ingrese un periodo tributario válido (AAAAMM).")
		}
		n, _ := strconv.Atoi(f.Periodo)
		if m := n % 100; m < 1 || m > 12 {
			return f, bad("Ingrese un periodo tributario válido (AAAAMM).")
		}
		if n < spotMinPeriodo {
			return f, bad("El periodo tributario no puede ser anterior a 200409.")
		}
		if n > now.Year()*100+int(now.Month()) {
			return f, bad("El periodo tributario no puede ser posterior al mes actual.")
		}
		f.Desde, f.Hasta = "", ""
	case SpotModoFecha:
		if !reNPDDay.MatchString(f.Desde) || !reNPDDay.MatchString(f.Hasta) {
			return f, bad("Indique las fechas con el formato AAAA-MM-DD.")
		}
		d, err1 := time.Parse(npdRequestDateLayou, f.Desde)
		h, err2 := time.Parse(npdRequestDateLayou, f.Hasta)
		if err1 != nil || err2 != nil {
			return f, bad("Indique fechas válidas.")
		}
		if d.After(h) {
			return f, bad("La fecha «desde» no puede ser mayor que «hasta».")
		}
		if int(h.Sub(d).Hours()/24)+1 > spotMaxRangeDays {
			return f, bad(fmt.Sprintf("El rango máximo es de %d días: SUNAT no deja consultar más.", spotMaxRangeDays))
		}
		if f.Hasta > now.Format(npdRequestDateLayou) {
			return f, bad("La fecha «hasta» no puede ser posterior a hoy.")
		}
		f.Periodo = ""
	default:
		return f, bad("Elija si consulta por fecha de pago o por periodo.")
	}
	return f, nil
}

// ---------- sesión con la plataforma de Pagos ----------

var (
	reSpotIDCache = regexp.MustCompile(`idCache=([A-Za-z0-9_.\-]{100,})`)
	reSpotToken   = regexp.MustCompile(`setItem\("token",\s*"([^"]+)"`)
)

type spotSession struct {
	m     *solMenuSession
	token string
}

// openSpotSession sigue el enlace de ingreso a Pagos y abre «Consulta de Pago de Detracciones» (55.2.1.1.4).
// El orden y el parámetro s=ww1 importan: sin ellos SUNAT responde «Error en la invocación».
func openSpotSession(link string, timeout time.Duration) (*spotSession, error) {
	jar, _ := cookiejar.New(nil)
	m := &solMenuSession{client: &http.Client{Jar: jar, Timeout: timeout}, sub: "ww1"}
	resp, body, err := m.do(http.MethodGet, link, nil, "")
	if err != nil {
		return nil, err
	}
	menu := *resp.Request.URL
	menu.RawQuery, menu.Fragment = "", ""
	if resp.StatusCode != http.StatusOK || !strings.Contains(menu.Path, "MenuInternetPlataforma") {
		return nil, accessErr(SunatAccessUnexpected, "SUNAT respondió de forma inesperada al abrir la plataforma de Pagos.", fmt.Sprintf("pagos: HTTP %d %s", resp.StatusCode, safeURL(resp.Request.URL)))
	}
	m.menuURL = menu.String()
	tok := reSpotIDCache.FindStringSubmatch(sunatBodyToUTF8(body))
	if tok == nil {
		return nil, accessErr(SunatAccessUnexpected, "SUNAT no entregó la sesión de la plataforma de Pagos.", "pagos: sin idCache")
	}
	// Igual que el menú al abrir una opción: cierra la aplicación anterior y pide la nueva.
	_, _, _ = m.do(http.MethodPost, m.menuURL, url.Values{"action": {"prevApp"}}, "")
	u := m.menuURL + "?action=execute&code=" + spotAppCode + "&idCache=" + tok[1] + "&s=" + m.sub
	resp2, body2, err := m.do(http.MethodGet, u, nil, m.menuURL)
	if err != nil {
		return nil, err
	}
	if resp2.StatusCode != http.StatusOK || !strings.Contains(resp2.Request.URL.Host, "e-plataformaunica") {
		return nil, accessErr(SunatAccessUnexpected, "SUNAT no abrió la consulta de detracciones (la empresa podría no tener acceso).",
			fmt.Sprintf("pagos: HTTP %d %s", resp2.StatusCode, safeURL(resp2.Request.URL)))
	}
	t := reSpotToken.FindStringSubmatch(sunatBodyToUTF8(body2))
	if t == nil {
		return nil, accessErr(SunatAccessUnexpected, "SUNAT no abrió la consulta de detracciones.", "pagos: sin token de la plataforma")
	}
	return &spotSession{m: m, token: t[1]}, nil
}

// close cierra la sesión de Pagos (mejor esfuerzo).
func (ss *spotSession) close() { ss.m.close() }

func (ss *spotSession) do(method, path, body string) (*http.Response, []byte, error) {
	var rd io.Reader
	if method == http.MethodPost {
		rd = strings.NewReader(body)
	}
	req, _ := http.NewRequest(method, spotAPIBase+path, rd)
	req.Header.Set("User-Agent", sunatSolUserAgent)
	req.Header.Set("IdCache", ss.token)
	req.Header.Set("IdFormulario", "*MENU*")
	req.Header.Set("Referer", spotAppOrigin)
	if method == http.MethodPost {
		req.Header.Set("Content-Type", "application/json")
	} else {
		req.Header.Set("Accept", "application/json, text/plain, */*")
	}
	resp, err := ss.m.client.Do(req)
	if err != nil {
		return nil, nil, accessErr(SunatAccessUnavailable, "No se pudo comunicar con SUNAT. Intente de nuevo.", err.Error())
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(io.LimitReader(resp.Body, 20<<20))
	if err != nil {
		return nil, nil, accessErr(SunatAccessUnavailable, "SUNAT cortó la respuesta. Intente de nuevo.", err.Error())
	}
	return resp, b, nil
}

func spotDMY(iso string) string {
	t, err := time.Parse(npdRequestDateLayou, iso)
	if err != nil {
		return ""
	}
	return t.Format(npdSunatDateLayout)
}

func (ss *spotSession) consultar(f SpotFilter) ([]spotRow, error) {
	q := url.Values{}
	q.Set("fechaInicio", spotDMY(f.Desde))
	q.Set("fechaFin", spotDMY(f.Hasta))
	q.Set("tipoCuenta", f.TipoCuenta)
	q.Set("tipoConsulta", spotTipoConsulta[f.TipoPago])
	q.Set("periodo", f.Periodo)
	resp, body, err := ss.do(http.MethodGet, "/t/consultar?&"+q.Encode(), "")
	if err != nil {
		return nil, err
	}
	return parseSpotList(resp.StatusCode, body)
}

// parseSpotList lee la respuesta de «consultar».
func parseSpotList(status int, raw []byte) ([]spotRow, error) {
	if status != http.StatusOK {
		return nil, accessErr(SunatAccessUnexpected, "SUNAT respondió de forma inesperada a la consulta de detracciones.", fmt.Sprintf("consultar: HTTP %d", status))
	}
	var payload struct {
		Cod     int    `json:"cod"`
		Msg     string `json:"msg"`
		Errores []struct {
			Cod int    `json:"cod"`
			Msg string `json:"msg"`
		} `json:"errores"`
		Resultado json.RawMessage `json:"resultado"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, accessErr(SunatAccessUnexpected, "SUNAT devolvió la lista de detracciones en un formato inesperado.", "respuesta: "+truncateStr(htmlText(string(raw)), 200))
	}
	if payload.Cod != 200 {
		msg := strings.TrimSpace(payload.Msg)
		if len(payload.Errores) > 0 && strings.TrimSpace(payload.Errores[0].Msg) != "" {
			msg = payload.Errores[0].Msg
		}
		msg = strings.TrimSpace(strings.ReplaceAll(htmlText(strings.ReplaceAll(msg, "<br>", " ")), " ", " "))
		if msg == "" {
			msg = "SUNAT no pudo procesar la consulta de detracciones."
		}
		return nil, accessErr(SunatAccessInvalidParams, msg, fmt.Sprintf("consultar: cod %d", payload.Cod))
	}
	if len(bytes.TrimSpace(payload.Resultado)) == 0 || string(bytes.TrimSpace(payload.Resultado)) == "null" {
		return nil, nil
	}
	dec := json.NewDecoder(bytes.NewReader(payload.Resultado))
	dec.UseNumber()
	var list []map[string]any
	if err := dec.Decode(&list); err != nil {
		return nil, accessErr(SunatAccessUnexpected, "SUNAT devolvió la lista de detracciones en un formato inesperado.", "resultado no es una lista")
	}
	rows := make([]spotRow, 0, len(list))
	for _, m := range list {
		r := spotRow{}
		for k, v := range m {
			switch t := v.(type) {
			case nil:
			case string:
				r[k] = strings.TrimSpace(t)
			case json.Number:
				r[k] = t.String()
			case bool:
				r[k] = strconv.FormatBool(t)
			}
		}
		rows = append(rows, r)
	}
	return rows, nil
}

// spotConstanciaHTML deja la constancia como un HTML que se ve bien al abrirlo (UTF-8 declarado y acentos correctos).
func spotConstanciaHTML(raw []byte) []byte {
	s := string(raw)
	if !utf8.ValidString(s) {
		s = sunatBodyToUTF8(raw)
	}
	s = fixMojibake(s)
	// Sin el script de seguimiento de SUNAT: pide un archivo de su sitio que no existe al abrir la constancia desde el disco.
	s = reSpotScript.ReplaceAllString(s, "")
	if !strings.Contains(strings.ToLower(s), "charset") {
		if i := strings.Index(strings.ToLower(s), "<head>"); i >= 0 {
			s = s[:i+6] + `<meta charset="utf-8">` + s[i+6:]
		} else {
			s = `<meta charset="utf-8">` + s
		}
	}
	return []byte(s)
}

func (ss *spotSession) constancia(numero string, indice int) ([]byte, error) {
	// Igual que la pantalla: primero abre la constancia (SUNAT la deja en la sesión) y después pide el archivo. Sin el primer
	// paso, el archivo de cualquier constancia que no sea la última abierta da error 500.
	q := fmt.Sprintf("/e/obtenerconstancia?indice=%d&numeroConstancia=%s", indice, url.QueryEscape(numero))
	oresp, ob, err := ss.do(http.MethodGet, q, "")
	if err != nil {
		return nil, err
	}
	if oresp.StatusCode != http.StatusOK || !bytes.Contains(ob, []byte(`"cod":200`)) {
		return nil, accessErr(SunatAccessUnexpected, "SUNAT no abrió la constancia.", fmt.Sprintf("constancia %s: HTTP %d %s", numero, oresp.StatusCode, truncateStr(htmlText(string(ob)), 120)))
	}
	resp, b, err := ss.do(http.MethodPost, "/t/descargarconstancia?numeroConstancia="+url.QueryEscape(numero), `""`)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK || !bytes.Contains(bytes.ToUpper(b), []byte("CONSTANCIA")) {
		return nil, accessErr(SunatAccessUnexpected, "SUNAT no entregó la constancia.", fmt.Sprintf("constancia %s: HTTP %d", numero, resp.StatusCode))
	}
	return spotConstanciaHTML(b), nil
}

func (ss *spotSession) constanciaMasiva(numero string) ([]byte, error) {
	resp, b, err := ss.do(http.MethodPost, "/t/descargarconstanciamasivo/detraccion/"+url.PathEscape(numero), `""`)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK || len(b) == 0 {
		return nil, accessErr(SunatAccessUnexpected, "SUNAT no entregó la constancia del pago masivo.", fmt.Sprintf("constancia masiva %s: HTTP %d", numero, resp.StatusCode))
	}
	return b, nil
}

// ---------- el Excel (mismos datos que el reporte de la referencia) ----------

// spotExcelColumns las 18 columnas del reporte de pagos individuales: título → campo de SUNAT.
var spotExcelColumns = []struct{ Title, Key string }{
	{"Tipo Comp.", "cod_tipcomprobante"}, {"Serie", "num_serie"}, {"Número Comp.", "num_comprobante"}, {"Periodo Trib.", "per_tributario"},
	{"Tipo Doc Adq", "tip_doc_adq"}, {"RUC Proveedor", "num_ruc_proveedor"}, {"Nombre Proveedor", "des_prov"}, {"Nro Constancia", "num_constancia"},
	{"Monto", "mto_deposito"}, {"Fecha Pago", "fecha_pago"}, {"Tipo Cuenta ID", "cod_tipcta"}, {"Nro Cuenta Banco", "num_cuenta"},
	{"Tipo Bien", "tip_bien"}, {"Tipo Oper.", "tip_operacion"}, {"Doc Adquiriente", "num_doc_adq"}, {"Adquiriente", "des_adq"},
	{"Nro Pago Detracciones", "num_npd"}, {"Desc. Cuenta", "desc_cuenta"},
}

var spotExcelMasivoColumns = []struct{ Title, Key string }{
	{"Tipo Cuenta ID", "cod_tipcta"}, {"Desc. Cuenta", "desc_cuenta"}, {"Fecha Pago", "fecha_pago"}, {"Número", "num_detr"},
	{"Archivo", "des_archivo"}, {"Importe Total", "mto_importe_total_desc"}, {"Nro Pago Detracciones", "num_npd"},
}

// spotFechaPago la fecha de pago como dd/mm/aaaa.
func spotFechaPago(r spotRow) string {
	for _, k := range []string{"fec_pago_desc", "fec_pag_desc"} {
		v := r[k]
		if v == "" {
			continue
		}
		if t, err := time.Parse(npdRequestDateLayou, v); err == nil {
			return t.Format(npdSunatDateLayout)
		}
		return v
	}
	return ""
}

func spotMonto(r spotRow) float64 {
	for _, k := range []string{"mto_deposito", "mto_deposito_desc", "mto_importe_total_desc"} {
		if n, ok := parseSunatAmount(r[k]); ok {
			return n
		}
	}
	return 0
}

func spotCell(r spotRow, f SpotFilter, key string) any {
	switch key {
	case "fecha_pago":
		return spotFechaPago(r)
	case "desc_cuenta":
		id := r["cod_tipcta"]
		if id == "" {
			id = f.TipoCuenta
		}
		return SpotCuentaNombre(id)
	case "cod_tipcta":
		if r[key] == "" {
			return f.TipoCuenta
		}
	case "mto_deposito":
		return spotMonto(r)
	case "tip_bien":
		if r[key] == "" {
			return r["cod_bien"]
		}
	}
	return r[key]
}

// SpotExcel arma el reporte en Excel de una consulta.
func SpotExcel(rows []spotRow, f SpotFilter) ([]byte, error) {
	cols := spotExcelColumns
	if f.TipoPago == SpotPagoMasivos {
		cols = spotExcelMasivoColumns
	}
	x := excelize.NewFile()
	defer x.Close()
	const sheet = "Detracciones"
	if err := x.SetSheetName("Sheet1", sheet); err != nil {
		return nil, err
	}
	for c, col := range cols {
		cell, _ := excelize.CoordinatesToCellName(c+1, 1)
		_ = x.SetCellValue(sheet, cell, col.Title)
	}
	for r, row := range rows {
		for c, col := range cols {
			cell, _ := excelize.CoordinatesToCellName(c+1, r+2)
			_ = x.SetCellValue(sheet, cell, spotCell(row, f, col.Key))
		}
	}
	if bold, err := x.NewStyle(&excelize.Style{Font: &excelize.Font{Bold: true}}); err == nil {
		last, _ := excelize.CoordinatesToCellName(len(cols), 1)
		_ = x.SetCellStyle(sheet, "A1", last, bold)
	}
	for c := range cols {
		name, _ := excelize.ColumnNumberToName(c + 1)
		_ = x.SetColWidth(sheet, name, name, 18)
	}
	var buf bytes.Buffer
	if err := x.Write(&buf); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// ---------- la descarga ----------

type spotBundle struct {
	Total, Bajadas, Pendientes int
	Monto                      float64
	Aviso                      string
	Zip                        []byte
}

var reSpotFileSafe = regexp.MustCompile(`[^A-Za-z0-9._-]+`)

// SpotReportName nombre del Excel del reporte (como la referencia: Reporte_Detracciones_202608_20605127721.xlsx).
func SpotReportName(f SpotFilter, ruc string) string {
	span := f.Periodo
	if f.Modo == SpotModoFecha {
		span = strings.ReplaceAll(f.Desde, "-", "") + "_" + strings.ReplaceAll(f.Hasta, "-", "")
	}
	return "Reporte_Detracciones_" + span + "_" + reSpotFileSafe.ReplaceAllString(ruc, "") + ".xlsx"
}

// fetch consulta la lista, baja una constancia por pago y arma el ZIP (Excel + constancias).
func (s *SunatSpotService) fetch(companyID uint, allowed []uint, userID uint, f SpotFilter, ruc string) (*spotBundle, error) {
	link, err := s.linkFn(companyID, allowed, userID)
	if err != nil {
		return nil, err
	}
	api, err := s.openFn(link, s.timeout)
	if err != nil {
		return nil, err
	}
	defer api.close()

	rows, err := api.consultar(f)
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return &spotBundle{}, nil
	}
	b := &spotBundle{Total: len(rows)}
	for _, r := range rows {
		b.Monto += spotMonto(r)
	}

	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	add := func(name string, data []byte) error {
		w, err := zw.Create(name)
		if err != nil {
			return err
		}
		_, err = w.Write(data)
		return err
	}

	masivo := f.TipoPago == SpotPagoMasivos
	keyOf := func(r spotRow) string {
		if masivo {
			return "M" + r["num_detr"]
		}
		return r["num_constancia"]
	}
	// Las constancias que ya se bajaron en otra descarga no se piden otra vez.
	have := map[string]bool{}
	var keys []string
	for _, r := range rows {
		if k := keyOf(r); k != "" && k != "M" {
			keys = append(keys, k)
		}
	}
	if len(keys) > 0 {
		var done []models.DetraccionConstancia
		if err := database.DB.Select("numero").Where("company_id = ? AND numero IN ?", companyID, keys).Find(&done).Error; err == nil {
			for _, d := range done {
				have[d.Numero] = true
			}
		}
	}
	var got []string
	todo, fail := 0, 0
	for i, r := range rows {
		key := keyOf(r)
		if key == "" || key == "M" || have[key] {
			continue
		}
		todo++
		if b.Bajadas+fail >= spotMaxConstancias {
			continue // queda para la siguiente descarga
		}
		if (b.Bajadas+fail) > 0 && s.pace > 0 {
			time.Sleep(s.pace)
		}
		var data []byte
		var cerr error
		for try := 0; try < 2; try++ {
			if masivo {
				data, cerr = api.constanciaMasiva(r["num_detr"])
			} else {
				data, cerr = api.constancia(key, i)
			}
			if cerr == nil {
				break
			}
			if s.pace > 0 {
				time.Sleep(time.Second)
			}
		}
		if cerr != nil {
			fail++
			continue
		}
		fname := "constancias/Constancia_" + reSpotFileSafe.ReplaceAllString(key, "") + ".html"
		if masivo {
			fname = "constancias/Constancia_Masivo_" + reSpotFileSafe.ReplaceAllString(r["num_detr"], "") + ".txt"
		}
		if err := add(fname, data); err != nil {
			return nil, err
		}
		b.Bajadas++
		got = append(got, key)
	}
	b.Pendientes = todo - b.Bajadas
	s.recordConstancias(companyID, userID, got)
	xlsx, err := SpotExcel(rows, f)
	if err != nil {
		return nil, err
	}
	if err := add(SpotReportName(f, ruc), xlsx); err != nil {
		return nil, err
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}
	b.Zip = buf.Bytes()
	var notes []string
	if fail > 0 {
		if fail == 1 {
			notes = append(notes, "1 constancia no se pudo bajar")
		} else {
			notes = append(notes, fmt.Sprintf("%d constancias no se pudieron bajar", fail))
		}
	}
	if left := b.Pendientes - fail; left > 0 {
		notes = append(notes, fmt.Sprintf("se bajaron %d constancias (tanda de %d); quedan %d por descargar: use «Descargar siguientes»", b.Bajadas, spotMaxConstancias, left))
	}
	if todo == 0 {
		notes = append(notes, "las constancias de estos pagos ya estaban descargadas; el Excel trae todos los pagos")
	}
	b.Aviso = strings.Join(notes, "; ")
	return b, nil
}

// recordConstancias anota las constancias que se bajaron (mejor esfuerzo: si falla no se pierde la descarga).
func (s *SunatSpotService) recordConstancias(companyID, userID uint, keys []string) {
	if len(keys) == 0 {
		return
	}
	rows := make([]models.DetraccionConstancia, 0, len(keys))
	for _, k := range keys {
		rows = append(rows, models.DetraccionConstancia{CompanyID: companyID, Numero: truncateStr(k, 24), RequestedBy: userID})
	}
	if err := database.DB.Clauses(clause.OnConflict{DoNothing: true}).Create(&rows).Error; err != nil {
		log.Printf("detracciones: no se pudo anotar las constancias bajadas de la empresa %d: %v", companyID, err)
	}
}

// Start valida la consulta, la deja «en proceso» en el historial de la empresa y la ejecuta en segundo plano.
func (s *SunatSpotService) Start(companyID uint, allowed []uint, userID uint, f SpotFilter) (*models.DetraccionDownload, error) {
	f, err := s.Validate(f)
	if err != nil {
		return nil, err
	}
	cred, err := s.creds.GetByCompanyID(companyID, allowed)
	if err != nil {
		return nil, err
	}
	s.expireStale(companyID)
	s.mu.Lock()
	var running int64
	database.DB.Model(&models.DetraccionDownload{}).Where("company_id = ? AND status = ?", companyID, models.DetraccionDownloadRunning).Count(&running)
	if running > 0 {
		s.mu.Unlock()
		return nil, accessErr(SunatAccessInProgress, "Ya hay una descarga de detracciones en proceso para esta empresa. Espere a que termine.", "")
	}
	row := models.DetraccionDownload{
		CompanyID: companyID, TipoCuenta: f.TipoCuenta, TipoPago: f.TipoPago, Modo: f.Modo, Desde: f.Desde, Hasta: f.Hasta, Periodo: f.Periodo,
		Status: models.DetraccionDownloadRunning, RequestedBy: userID,
	}
	if err := database.DB.Create(&row).Error; err != nil {
		s.mu.Unlock()
		return nil, err
	}
	s.mu.Unlock()

	if s.async {
		go s.run(row.ID, companyID, allowed, userID, f, cred.RUC)
	} else {
		s.run(row.ID, companyID, allowed, userID, f, cred.RUC)
	}
	return &row, nil
}

func (s *SunatSpotService) run(id, companyID uint, allowed []uint, userID uint, f SpotFilter, ruc string) {
	var b *spotBundle
	var err error
	func() {
		defer func() {
			if r := recover(); r != nil {
				log.Printf("detracciones: pánico en la descarga de la empresa %d: %v", companyID, r)
				b, err = nil, accessErr(SunatAccessUnexpected, "Falló la descarga de detracciones.", "error interno")
			}
		}()
		b, err = s.fetch(companyID, allowed, userID, f, ruc)
	}()
	s.finish(id, b, err)
}

// finish completa la fila del historial con el resultado o el error.
func (s *SunatSpotService) finish(id uint, b *spotBundle, qerr error) {
	upd := map[string]any{"finished_at": s.now()}
	switch {
	case qerr != nil:
		upd["status"] = models.DetraccionDownloadFailed
		var ae *SunatSolAccessError
		if errors.As(qerr, &ae) {
			upd["error_code"], upd["error_message"], upd["error_detail"] = truncateStr(ae.Code, 40), truncateStr(ae.Message, 600), truncateStr(ae.Detail, 600)
		} else {
			upd["error_message"] = "No se pudo completar la descarga."
		}
	case b != nil:
		upd["total"], upd["monto"], upd["bajadas"], upd["pendientes"], upd["aviso"] = b.Total, b.Monto, b.Bajadas, b.Pendientes, truncateStr(b.Aviso, 600)
		upd["status"] = models.DetraccionDownloadReady
		if b.Total == 0 {
			upd["status"] = models.DetraccionDownloadNoData
		} else {
			upd["zip"] = b.Zip
		}
	}
	var row models.DetraccionDownload
	if err := database.DB.First(&row, id).Error; err != nil {
		return // la quitaron del historial mientras corría
	}
	if err := database.DB.Model(&row).Updates(upd).Error; err != nil {
		log.Printf("detracciones: no se pudo guardar la descarga %d: %v", id, err)
		return
	}
	var ids []uint
	if err := database.DB.Model(&models.DetraccionDownload{}).Where("company_id = ?", row.CompanyID).
		Order("created_at DESC, id DESC").Offset(spotHistoryKeep).Pluck("id", &ids).Error; err == nil && len(ids) > 0 {
		_ = database.DB.Where("id IN ?", ids).Delete(&models.DetraccionDownload{}).Error
	}
}

// expireStale una descarga que lleva demasiado «en proceso» (por ejemplo, el servidor se reinició) se da por fallida.
func (s *SunatSpotService) expireStale(companyID uint) {
	limit := s.now().Add(-spotStaleAfter)
	_ = database.DB.Model(&models.DetraccionDownload{}).
		Where("company_id = ? AND status = ? AND created_at < ?", companyID, models.DetraccionDownloadRunning, limit).
		Updates(map[string]any{
			"status": models.DetraccionDownloadFailed, "error_code": "interrumpida", "finished_at": s.now(),
			"error_message": "La descarga se interrumpió antes de terminar. Vuelva a intentarla.",
		}).Error
}

// ListHistory historial de la empresa (lo más reciente primero), sin los archivos.
func (s *SunatSpotService) ListHistory(companyID uint) ([]models.DetraccionDownload, error) {
	s.expireStale(companyID)
	var rows []models.DetraccionDownload
	err := database.DB.Omit("zip").Where("company_id = ?", companyID).Order("created_at DESC, id DESC").Limit(spotHistoryKeep).Find(&rows).Error
	return rows, err
}

// GetZip los archivos guardados de una descarga (sin consultar a SUNAT otra vez).
func (s *SunatSpotService) GetZip(companyID, id uint) (*models.DetraccionDownload, []byte, error) {
	var row models.DetraccionDownload
	if err := database.DB.Where("id = ? AND company_id = ?", id, companyID).First(&row).Error; err != nil {
		return nil, nil, accessErr(SunatAccessInvalidParams, "No se encontró esa descarga.", fmt.Sprint(id))
	}
	if len(row.Zip) == 0 {
		return &row, nil, accessErr(SunatAccessInvalidParams, "Esa descarga no tiene archivos guardados.", fmt.Sprint(id))
	}
	return &row, row.Zip, nil
}

// ZipExcel saca el Excel del reporte del ZIP guardado.
func ZipExcel(data []byte) (name string, xlsx []byte, err error) {
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return "", nil, err
	}
	names := make([]string, 0, len(zr.File))
	for _, f := range zr.File {
		if strings.HasSuffix(strings.ToLower(f.Name), ".xlsx") {
			names = append(names, f.Name)
		}
	}
	sort.Strings(names)
	if len(names) == 0 {
		return "", nil, errors.New("el ZIP no trae el Excel")
	}
	for _, f := range zr.File {
		if f.Name == names[0] {
			rc, err := f.Open()
			if err != nil {
				return "", nil, err
			}
			defer rc.Close()
			b, err := io.ReadAll(io.LimitReader(rc, 64<<20))
			return f.Name, b, err
		}
	}
	return "", nil, errors.New("el ZIP no trae el Excel")
}

// DeleteHistory quita una descarga del historial (si estaba en proceso, su resultado se descarta al terminar).
func (s *SunatSpotService) DeleteHistory(companyID, id uint) error {
	res := database.DB.Where("id = ? AND company_id = ?", id, companyID).Delete(&models.DetraccionDownload{})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return accessErr(SunatAccessInvalidParams, "No se encontró esa descarga.", fmt.Sprint(id))
	}
	return nil
}

// ClearHistory vacía el historial de la empresa, menos lo que sigue en proceso, y devuelve cuántas quitó.
func (s *SunatSpotService) ClearHistory(companyID uint) (int64, error) {
	res := database.DB.Where("company_id = ? AND status <> ?", companyID, models.DetraccionDownloadRunning).Delete(&models.DetraccionDownload{})
	return res.RowsAffected, res.Error
}
