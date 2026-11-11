package services

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"miappfiber/database"
	"miappfiber/models"

	"github.com/xuri/excelize/v2"
	"gorm.io/gorm/clause"
)

// Descarga de comprobantes electrónicos (PDF, XML y CDR) desde el servicio de consulta de comprobantes de SUNAT
// (Menú SOL → Comprobantes de pago → Consulta de comprobantes de pago). Es el mismo servicio que usa el portal: con la
// clave SOL de la empresa se abre el menú, SUNAT entrega un token y con él se pide cada archivo. El PDF lo genera SUNAT.
// Solo lectura. Se consulta de a un comprobante, con una pausa, para no saturar la sesión SOL.

const (
	cpeMenuCode    = "11.38.1.1.1"
	cpeConsultaBase     = "https://api-cpe.sunat.gob.pe/v1/contribuyente/consultacpe/comprobantes/"
	cpeMaxPerBatch = 300
	cpePause       = 700 * time.Millisecond
	cpeReopenEvery = 60 // se abre otra sesión SOL cada tantos comprobantes (el token no dura para siempre)
	cpeStaleAfter  = 45 * time.Minute

	cpeFileCodePDF = "01"
	cpeFileCodeXML = "02"
	cpeFileCodeCDR = "03"
)

// cpePauseBetween se puede reemplazar en pruebas.
var cpePauseBetween = cpePause

// CpeRef identifica un comprobante.
type CpeRef struct {
	Ruc    string `json:"ruc"` // RUC del emisor
	Tipo   string `json:"tipo"`
	Serie  string `json:"serie"`
	Numero string `json:"numero"`
	Libro  string `json:"libro,omitempty"`
	Period string `json:"period,omitempty"`
}

var (
	reCpeSerie  = regexp.MustCompile(`^[A-Z0-9]{4}$`)
	reDigits    = regexp.MustCompile(`^\d+$`)
	cpeTipoName = map[string]string{"01": "Factura", "03": "Boleta de venta", "07": "Nota de crédito", "08": "Nota de débito"}
)

// CpeTipoValido dice si el tipo es uno de los comprobantes electrónicos que SUNAT entrega.
func CpeTipoValido(t string) bool { _, ok := cpeTipoName[t]; return ok }

// normalizeCpeRef limpia y valida el comprobante (tipo de 2 dígitos, serie en mayúsculas, número sin ceros a la izquierda).
func normalizeCpeRef(r CpeRef) (CpeRef, error) {
	r.Ruc, r.Serie = strings.TrimSpace(r.Ruc), strings.ToUpper(strings.TrimSpace(r.Serie))
	r.Tipo, r.Numero = strings.TrimSpace(r.Tipo), strings.TrimSpace(r.Numero)
	if len(r.Tipo) == 1 {
		r.Tipo = "0" + r.Tipo
	}
	bad := func(msg string) (CpeRef, error) {
		return r, sireErr(SireErrInvalidParams, msg, fmt.Sprintf("%s-%s-%s-%s", r.Ruc, r.Tipo, r.Serie, r.Numero))
	}
	if len(r.Ruc) != 11 || !reDigits.MatchString(r.Ruc) {
		return bad("El RUC del emisor debe tener 11 dígitos.")
	}
	if !CpeTipoValido(r.Tipo) {
		return bad("Solo se pueden bajar facturas (01), boletas (03), notas de crédito (07) y notas de débito (08).")
	}
	if !reCpeSerie.MatchString(r.Serie) {
		return bad("La serie debe tener 4 caracteres, por ejemplo F001 o E001.")
	}
	n := strings.TrimLeft(r.Numero, "0")
	if n == "" || len(n) > 8 || !reDigits.MatchString(n) {
		return bad("El número del comprobante no es válido.")
	}
	r.Numero = n
	return r, nil
}

// CpeStartResult lo que quedó registrado en una solicitud.
type CpeStartResult struct {
	Items   []models.SireCpeFile `json:"items"`
	Skipped int                  `json:"skipped"` // los que no son comprobantes electrónicos descargables (p. ej. recibos o notas de venta)
	Ready   int                  `json:"ready"`   // los que ya estaban bajados
}

