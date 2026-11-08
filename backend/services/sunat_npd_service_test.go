package services

import (
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"miappfiber/models"
)

// Respuesta real de SUNAT (estructura y campos; datos inventados).
const npdSunatJSON = `{"resultado":[
{"fecRegistro":"30\/10\/2026 11:12:01","estado":"Pagado confirmado","numRuc":"20111111111","razonSocial":"razon social","numNpd":"0001966796053","desRazonSocial":"EMPRESA DE PRUEBA S.A.C.                                                      ","fecCreacion":"30\/10\/2026","fecLimitePago":"03\/11\/2026","indicadorEstado":"10","importe":124.00},
{"fecRegistro":"23\/10\/2026 10:35:04","estado":"Vigente","numRuc":"20111111111","razonSocial":"razon social","numNpd":"0001966247696","desRazonSocial":"EMPRESA DE PRUEBA S.A.C.","fecCreacion":"23\/10\/2026","fecLimitePago":"27\/10\/2026","indicadorEstado":"00","importe":583.50},
{"fecRegistro":"02\/10\/2026 15:20:05","estado":"No Vigente","numRuc":"20111111111","razonSocial":"razon social","numNpd":"0001964457961","desRazonSocial":"EMPRESA DE PRUEBA S.A.C.","fecCreacion":"02\/10\/2026","fecLimitePago":"06\/10\/2026","indicadorEstado":"11","importe":575.00}]}`

func TestParseNPDResult(t *testing.T) {
	res, err := parseNPDResult([]byte(npdSunatJSON))
	if err != nil {
		t.Fatal(err)
	}
	if res.Total != 3 || len(res.Items) != 3 || res.TotalImporte != 1282.5 || res.Vigentes != 1 || res.ImporteVigente != 583.5 {
		t.Fatalf("resumen: %+v", res)
	}
	it := res.Items[0]
	if it.Npd != "0001966796053" || it.RazonSocial != "EMPRESA DE PRUEBA S.A.C." || it.Estado != "Pagado confirmado" || it.EstadoCod != NPDEstadoPagado ||
		it.FecCreacion != "30/10/2026" || it.FecLimitePago != "03/11/2026" || it.FecRegistro != "30/10/2026 11:12:01" || it.Importe != 124 {
		t.Errorf("campos: %+v", it)
	}

	empty, err := parseNPDResult([]byte(`{"resultado":[]}`))
	if err != nil || empty.Total != 0 || empty.Items == nil {
		t.Fatalf("lista vacía: %+v %v", empty, err)
	}

	var ae *SunatSolAccessError
	if _, err := parseNPDResult([]byte(`{"beanErr":{"mensajeerror":"Rango no permitido"},"resultado":null}`)); !errors.As(err, &ae) || ae.Code != SunatAccessUnexpected || !strings.Contains(ae.Detail, "Rango") {
		t.Errorf("beanErr debía fallar con el mensaje de SUNAT: %v", err)
	}
	if _, err := parseNPDResult([]byte(`<html>sesion expirada</html>`)); !errors.As(err, &ae) || !strings.Contains(ae.Detail, "sesion expirada") {
		t.Errorf("una respuesta que no es JSON debía fallar con detalle: %v", err)
	}
}

func TestValidateNPDRange(t *testing.T) {
	s := &SunatNpdService{now: func() time.Time { return time.Date(2026, 11, 7, 12, 0, 0, 0, time.UTC) }}
	for _, c := range [][2]string{{"2026-11-07", "2026-11-07"}, {"2025-11-08", "2026-11-07"}, {"2026-01-01", "2026-10-31"}} {
		if _, _, err := s.ValidateNPDRange(c[0], c[1]); err != nil {
			t.Errorf("%v debía ser válido: %v", c, err)
		}
	}
	bad := map[[2]string]string{
		{"07/11/2026", "08/11/2026"}: "AAAA-MM-DD",
		{"2026-02-30", "2026-03-01"}: "válidas",
		{"2026-11-07", "2026-11-01"}: "no puede ser mayor",
		{"2025-11-07", "2026-11-07"}: "máximo",
		{"2026-11-01", "2026-11-08"}: "posterior a hoy",
		{"", ""}:                     "AAAA-MM-DD",
	}
	for c, want := range bad {
		_, _, err := s.ValidateNPDRange(c[0], c[1])
		var ae *SunatSolAccessError
		if !errors.As(err, &ae) || ae.Code != SunatAccessInvalidParams || !strings.Contains(ae.Message, want) {
			t.Errorf("%v: esperaba error con %q, obtuve %v", c, want, err)
		}
	}
}

