package services

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"miappfiber/models"
)

// fakeSire simula api-seguridad (token) y api-sire (libros) de SUNAT.
type fakeSire struct {
	srv         *httptest.Server
	tokenHits   int32
	tokenStatus int
	tokenForm   map[string]string
	lastAuth    string
	lastPath    string
	lastQuery   string
	lastMethod  string
	apiHits     int32
	handler     func(w http.ResponseWriter, r *http.Request)
}

func newFakeSire(t *testing.T) *fakeSire {
	t.Helper()
	f := &fakeSire{tokenStatus: http.StatusOK}
	mux := http.NewServeMux()
	mux.HandleFunc("/clientessol/", func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&f.tokenHits, 1)
		_ = r.ParseForm()
		f.tokenForm = map[string]string{"path": r.URL.Path}
		for k := range r.PostForm {
			f.tokenForm[k] = r.PostForm.Get(k)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(f.tokenStatus)
		if f.tokenStatus == http.StatusOK {
			_, _ = w.Write([]byte(`{"access_token":"TOK-` + string(rune('A'+atomic.LoadInt32(&f.tokenHits))) + `","token_type":"Bearer","expires_in":3600}`))
		} else {
			_, _ = w.Write([]byte(`{"error":"invalid_grant","error_description":"credenciales invalidas"}`))
		}
	})
	mux.HandleFunc("/v1/contribuyente/migeigv/libros/", func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&f.apiHits, 1)
		f.lastAuth, f.lastPath, f.lastQuery, f.lastMethod = r.Header.Get("Authorization"), strings.TrimPrefix(r.URL.Path, "/v1/contribuyente/migeigv/libros/"), r.URL.RawQuery, r.Method
		if f.handler != nil {
			f.handler(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[]`))
	})
	f.srv = httptest.NewServer(mux)
	t.Cleanup(f.srv.Close)
	return f
}

func (f *fakeSire) session(t *testing.T, companyID uint) *SireSession {
	t.Helper()
	svc := NewSireService()
	svc.tokenBase = f.srv.URL + "/clientessol"
	svc.apiBase = f.srv.URL
	ss, err := svc.SessionFromCreds(SireCreds{CompanyID: companyID, RUC: "20123456789", SolUsuario: "USUARIO1", SolClave: "clave-sol", ClientID: "cid-123", ClientSecret: "secreto"})
	if err != nil {
		t.Fatalf("SessionFromCreds: %v", err)
	}
	return ss
}

func TestSire_TokenConUsuarioConcatenadoYCache(t *testing.T) {
	f := newFakeSire(t)
	ss := f.session(t, 1)
	for i := 0; i < 2; i++ {
		if _, err := ss.Periods(sireLibroVentas); err != nil {
			t.Fatalf("Periods: %v", err)
		}
	}
	if f.tokenHits != 1 {
		t.Errorf("el token debe reutilizarse: %d pedidos", f.tokenHits)
	}
	want := map[string]string{
		"grant_type": "password", "scope": "https://api-sire.sunat.gob.pe", "client_id": "cid-123",
		"client_secret": "secreto", "username": "20123456789USUARIO1", "password": "clave-sol",
	}
	for k, v := range want {
		if f.tokenForm[k] != v {
			t.Errorf("token %s = %q, quiero %q", k, f.tokenForm[k], v)
		}
	}
	if !strings.HasSuffix(f.tokenForm["path"], "/cid-123/oauth2/token/") {
		t.Errorf("ruta del token: %s", f.tokenForm["path"])
	}
	if !strings.HasPrefix(f.lastAuth, "Bearer TOK-") {
		t.Errorf("Authorization = %q", f.lastAuth)
	}
	if f.lastPath != "rvierce/padron/web/omisos/140000/periodos" {
		t.Errorf("ruta de períodos: %s", f.lastPath)
	}
}

func TestSire_CredencialesRechazadasPausaElReintento(t *testing.T) {
	f := newFakeSire(t)
	f.tokenStatus = http.StatusBadRequest
	ss := f.session(t, 2)
	_, err := ss.Periods(sireLibroCompras)
	var se *SireError
	if !errors.As(err, &se) || se.Code != SireErrBadCreds {
		t.Fatalf("se esperaba credenciales_api_invalidas, llegó %v", err)
	}
	if strings.Contains(se.Detail, "secreto") || strings.Contains(se.Detail, "clave-sol") {
		t.Errorf("el detalle no debe filtrar credenciales: %q", se.Detail)
	}
	_, err = ss.Periods(sireLibroCompras)
	if !errors.As(err, &se) || se.Code != SireErrCooldown {
		t.Fatalf("se esperaba pausa, llegó %v", err)
	}
	if f.tokenHits != 1 {
		t.Errorf("no debe volver a pedir token durante la pausa: %d", f.tokenHits)
	}
}

func TestSire_FaltanDatos(t *testing.T) {
	svc := NewSireService()
	_, err := svc.SessionFromCreds(SireCreds{CompanyID: 3, RUC: "20123456789", SolUsuario: "U", SolClave: "C"})
	var se *SireError
	if !errors.As(err, &se) || se.Code != SireErrMissingData || !strings.Contains(se.Message, "Client ID") {
		t.Fatalf("se esperaba faltan_datos con Client ID, llegó %v", err)
	}
}

func TestSire_Error422MuestraElMensajeDeSunat(t *testing.T) {
	f := newFakeSire(t)
	f.handler = func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnprocessableEntity)
		_, _ = w.Write([]byte(`{"cod":"422","msg":"Unprocessable","errors":[{"cod":"1070","msg":"No se ha encontrado información de comprobantes de pago en Periodo Seleccionado"}]}`))
	}
	ss := f.session(t, 4)
	_, err := ss.Summary(sireLibroVentas, "202609", "1", "1")
	var se *SireError
	if !errors.As(err, &se) || se.Code != SireErrValidation || !strings.Contains(se.Message, "No se ha encontrado") {
		t.Fatalf("422 mal traducido: %v", err)
	}
}

func TestSire_TokenVencidoSeRenuevaUnaVez(t *testing.T) {
	f := newFakeSire(t)
	var n int32
	f.handler = func(w http.ResponseWriter, r *http.Request) {
		if atomic.AddInt32(&n, 1) == 1 {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		_, _ = w.Write([]byte(`[]`))
	}
	ss := f.session(t, 5)
	if _, err := ss.Periods(sireLibroVentas); err != nil {
		t.Fatalf("Periods: %v", err)
	}
	if f.tokenHits != 2 {
		t.Errorf("se esperaban 2 tokens (el vencido y el nuevo), hubo %d", f.tokenHits)
	}
}

func TestSire_RequestTicketArmaLaPeticionSegunElManual(t *testing.T) {
	f := newFakeSire(t)
	f.handler = func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"numTicket":"20260100000123"}`))
	}
	ss := f.session(t, 6)

	tk, err := ss.RequestTicket(sireLibroVentas, "propuesta", "202609", map[string]string{"tipo_archivo": "0"})
	if err != nil || tk != "20260100000123" {
		t.Fatalf("ventas propuesta: %v %q", err, tk)
	}
	if f.lastPath != "rvie/propuesta/web/propuesta/202609/exportapropuesta" || f.lastQuery != "codTipoArchivo=0" || f.lastMethod != http.MethodGet {
		t.Errorf("ventas propuesta: %s %s?%s", f.lastMethod, f.lastPath, f.lastQuery)
	}

	if _, err = ss.RequestTicket(sireLibroCompras, "propuesta", "202609", map[string]string{"tipo_archivo": "1"}); err != nil {
		t.Fatalf("compras propuesta: %v", err)
	}
	if f.lastPath != "rce/propuesta/web/propuesta/202609/exportacioncomprobantepropuesta" ||
		!strings.Contains(f.lastQuery, "codTipoArchivo=1") || !strings.Contains(f.lastQuery, "codOrigenEnvio=2") {
		t.Errorf("compras propuesta: %s?%s", f.lastPath, f.lastQuery)
	}

	if _, err = ss.RequestTicket(sireLibroVentas, "registro", "202609", map[string]string{"cod_proceso": "22"}); err != nil {
		t.Fatalf("registro: %v", err)
	}
	if f.lastPath != "rvierce/gestionlibro/web/registroslibros/descarga" || !strings.Contains(f.lastQuery, "codProceso=22") || !strings.Contains(f.lastQuery, "codLibro=140000") {
		t.Errorf("registro: %s?%s", f.lastPath, f.lastQuery)
	}

	if _, err = ss.RequestTicket(sireLibroCompras, "car", "202609", nil); err == nil {
		t.Errorf("CAR sin fase debe fallar")
	}
	if _, err = ss.RequestTicket(sireLibroVentas, "propuesta", "2026-09", nil); err == nil {
		t.Errorf("período inválido debe fallar")
	}
	if _, err = ss.RequestTicket(sireLibroVentas, "preliminar_nd", "202609", nil); err == nil {
		t.Errorf("preliminar_nd no existe en ventas")
	}
}