var cpeCompanyLocks sync.Map // companyID → *sync.Mutex: una sola sesión SOL a la vez por empresa

func cpeLock(companyID uint) *sync.Mutex {
	m, _ := cpeCompanyLocks.LoadOrStore(companyID, &sync.Mutex{})
	return m.(*sync.Mutex)
}

type SireCpeService struct {
	sol    *SunatSolAccessService
	creds  *CompanyAccessCredentialService
	apiURL string
	// openFn abre la sesión SOL y devuelve el token del servicio (en pruebas se reemplaza).
	openFn func(companyID uint, allowed []uint, userID uint) (cpeSession, error)
}

// cpeSession lo mínimo que hace falta para pedir archivos.
type cpeSession interface {
	get(u string) (status int, body []byte, err error)
	close()
}

func NewSireCpeService() *SireCpeService {
	s := &SireCpeService{sol: NewSunatSolAccessService(), creds: NewCompanyAccessCredentialService(), apiURL: cpeConsultaBase}
	s.openFn = s.openSol
	return s
}

// InScope valida que la empresa esté en el alcance del usuario y devuelve su RUC.
func (s *SireCpeService) InScope(companyID uint, allowed []uint) (string, error) {
	row, err := s.creds.GetByCompanyID(companyID, allowed)
	if err != nil {
		return "", sireErr(SireErrOutOfScope, "No tiene acceso a esta empresa.", err.Error())
	}
	return strings.TrimSpace(row.RUC), nil
}

type solCpeSession struct {
	sess  *solMenuSession
	token string
}

func (c *solCpeSession) get(u string) (int, []byte, error) {
	resp, body, err := c.sess.do(http.MethodGet, u, nil, "", map[string]string{"Authorization": "Bearer " + c.token, "Accept": "application/json"})
	if err != nil {
		return 0, nil, err
	}
	return resp.StatusCode, body, nil
}
func (c *solCpeSession) close() { c.sess.close() }

func (s *SireCpeService) openSol(companyID uint, allowed []uint, userID uint) (cpeSession, error) {
	res, err := s.sol.Generate(companyID, allowed, userID, sunatAccessTargetSunat)
	if err != nil {
		return nil, err
	}
	sess, err := openSolMenu(res.URL, 60*time.Second)
	if err != nil {
		return nil, err
	}
	r0, page, err := sess.execute(cpeMenuCode)
	if err != nil {
		sess.close()
		return nil, err
	}
	token := r0.Request.URL.Query().Get("token")
	if token == "" {
		sess.close()
		return nil, accessErr(SunatAccessUnexpected, "SUNAT no abrió la consulta de comprobantes (la empresa podría no tener acceso a ese servicio).",
			"CPE: sin token "+truncateStr(htmlText(sunatBodyToUTF8(page)), 200))
	}
	return &solCpeSession{sess: sess, token: token}, nil
}