// fakeSunatNPD imita el Menú SOL y la pantalla «Consulta de NPD».
type fakeSunatNPD struct {
	srv     *httptest.Server
	query   map[string]string
	ctype   string
	method  string
	anulo   bool
	salio   bool
	payload string
}

func newFakeSunatNPD(t *testing.T, payload string) *fakeSunatNPD {
	f := &fakeSunatNPD{payload: payload}
	app := "/cl-ti-itnumpagdetr/consultaIndividual.htm"
	mux := http.NewServeMux()
	mux.HandleFunc("/cl-ti-itmenu/MenuInternet.htm", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			r.ParseForm()
			if r.PostForm.Get("action") == "salir" {
				f.salio = true
			}
			_, _ = io.WriteString(w, "none")
			return
		}
		if r.URL.Query().Get("action") == "execute" && r.URL.Query().Get("code") == npdMenuCode {
			http.Redirect(w, r, app+"?x=1", http.StatusFound)
			return
		}
		_, _ = io.WriteString(w, `<html><script>var subdominio = 'ww1';</script></html>`)
	})
	mux.HandleFunc(app, func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			_, _ = io.WriteString(w, `<html><title>Consulta de NPD</title></html>`)
			return
		}
		f.method, f.ctype = r.Method, r.Header.Get("Content-Type")
		f.query = map[string]string{}
		for k := range r.URL.Query() {
			f.query[k] = r.URL.Query().Get(k)
		}
		if f.query["action"] == "anularNPD" {
			f.anulo = true
		}
		w.Header().Set("Content-Type", "text/plain;charset=utf-8")
		_, _ = io.WriteString(w, f.payload)
	})
	f.srv = httptest.NewServer(mux)
	t.Cleanup(f.srv.Close)
	return f
}

func newNpdTest(t *testing.T, f *fakeSunatNPD) (*SunatNpdService, models.Company) {
	db := setupCompanyRucTestDB(t)
	if err := db.AutoMigrate(&models.CompanyAccessCredential{}, &models.CompanyAccessLog{}, &models.NpdHistory{}); err != nil {
		t.Fatal(err)
	}
	co := models.Company{RUC: "20111111111", BusinessName: "Empresa", Status: "activo", ClientType: models.CompanyClientTypeEstudio}
	db.Create(&co)
	db.Create(&models.CompanyAccessCredential{CompanyID: co.ID, SolUsuario: "USUARIO", SolClave: "clave"})
	svc := NewSunatNpdService()
	svc.now = func() time.Time { return time.Date(2026, 11, 7, 12, 0, 0, 0, time.UTC) }
	svc.linkFn = func(uint, []uint, uint) (string, error) { return f.srv.URL + "/cl-ti-itmenu/MenuInternet.htm?x=1", nil }
	return svc, co
}

func TestNpdQuery_haceLaMismaLlamadaQueLaPantalla(t *testing.T) {
	f := newFakeSunatNPD(t, npdSunatJSON)
	svc, co := newNpdTest(t, f)
	res, err := svc.Query(co.ID, nil, 1, "2026-10-01", "2026-11-07")
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]string{"action": "consultarPadronIndividual", "fecIni": "01/10/2026", "fecFin": "07/11/2026", "tipoConsulta": "2", "num_npd": ""}
	for k, v := range want {
		if f.query[k] != v {
			t.Errorf("parámetro %s = %q, quería %q (enviado: %v)", k, f.query[k], v, f.query)
		}
	}
	if f.method != http.MethodPost || !strings.HasPrefix(f.ctype, "application/json") {
		t.Errorf("debía ser POST con JSON: %s %q", f.method, f.ctype)
	}
	if f.anulo {
		t.Fatal("jamás debe llamar a anularNPD")
	}
	if res.Desde != "2026-10-01" || res.Hasta != "2026-11-07" || res.Total != 3 {
		t.Errorf("resultado: %+v", res)
	}
	if !f.salio {
		t.Error("debía cerrar la sesión de SOL")
	}
}