func TestSire_ReintentaConOrigen1CuandoSunatRechazaElOrigen2(t *testing.T) {
	f := newFakeSire(t)
	f.handler = func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("codOrigenEnvio") == "2" {
			w.WriteHeader(http.StatusUnprocessableEntity)
			_, _ = w.Write([]byte(`{"cod":"422","errors":[{"cod":"1029","msg":"Código tipo de Origen de Envio no permitido o no valido"}]}`))
			return
		}
		_, _ = w.Write([]byte(`{"numTicket":"20260100000999"}`))
	}
	ss := f.session(t, 7)
	tk, err := ss.RequestTicket(sireLibroCompras, "propuesta", "202609", nil)
	if err != nil || tk != "20260100000999" {
		t.Fatalf("reintento con origen 1: %v %q", err, tk)
	}
	if f.apiHits != 2 {
		t.Errorf("se esperaban 2 llamadas, hubo %d", f.apiHits)
	}
}

func zipOf(t *testing.T, files map[string]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for name, content := range files {
		w, _ := zw.Create(name)
		_, _ = w.Write([]byte(content))
	}
	_ = zw.Close()
	return buf.Bytes()
}

func TestSire_TicketFileSeGuardaEnCacheYSeParsea(t *testing.T) {
	f := newFakeSire(t)
	archive := zipOf(t, map[string]string{
		"LE20123456789202609140400.txt": "Ruc|Periodo|Serie|Numero|Total\n20123456789|202609|F001|15|118.00\n20123456789|202609|F001|16|59.00\n",
	})
	f.handler = func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write(archive) }
	ss := f.session(t, 8)
	p := TicketFileParams{Libro: sireLibroVentas, Name: "a.zip", TypeCode: "01", Period: "202609", Proceso: "10", Ticket: "20260100000123"}
	for i := 0; i < 2; i++ {
		if _, err := ss.TicketFile(p); err != nil {
			t.Fatalf("TicketFile: %v", err)
		}
	}
	if f.apiHits != 1 {
		t.Errorf("el archivo debe quedar en caché: %d llamadas", f.apiHits)
	}
	if f.lastPath != "rvierce/gestionprocesosmasivos/web/masivo/archivoreporte" ||
		!strings.Contains(f.lastQuery, "nomArchivoReporte=a.zip") || !strings.Contains(f.lastQuery, "numTicket=20260100000123") || !strings.Contains(f.lastQuery, "codLibro=140000") {
		t.Errorf("descarga de archivo: %s?%s", f.lastPath, f.lastQuery)
	}
	tables, err := ParseSireArchive(archive, "a.zip")
	if err != nil || len(tables) != 1 {
		t.Fatalf("parse: %v %d", err, len(tables))
	}
	tb := tables[0]
	if len(tb.Columns) != 5 || tb.Total != 2 || tb.Rows[1][4] != "59.00" {
		t.Errorf("tabla mal leída: %+v", tb)
	}
	pg := tb.Page(1, 10, "f001|16")
	if pg.Filtered != 0 {
		t.Errorf("el filtro busca texto contiguo de la fila")
	}
	if pg = tb.Page(1, 10, "118"); pg.Filtered != 1 || pg.Rows[0][3] != "15" {
		t.Errorf("filtro: %+v", pg)
	}
}