// Start registra los comprobantes y los baja en segundo plano. Los que ya están bajados no se piden otra vez.
func (s *SireCpeService) Start(companyID uint, allowed []uint, userID uint, refs []CpeRef) (*CpeStartResult, error) {
	ruc, err := s.InScope(companyID, allowed)
	if err != nil {
		return nil, err
	}
	if len(refs) == 0 {
		return nil, sireErr(SireErrInvalidParams, "No hay comprobantes para descargar.", "")
	}
	if len(refs) > cpeMaxPerBatch {
		return nil, sireErr(SireErrInvalidParams, fmt.Sprintf("El máximo es de %d comprobantes por vez.", cpeMaxPerBatch), strconv.Itoa(len(refs)))
	}
	s.expireStale(companyID)
	out := &CpeStartResult{Items: []models.SireCpeFile{}}
	seen := map[string]bool{}
	started := false
	for _, r := range refs {
		n, nerr := normalizeCpeRef(r)
		if nerr != nil {
			return nil, nerr
		}
		key := n.Ruc + n.Tipo + n.Serie + n.Numero
		if seen[key] {
			continue
		}
		seen[key] = true
		lado := "receptor"
		if n.Ruc == ruc {
			lado = "emisor"
		}
		row := models.SireCpeFile{CompanyID: companyID, Ruc: n.Ruc, Tipo: n.Tipo, Serie: n.Serie, Numero: n.Numero, Lado: lado,
			Libro: n.Libro, Period: n.Period, Status: models.SireCpeProcessing, RequestedBy: userID}
		var cur models.SireCpeFile
		qerr := database.DB.Omit("pdf", "xml", "cdr").Where("company_id = ? AND ruc = ? AND tipo = ? AND serie = ? AND numero = ?",
			companyID, n.Ruc, n.Tipo, n.Serie, n.Numero).First(&cur).Error
		switch {
		case qerr == nil && cur.Status == models.SireCpeReady:
			out.Ready++
			out.Items = append(out.Items, cur)
			continue
		case qerr == nil && cur.Status == models.SireCpeProcessing:
			out.Items = append(out.Items, cur)
			continue
		case qerr == nil: // sin_cpe o error: se vuelve a intentar
			database.DB.Model(&models.SireCpeFile{}).Where("id = ?", cur.ID).Updates(map[string]any{
				"status": models.SireCpeProcessing, "error_message": "", "finished_at": nil, "requested_by": userID, "lado": lado})
			cur.Status, cur.ErrorMessage, cur.FinishedAt = models.SireCpeProcessing, "", nil
			out.Items = append(out.Items, cur)
			started = true
			continue
		}
		if err := database.DB.Clauses(clause.OnConflict{DoNothing: true}).Create(&row).Error; err != nil {
			return nil, err
		}
		out.Items = append(out.Items, row)
		started = true
	}
	if started {
		go s.run(companyID, allowed, userID)
	}
	return out, nil
}

func (s *SireCpeService) expireStale(companyID uint) {
	database.DB.Model(&models.SireCpeFile{}).
		Where("company_id = ? AND status = ? AND created_at < ?", companyID, models.SireCpeProcessing, time.Now().Add(-cpeStaleAfter)).
		Updates(map[string]any{"status": models.SireCpeFailed, "error_message": "La descarga se interrumpió antes de terminar. Vuelva a pedirla.", "finished_at": time.Now()})
}

// cpeFile pide un archivo (01 PDF, 02 XML, 03 CDR) y lo devuelve ya sin el ZIP.
// ok=false y msg vacío: SUNAT no lo tiene; err: no se pudo preguntar.
func (s *SireCpeService) cpeFile(sess cpeSession, id string, code string) (data []byte, msg string, err error) {
	status, body, gerr := sess.get(s.apiURL + id + "/" + code)
	if gerr != nil {
		return nil, "", gerr
	}
	if status == http.StatusUnauthorized || status == http.StatusForbidden {
		return nil, "", errCpeToken
	}
	if status != http.StatusOK {
		return nil, cpeErrorMessage(body, status), nil
	}
	var d struct {
		NomArchivo string `json:"nomArchivo"`
		ValArchivo string `json:"valArchivo"`
	}
	if json.Unmarshal(body, &d) != nil || d.ValArchivo == "" {
		return nil, "SUNAT no entregó el archivo.", nil
	}
	raw, derr := base64.StdEncoding.DecodeString(d.ValArchivo)
	if derr != nil {
		if raw, derr = base64.RawStdEncoding.DecodeString(d.ValArchivo); derr != nil {
			return nil, "", fmt.Errorf("el archivo de SUNAT no se pudo decodificar")
		}
	}
	return unzipFirst(raw), "", nil
}

var errCpeToken = errors.New("sesión SOL vencida")

// unzipFirst devuelve el primer archivo del ZIP (o los mismos bytes si no es un ZIP).
func unzipFirst(raw []byte) []byte {
	if len(raw) < 4 || raw[0] != 'P' || raw[1] != 'K' {
		return raw
	}
	zr, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		return raw
	}
	for _, f := range zr.File {
		if f.FileInfo().IsDir() {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			return raw
		}
		b, err := io.ReadAll(io.LimitReader(rc, 64<<20))
		rc.Close()
		if err != nil {
			return raw
		}
		return b
	}
	return raw
}