func TestNpdQuery_errores(t *testing.T) {
	f := newFakeSunatNPD(t, npdSunatJSON)
	svc, co := newNpdTest(t, f)
	called := false
	link := svc.linkFn
	svc.linkFn = func(a uint, b []uint, c uint) (string, error) { called = true; return link(a, b, c) }
	if _, err := svc.Query(co.ID, nil, 1, "2026-11-07", "2026-10-01"); err == nil || called {
		t.Fatalf("fechas inválidas no deben entrar a SOL: %v called=%v", err, called)
	}
	svc.linkFn = func(uint, []uint, uint) (string, error) { return "", accessErr(SunatAccessBadCreds, "rechazada", "") }
	var ae *SunatSolAccessError
	if _, err := svc.Query(co.ID, nil, 1, "2026-10-01", "2026-11-07"); !errors.As(err, &ae) || ae.Code != SunatAccessBadCreds {
		t.Fatalf("esperaba credenciales_rechazadas: %v", err)
	}
	if _, err := svc.Query(co.ID, []uint{9999}, 1, "2026-10-01", "2026-11-07"); err == nil {
		t.Fatal("una empresa fuera del alcance no se puede consultar")
	}
}

func TestNpdHistory_guardaListaYQuita(t *testing.T) {
	f := newFakeSunatNPD(t, npdSunatJSON)
	svc, co := newNpdTest(t, f)
	res, err := svc.Query(co.ID, nil, 1, "2026-10-01", "2026-11-07")
	if err != nil {
		t.Fatal(err)
	}
	id1 := svc.RecordHistory(co.ID, 3, "2026-10-01", "2026-11-07", res, nil)
	id2 := svc.RecordHistory(co.ID, 3, "2026-01-01", "2026-01-31", &NPDResult{}, nil)
	id3 := svc.RecordHistory(co.ID, 3, "2026-01-01", "2026-01-31", nil, accessErr(SunatAccessUnavailable, "SUNAT no responde: ñandú", "HTTP 503"))
	other := svc.RecordHistory(co.ID+1, 3, "2026-10-01", "2026-11-07", res, nil)
	if id1 == 0 || id2 == 0 || id3 == 0 || other == 0 {
		t.Fatalf("debía guardar todas: %d %d %d %d", id1, id2, id3, other)
	}
	rows, err := svc.ListHistory(co.ID)
	if err != nil || len(rows) != 3 {
		t.Fatalf("historial: %d %v", len(rows), err)
	}
	if rows[0].ID != id3 || rows[0].Status != models.NpdHistoryFailed || rows[0].ErrorCode != SunatAccessUnavailable {
		t.Errorf("lo más reciente primero, con su error: %+v", rows[0])
	}
	if rows[1].Status != models.NpdHistoryNoData || rows[2].Status != models.NpdHistoryReady || rows[2].Total != 3 || rows[2].TotalImporte != 1282.5 || rows[2].Vigentes != 1 || rows[2].ImporteVigente != 583.5 || len(rows[2].Data) != 0 {
		t.Errorf("estados/totales: %+v / %+v", rows[1], rows[2])
	}
	row, got, err := svc.GetHistory(co.ID, id1)
	if err != nil || got == nil || len(got.Items) != 3 || got.Items[1].Estado != "Vigente" || row.Desde != "2026-10-01" {
		t.Fatalf("resultado guardado: %+v %+v %v", row, got, err)
	}
	if _, _, err := svc.GetHistory(co.ID+1, id1); err == nil {
		t.Error("no se puede leer una consulta de otra empresa")
	}
	if err := svc.DeleteHistory(co.ID, id1); err != nil {
		t.Fatal(err)
	}
	if err := svc.DeleteHistory(co.ID, id1); err == nil {
		t.Error("quitar dos veces debía fallar")
	}
	if n, err := svc.ClearHistory(co.ID); err != nil || n != 2 {
		t.Fatalf("limpiar: %d %v", n, err)
	}
	if rows, _ := svc.ListHistory(co.ID + 1); len(rows) != 1 {
		t.Error("limpiar una empresa no debe tocar a las otras")
	}
}