func TestSire_ParseCsvLatin1YSeparadores(t *testing.T) {
	csvLatin1 := "Raz\xf3n Social,Monto,Porcentaje\n\"Los constructores, SAC\",127000,16%\n"
	tables, err := ParseSireArchive([]byte(csvLatin1), "resumen.csv")
	if err != nil || len(tables) != 1 {
		t.Fatalf("parse csv: %v", err)
	}
	if tables[0].Columns[0] != "Razón Social" || tables[0].Rows[0][0] != "Los constructores, SAC" || len(tables[0].Rows[0]) != 3 {
		t.Errorf("csv mal leído: %+v", tables[0])
	}
	pdf, _ := ParseSireArchive([]byte("%PDF-1.4 ..."), "x.pdf")
	if len(pdf) != 0 {
		t.Errorf("un PDF no es una tabla")
	}
}

func TestSire_CumplimientoDevuelvePdfDesdeBase64(t *testing.T) {
	f := newFakeSire(t)
	pdf := []byte("%PDF-1.4 contenido")
	f.handler = func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"archivoPdf":"` + base64.StdEncoding.EncodeToString(pdf) + `","nombreArchivoPdf":"cumplimiento"}`))
	}
	ss := f.session(t, 9)
	file, err := ss.DirectFile(sireLibroVentas, "cumplimiento", "202609", nil)
	if err != nil {
		t.Fatalf("DirectFile: %v", err)
	}
	if file.ContentType != "application/pdf" || file.Name != "cumplimiento.pdf" || !bytes.Equal(file.Data, pdf) {
		t.Errorf("pdf mal armado: %+v", file)
	}
	if f.lastPath != "rvierce/cumplimiento/web/omisos/202609/140000/consultaReporteCumplimiento/exportardocumento" {
		t.Errorf("ruta: %s", f.lastPath)
	}
}

func TestSire_ResumenInconsistenciasUsaMetodoSegunLibroYRespaldo(t *testing.T) {
	f := newFakeSire(t)
	f.handler = func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost { // compras: el manual dice POST
			_, _ = w.Write([]byte(`{"numRuc":"20123456789"}`))
			return
		}
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
	ss := f.session(t, 10)
	if _, err := ss.Inconsistencies(sireLibroCompras, "202609", "1"); err != nil || f.lastMethod != http.MethodPost {
		t.Fatalf("compras debe usar POST: %v %s", err, f.lastMethod)
	}
	// ventas: GET según el manual; si SUNAT da 405 se prueba POST
	v, err := ss.Inconsistencies(sireLibroVentas, "202609", "1")
	if err != nil || v == nil || f.lastMethod != http.MethodPost {
		t.Fatalf("respaldo POST: %v %v %s", err, v, f.lastMethod)
	}
}

func TestSire_CatalogoPorLibro(t *testing.T) {
	v, c := SireCatalog(sireLibroVentas), SireCatalog(sireLibroCompras)
	has := func(list []SireReportDef, key string) bool {
		for _, d := range list {
			if d.Key == key {
				return true
			}
		}
		return false
	}
	if has(v, "preliminar_nd") || !has(c, "preliminar_nd") || !has(v, "propuesta") || !has(c, "inconsistencias_montos") {
		t.Errorf("catálogo por libro incorrecto")
	}
	for _, d := range c {
		if d.Key == "registro" && len(d.Fields) < 2 {
			t.Errorf("el registro de compras debe pedir proceso y moneda: %+v", d.Fields)
		}
		if d.Key == "registro" && d.Fields[0].Default != "70" {
			t.Errorf("proceso por defecto de compras = %s", d.Fields[0].Default)
		}
	}
	if !ValidSirePeriod("202609") || ValidSirePeriod("202613") || ValidSirePeriod("2026-9") {
		t.Errorf("validación de período")
	}
}

func TestSire_CacheDeArchivosVence(t *testing.T) {
	s := NewSireService()
	s.cachePut("k", []byte("x"))
	if _, ok := s.cacheGet("k"); !ok {
		t.Fatal("debe estar en caché")
	}
	s.mu.Lock()
	c := s.files["k"]
	c.expires = time.Now().Add(-time.Second)
	s.files["k"] = c
	s.mu.Unlock()
	if _, ok := s.cacheGet("k"); ok {
		t.Error("el archivo vencido no debe devolverse")
	}
}

// Las credenciales de API SIRE se guardan junto a la clave SOL, la sesión las toma de la base de datos y
// el alcance de la empresa se respeta.
func TestSire_SesionDesdeLaBaseDeDatos(t *testing.T) {
	db := setupCompanyRucTestDB(t)
	if err := db.AutoMigrate(&models.CompanyAccessCredential{}, &models.CompanyAccessLog{}); err != nil {
		t.Fatal(err)
	}
	co := models.Company{RUC: "20123456789", BusinessName: "Empresa SIRE", InternalCode: "S001",
		ClientType: models.CompanyClientTypeEstudio, Status: "activo"}
	if err := db.Create(&co).Error; err != nil {
		t.Fatal(err)
	}
	cs := NewCompanyAccessCredentialService()

	// Sin credenciales de API no se puede abrir la sesión.
	if _, err := cs.Upsert(co.ID, CompanyAccessCredentialUpdateInput{SolUsuario: "USUARIO1", SolClave: "clave-sol"}, nil); err != nil {
		t.Fatal(err)
	}
	f := newFakeSire(t)
	svc := NewSireService()
	svc.tokenBase, svc.apiBase = f.srv.URL+"/clientessol", f.srv.URL
	if _, err := svc.Session(co.ID, nil); err == nil {
		t.Fatal("sin Client ID/Secret debe fallar")
	}

	row, err := cs.Upsert(co.ID, CompanyAccessCredentialUpdateInput{
		SolUsuario: "USUARIO1", SolClave: "clave-sol", SireClientID: "  cid-db  ", SireClientSecret: "sec-db",
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !row.SireConfigurado || row.SireClientID != "cid-db" {
		t.Fatalf("fila: %+v", row)
	}
	ss, err := svc.Session(co.ID, nil)
	if err != nil {
		t.Fatalf("Session: %v", err)
	}
	if _, err := ss.Periods(sireLibroVentas); err != nil {
		t.Fatalf("Periods: %v", err)
	}
	if f.tokenForm["client_id"] != "cid-db" || f.tokenForm["username"] != "20123456789USUARIO1" || f.tokenForm["password"] != "clave-sol" {
		t.Errorf("credenciales enviadas a SUNAT: %v", f.tokenForm)
	}

	// Fuera del alcance del usuario: no se abre la sesión.
	var se *SireError
	if _, err := svc.Session(co.ID, []uint{co.ID + 99}); !errors.As(err, &se) || se.Code != SireErrOutOfScope {
		t.Errorf("se esperaba sin_acceso, llegó %v", err)
	}

	// La bitácora registra quién consultó qué empresa, sin datos.
	svc.LogAccess(co.ID, 7, nil)
	svc.LogAccess(co.ID, 7, sireErr(SireErrBadCreds, "x", ""))
	var logs []models.CompanyAccessLog
	if err := db.Where("company_id = ?", co.ID).Order("id").Find(&logs).Error; err != nil || len(logs) != 2 {
		t.Fatalf("bitácora: %v %d", err, len(logs))
	}
	if logs[0].Target != "sire" || logs[0].Status != "ok" || logs[1].Status != "error" || logs[1].ErrorCode != SireErrBadCreds {
		t.Errorf("bitácora: %+v", logs)
	}
}