// cpeErrorMessage el motivo que da SUNAT cuando no entrega el archivo.
func cpeErrorMessage(body []byte, status int) string {
	var e struct {
		Message string `json:"message"`
		Msg     string `json:"msg"`
		Errors  []struct {
			CodError string `json:"codError"`
			DesError string `json:"desError"`
		} `json:"errors"`
	}
	if json.Unmarshal(body, &e) == nil {
		if len(e.Errors) > 0 && e.Errors[0].DesError != "" {
			return truncateStr(e.Errors[0].DesError, 300)
		}
		if e.Msg != "" {
			return truncateStr(e.Msg, 300)
		}
		if e.Message != "" {
			return truncateStr(e.Message, 300)
		}
	}
	return fmt.Sprintf("SUNAT respondió HTTP %d.", status)
}

// run baja todo lo que está «en proceso» de la empresa, de a un comprobante, con una sola sesión SOL a la vez.
func (s *SireCpeService) run(companyID uint, allowed []uint, userID uint) {
	mu := cpeLock(companyID)
	mu.Lock()
	defer mu.Unlock()

	ruc, err := s.InScope(companyID, allowed)
	if err != nil {
		return
	}
	var sess cpeSession
	closeSess := func() {
		if sess != nil {
			sess.close()
			sess = nil
		}
	}
	defer closeSess()
	served := 0
	failAll := func(e error) {
		msg := "No se pudo entrar a SOL."
		var ae *SunatSolAccessError
		if errors.As(e, &ae) {
			msg = ae.Message
		}
		database.DB.Model(&models.SireCpeFile{}).Where("company_id = ? AND status = ?", companyID, models.SireCpeProcessing).
			Updates(map[string]any{"status": models.SireCpeFailed, "error_message": truncateStr(msg, 600), "finished_at": time.Now()})
	}

	for {
		var row models.SireCpeFile
		if err := database.DB.Omit("pdf", "xml", "cdr").Where("company_id = ? AND status = ?", companyID, models.SireCpeProcessing).
			Order("id").First(&row).Error; err != nil {
			return // no queda nada pendiente
		}
		if sess == nil || served >= cpeReopenEvery {
			closeSess()
			ns, oerr := s.openFn(companyID, allowed, userID)
			if oerr != nil {
				failAll(oerr)
				return
			}
			sess, served = ns, 0
		}
		filtro := "2"
		if row.Ruc == ruc {
			filtro = "1"
		}
		id := fmt.Sprintf("%s-%s-%s-%s-%s", row.Ruc, row.Tipo, url.PathEscape(row.Serie), row.Numero, filtro)

		files := map[string][]byte{}
		var lastMsg string
		var terr error
		for _, code := range []string{cpeFileCodePDF, cpeFileCodeXML, cpeFileCodeCDR} {
			data, msg, ferr := s.cpeFile(sess, id, code)
			if errors.Is(ferr, errCpeToken) { // el token venció: se abre otra sesión y se reintenta este comprobante una vez
				closeSess()
				ns, oerr := s.openFn(companyID, allowed, userID)
				if oerr != nil {
					failAll(oerr)
					return
				}
				sess, served = ns, 0
				data, msg, ferr = s.cpeFile(sess, id, code)
			}
			if ferr != nil {
				terr = ferr
				break
			}
			if len(data) > 0 {
				files[code] = data
			} else if msg != "" {
				lastMsg = msg
			}
			time.Sleep(cpePauseBetween)
		}
		served++

		now := time.Now()
		upd := map[string]any{"finished_at": now}
		switch {
		case terr != nil:
			upd["status"], upd["error_message"] = models.SireCpeFailed, truncateStr("No se pudo consultar a SUNAT: "+terr.Error(), 600)
			closeSess() // la próxima vez entra con una sesión nueva
		case len(files) == 0:
			if lastMsg == "" {
				lastMsg = "SUNAT no tiene archivos de este comprobante."
			}
			upd["status"], upd["error_message"] = models.SireCpeMissing, truncateStr(lastMsg, 600)
		default:
			upd["status"], upd["error_message"] = models.SireCpeReady, ""
			upd["pdf"], upd["xml"], upd["cdr"] = files[cpeFileCodePDF], files[cpeFileCodeXML], files[cpeFileCodeCDR]
			upd["has_pdf"], upd["has_xml"], upd["has_cdr"] = len(files[cpeFileCodePDF]) > 0, len(files[cpeFileCodeXML]) > 0, len(files[cpeFileCodeCDR]) > 0
		}
		database.DB.Model(&models.SireCpeFile{}).Where("id = ?", row.ID).Updates(upd)
	}
}

// List comprobantes de la empresa (lo más reciente primero); libro/period vacíos = todos.
func (s *SireCpeService) List(companyID uint, libro, period string) ([]models.SireCpeFile, error) {
	s.expireStale(companyID)
	q := database.DB.Omit("pdf", "xml", "cdr").Where("company_id = ?", companyID)
	if l := strings.ToLower(strings.TrimSpace(libro)); l != "" {
		q = q.Where("libro = ?", l)
	}
	if p := strings.TrimSpace(period); p != "" {
		q = q.Where("period = ?", p)
	}
	var rows []models.SireCpeFile
	if err := q.Order("id DESC").Limit(1000).Find(&rows).Error; err != nil {
		return nil, err
	}
	return rows, nil
}

// File devuelve un archivo del comprobante (kind: pdf, xml o cdr), su nombre y su tipo de contenido.
func (s *SireCpeService) File(companyID, id uint, kind string) ([]byte, string, string, error) {
	var row models.SireCpeFile
	if err := database.DB.Where("id = ? AND company_id = ?", id, companyID).First(&row).Error; err != nil {
		return nil, "", "", sireErr(SireErrInvalidParams, "No se encontró ese comprobante.", fmt.Sprint(id))
	}
	data, name, ctype := cpeRowFile(row, kind)
	if len(data) == 0 {
		return nil, "", "", sireErr(SireErrInvalidParams, "Ese comprobante no tiene ese archivo.", kind)
	}
	return data, name, ctype, nil
}

func cpeBaseName(r models.SireCpeFile) string {
	return fmt.Sprintf("%s-%s-%s-%08s", r.Ruc, r.Tipo, r.Serie, r.Numero)
}

func cpeRowFile(r models.SireCpeFile, kind string) (data []byte, name, ctype string) {
	base := cpeBaseName(r)
	switch strings.ToLower(kind) {
	case "pdf":
		return r.PDF, base + ".pdf", "application/pdf"
	case "xml":
		return r.XML, base + ".xml", "application/xml"
	case "cdr":
		return r.CDR, "R-" + base + ".xml", "application/xml"
	}
	return nil, "", ""
}

// Zip arma un ZIP con los archivos de los comprobantes pedidos (ids vacíos = todos los listos del libro/periodo).
func (s *SireCpeService) Zip(companyID uint, ids []uint, libro, period string) ([]byte, int, error) {
	q := database.DB.Where("company_id = ? AND status = ?", companyID, models.SireCpeReady)
	if len(ids) > 0 {
		q = q.Where("id IN ?", ids)
	}
	if l := strings.ToLower(strings.TrimSpace(libro)); l != "" {
		q = q.Where("libro = ?", l)
	}
	if p := strings.TrimSpace(period); p != "" {
		q = q.Where("period = ?", p)
	}
	var rows []models.SireCpeFile
	if err := q.Order("id").Limit(cpeMaxPerBatch * 4).Find(&rows).Error; err != nil {
		return nil, 0, err
	}
	if len(rows) == 0 {
		return nil, 0, sireErr(SireErrInvalidParams, "No hay comprobantes descargados para empaquetar.", "")
	}
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for _, r := range rows {
		for _, kind := range []string{"pdf", "xml", "cdr"} {
			data, name, _ := cpeRowFile(r, kind)
			if len(data) == 0 {
				continue
			}
			w, err := zw.Create(name)
			if err != nil {
				return nil, 0, err
			}
			if _, err := w.Write(data); err != nil {
				return nil, 0, err
			}
		}
	}
	if err := zw.Close(); err != nil {
		return nil, 0, err
	}
	return buf.Bytes(), len(rows), nil
}

// Delete quita un comprobante guardado.
func (s *SireCpeService) Delete(companyID, id uint) error {
	res := database.DB.Where("id = ? AND company_id = ?", id, companyID).Delete(&models.SireCpeFile{})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return sireErr(SireErrInvalidParams, "No se encontró ese comprobante.", fmt.Sprint(id))
	}
	return nil
}

// RefsFromDownload lee el Excel de una consulta SIRE lista y arma la lista de comprobantes descargables. Devuelve
// además cuántas filas se dejaron fuera (recibos, notas de venta, boletas resumidas por rango, etc.).
func (s *SireCpeService) RefsFromDownload(companyID, downloadID uint, ruc string) ([]CpeRef, int, error) {
	var dl models.SireDownload
	if err := database.DB.Where("id = ? AND company_id = ?", downloadID, companyID).First(&dl).Error; err != nil {
		return nil, 0, sireErr(SireErrInvalidParams, "No se encontró esa consulta del SIRE.", fmt.Sprint(downloadID))
	}
	if dl.Status != models.SireDownloadReady || len(dl.Data) == 0 {
		return nil, 0, sireErr(SireErrInvalidParams, "Esa consulta del SIRE no tiene una propuesta lista.", dl.Status)
	}
	return cpeRefsFromExcel(dl.Data, dl.Libro, dl.Period, ruc)
}

func cpeRefsFromExcel(xlsx []byte, libro, period, ownRuc string) ([]CpeRef, int, error) {
	f, err := excelize.OpenReader(bytes.NewReader(xlsx))
	if err != nil {
		return nil, 0, sireErr(SireErrUnexpected, "No se pudo leer la propuesta guardada.", err.Error())
	}
	defer f.Close()
	rows, err := f.GetRows(f.GetSheetName(0))
	if err != nil || len(rows) < 2 {
		return nil, 0, sireErr(SireErrInvalidParams, "La propuesta no tiene comprobantes.", "")
	}
	col := map[string]int{}
	for i, h := range rows[0] {
		col[strings.ToLower(strings.TrimSpace(h))] = i
	}
	need := func(names ...string) int {
		for _, n := range names {
			if i, ok := col[n]; ok {
				return i
			}
		}
		return -1
	}
	cTipo := need("tipo cp/doc.", "tipo cp/doc")
	cSerie := need("serie del cdp")
	cNum := need("nro cp o doc. nro inicial (rango)", "nro cp o doc. nro inicial")
	cFin := need("nro final (rango)")
	cDoc := need("nro doc identidad")
	cTDoc := need("tipo doc identidad")
	if cTipo < 0 || cSerie < 0 || cNum < 0 {
		return nil, 0, sireErr(SireErrUnexpected, "La propuesta no trae las columnas de tipo, serie y número.", "")
	}
	cell := func(r []string, i int) string {
		if i < 0 || i >= len(r) {
			return ""
		}
		return strings.TrimSpace(r[i])
	}
	var refs []CpeRef
	skipped := 0
	for _, r := range rows[1:] {
		tipo := cell(r, cTipo)
		if len(tipo) == 1 {
			tipo = "0" + tipo
		}
		fin := strings.TrimLeft(cell(r, cFin), "0")
		num := strings.TrimLeft(cell(r, cNum), "0")
		if !CpeTipoValido(tipo) || (fin != "" && fin != num) { // rangos de boletas: no son un comprobante individual
			skipped++
			continue
		}
		emisor := ownRuc
		if libro == sireLibroCompras {
			emisor = cell(r, cDoc)
			if t := cell(r, cTDoc); t != "" && t != "6" { // el emisor debe tener RUC
				skipped++
				continue
			}
		}
		ref := CpeRef{Ruc: emisor, Tipo: tipo, Serie: cell(r, cSerie), Numero: num, Libro: libro, Period: period}
		if _, nerr := normalizeCpeRef(ref); nerr != nil {
			skipped++
			continue
		}
		refs = append(refs, ref)
	}
	if len(refs) == 0 {
		return nil, skipped, sireErr(SireErrInvalidParams, "La propuesta no tiene facturas, boletas ni notas descargables.", "")
	}
	return refs, skipped, nil
}
