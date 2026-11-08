package services

import (
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"miappfiber/database"
	"miappfiber/models"
)

// Estructura que arma la pantalla de SUNAT (campos tomados de su código; datos inventados).
const damSunatJSON = `{"respuesta":{"estado":true,"mensajes":null,"datos":[
{"numDam":"118-2026-40-000123","fechaNumeracion":"15/10/2026","despachadorAduana":"AGENCIA DE ADUANA UNO S.A.","exportador":"EMPRESA DE PRUEBA S.A.C.","consignatario":"IMPORT CO LLC","tipoEmbarque":"TOTAL","totalClausulaVenta":15234.5,"totalValorAduanas":"14980.250","solicitudRegularizacion":"","idDeclaracion":"98765"},
{"numDam":"118-2026-40-000140","fechaNumeracion":"21/10/2026","despachadorAduana":"AGENCIA DE ADUANA UNO S.A.","exportador":"EMPRESA DE PRUEBA S.A.C.","consignatario":"OTRO IMPORT INC","tipoEmbarque":"PARCIAL","totalClausulaVenta":"8000","totalValorAduanas":7900,"solicitudRegularizacion":"SI","idDeclaracion":98766}]}}`

func TestParseDAMResult(t *testing.T) {
	res, err := parseDAMResult([]byte(damSunatJSON))
	if err != nil {
		t.Fatal(err)
	}
	if res.Total != 2 || len(res.Items) != 2 || res.TotalValor != 22880.25 || res.TotalClausula != 23234.5 {
		t.Fatalf("resumen: %+v", res)
	}
	it := res.Items[0]
	if it.Dam != "118-2026-40-000123" || it.FecNumeracion != "15/10/2026" || it.Despachador != "AGENCIA DE ADUANA UNO S.A." || it.Exportador != "EMPRESA DE PRUEBA S.A.C." ||
		it.Consignatario != "IMPORT CO LLC" || it.TipoEmbarque != "TOTAL" || it.ClausulaVenta != 15234.5 || it.ValorAduana != 14980.25 || it.IDDeclaracion != "98765" {
		t.Errorf("campos: %+v", it)
	}
	// Los números pueden llegar como texto y los id como número.
	if res.Items[1].ClausulaVenta != 8000 || res.Items[1].Regularizacion != "SI" || res.Items[1].IDDeclaracion != "98766" {
		t.Errorf("tipos flexibles: %+v", res.Items[1])
	}
}

func TestParseDAMResult_vacioMensajesYErrores(t *testing.T) {
	// El mensaje de «no se encontraron datos» es un resultado vacío, no un error (respuesta real de SUNAT).
	empty, err := parseDAMResult([]byte(`{"respuesta":{"estado":false,"mensajes":["No se encontraron datos con los parámetros ingresados o no está autorizado a realizar la consulta"]}}`))
	if err != nil || empty.Total != 0 || empty.Items == nil {
		t.Fatalf("vacío: %+v %v", empty, err)
	}
	// Con datos, el mensaje de SUNAT queda como aviso.
	warn, err := parseDAMResult([]byte(`{"respuesta":{"estado":true,"mensajes":"Se muestran solo los primeros 500 registros","datos":[{"numDam":"118-2026-40-000001","fechaNumeracion":"01/10/2026"}]}}`))
	if err != nil || warn.Total != 1 || !strings.Contains(warn.Aviso, "500") {
		t.Fatalf("aviso: %+v %v", warn, err)
	}
	var ae *SunatSolAccessError
	if _, err := parseDAMResult([]byte(`{"respuesta":{"estado":false,"mensajes":["Error al consultar el servicio"]}}`)); !errors.As(err, &ae) || ae.Code != SunatAccessUnexpected || !strings.Contains(ae.Detail, "Error al consultar") {
		t.Errorf("un mensaje distinto sin datos debía fallar: %v", err)
	}
	if _, err := parseDAMResult([]byte(`<html>sesion expirada</html>`)); !errors.As(err, &ae) || !strings.Contains(ae.Detail, "sesion expirada") {
		t.Errorf("una respuesta que no es JSON debía fallar con detalle: %v", err)
	}
	if _, err := parseDAMResult([]byte(`{}`)); err == nil {
		t.Error("sin «respuesta» debía fallar")
	}
}

func TestValidateDAMRange(t *testing.T) {
	s := &SunatDamService{now: func() time.Time { return time.Date(2026, 11, 7, 12, 0, 0, 0, time.UTC) }}
	for _, c := range [][2]string{{"2026-11-07", "2026-11-07"}, {"2026-08-08", "2026-11-07"}, {"2026-10-01", "2026-10-31"}} {
		if _, _, err := s.ValidateDAMRange(c[0], c[1]); err != nil {
			t.Errorf("%v debía ser válido: %v", c, err)
		}
	}
	bad := map[[2]string]string{
		{"07/11/2026", "08/11/2026"}: "AAAA-MM-DD",
		{"2026-11-07", "2026-11-01"}: "no puede ser mayor",
		{"2026-08-07", "2026-11-07"}: "máximo",
		{"2026-11-01", "2026-11-08"}: "posterior a hoy",
	}
	for c, want := range bad {
		_, _, err := s.ValidateDAMRange(c[0], c[1])
		var ae *SunatSolAccessError
		if !errors.As(err, &ae) || ae.Code != SunatAccessInvalidParams || !strings.Contains(ae.Message, want) {
			t.Errorf("%v: esperaba error con %q, obtuve %v", c, want, err)
		}
	}
}

// fakeSunatDAM imita el Menú SOL y la pantalla «Consulta de una DAM».
type fakeSunatDAM struct {
	srv     *httptest.Server
	query   map[string]string
	form    map[string]string
	method  string
	salio   bool
	payload string
}

func newFakeSunatDAM(t *testing.T, payload string) *fakeSunatDAM {
	f := &fakeSunatDAM{payload: payload}
	app := "/cl-ad-itdeclaracionconsulta/consultadam.htm"
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
		if r.URL.Query().Get("action") == "execute" && r.URL.Query().Get("code") == damMenuCode {
			http.Redirect(w, r, app+"?action=cargarFiltroConsultaDAM&hc=abc", http.StatusFound)
			return
		}
		_, _ = io.WriteString(w, `<html><script>var subdominio = 'ww1';</script></html>`)
	})
	mux.HandleFunc(app, func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			_, _ = io.WriteString(w, `<html><title>Consulta de una DAM</title></html>`)
			return
		}
		r.ParseForm()
		f.method = r.Method
		f.query = map[string]string{"action": r.URL.Query().Get("action")}
		f.form = map[string]string{}
		for k := range r.PostForm {
			f.form[k] = r.PostForm.Get(k)
		}
		w.Header().Set("Content-Type", "application/json;charset=utf-8")
		_, _ = io.WriteString(w, f.payload)
	})
	f.srv = httptest.NewServer(mux)
	t.Cleanup(f.srv.Close)
	return f
}

func newDamTest(t *testing.T, f *fakeSunatDAM) (*SunatDamService, models.Company) {
	db := setupCompanyRucTestDB(t)
	if err := db.AutoMigrate(&models.CompanyAccessCredential{}, &models.CompanyAccessLog{}, &models.DamHistory{}); err != nil {
		t.Fatal(err)
	}
	co := models.Company{RUC: "20111111111", BusinessName: "Empresa", Status: "activo", ClientType: models.CompanyClientTypeEstudio}
	db.Create(&co)
	db.Create(&models.CompanyAccessCredential{CompanyID: co.ID, SolUsuario: "USUARIO", SolClave: "clave"})
	svc := NewSunatDamService()
	svc.async = false
	svc.now = func() time.Time { return time.Date(2026, 11, 7, 12, 0, 0, 0, time.UTC) }
	svc.linkFn = func(uint, []uint, uint) (string, error) { return f.srv.URL + "/cl-ti-itmenu/MenuInternet.htm?x=1", nil }
	return svc, co
}

func TestDamStart_haceLaMismaLlamadaQueLaPantallaYGuardaElResultado(t *testing.T) {
	f := newFakeSunatDAM(t, damSunatJSON)
	svc, co := newDamTest(t, f)
	row, err := svc.Start(co.ID, nil, 7, "2026-10-01", "2026-10-31")
	if err != nil {
		t.Fatal(err)
	}
	if row.Status != models.DamHistoryRunning || row.Desde != "2026-10-01" || row.RequestedBy != 7 {
		t.Errorf("la fila nace en proceso: %+v", row)
	}
	want := map[string]string{
		"optradio": "on", "codigoRegimen": "40", "fechaNumeracionDesde": "01/10/2026", "fechaNumeracionHasta": "31/10/2026",
		"codAduNum": "99", "codEstDAM": "99", "codExpor": "99", "idHdnSistema": "IT", "numero": "",
	}
	for k, v := range want {
		if f.form[k] != v {
			t.Errorf("campo %s = %q, quería %q (enviado: %v)", k, f.form[k], v, f.form)
		}
	}
	if f.method != http.MethodPost || f.query["action"] != "buscarPorRangoFecha" {
		t.Errorf("llamada: %s %v", f.method, f.query)
	}
	if !f.salio {
		t.Error("debía cerrar la sesión de SOL")
	}
	rows, err := svc.ListHistory(co.ID)
	if err != nil || len(rows) != 1 {
		t.Fatalf("historial: %d %v", len(rows), err)
	}
	if rows[0].Status != models.DamHistoryReady || rows[0].Total != 2 || rows[0].TotalValor != 22880.25 || rows[0].FinishedAt == nil || len(rows[0].Data) != 0 {
		t.Errorf("fila terminada: %+v", rows[0])
	}
	_, res, err := svc.GetHistory(co.ID, row.ID)
	if err != nil || res == nil || len(res.Items) != 2 || res.Items[0].Dam != "118-2026-40-000123" || res.Desde != "2026-10-01" {
		t.Fatalf("resultado guardado: %+v %v", res, err)
	}
}

func TestDamStart_sinResultadosYErrores(t *testing.T) {
	f := newFakeSunatDAM(t, `{"respuesta":{"estado":false,"mensajes":["No se encontraron datos con los parámetros ingresados o no está autorizado a realizar la consulta"]}}`)
	svc, co := newDamTest(t, f)
	row, _ := svc.Start(co.ID, nil, 1, "2026-10-01", "2026-10-31")
	rows, _ := svc.ListHistory(co.ID)
	if len(rows) != 1 || rows[0].ID != row.ID || rows[0].Status != models.DamHistoryNoData || rows[0].Total != 0 {
		t.Fatalf("sin resultados: %+v", rows)
	}

	// Error de login: la fila queda con el error y la sesión de SOL nunca se abre.
	svc.linkFn = func(uint, []uint, uint) (string, error) {
		return "", accessErr(SunatAccessBadCreds, "rechazada ñandú", "302")
	}
	svc.Start(co.ID, nil, 1, "2026-09-01", "2026-09-30")
	rows, _ = svc.ListHistory(co.ID)
	if len(rows) != 2 || rows[0].Status != models.DamHistoryFailed || rows[0].ErrorCode != SunatAccessBadCreds || rows[0].ErrorMessage == "" {
		t.Fatalf("error de login: %+v", rows[0])
	}

	// Datos inválidos: ni siquiera queda en el historial.
	if _, err := svc.Start(co.ID, nil, 1, "2026-10-31", "2026-10-01"); err == nil {
		t.Error("fechas inválidas debían fallar")
	}
	if _, err := svc.Start(co.ID, []uint{9999}, 1, "2026-10-01", "2026-10-31"); err == nil {
		t.Error("una empresa fuera del alcance no se puede consultar")
	}
	if rows, _ := svc.ListHistory(co.ID); len(rows) != 2 {
		t.Errorf("las inválidas no se guardan: %d", len(rows))
	}
}

func TestDamStart_unaSolaConsultaEnProcesoPorEmpresaYCaducan(t *testing.T) {
	f := newFakeSunatDAM(t, damSunatJSON)
	svc, co := newDamTest(t, f)
	database.DB.Create(&models.DamHistory{CompanyID: co.ID, Desde: "2026-10-01", Hasta: "2026-10-31", Status: models.DamHistoryRunning, CreatedAt: svc.now()})

	var ae *SunatSolAccessError
	if _, err := svc.Start(co.ID, nil, 1, "2026-09-01", "2026-09-30"); !errors.As(err, &ae) || ae.Code != SunatAccessInProgress {
		t.Fatalf("con una en proceso debía responder en_curso: %v", err)
	}
	// Pasado el tiempo (por ejemplo, el servidor se reinició) se da por fallida y ya se puede consultar otra vez.
	svc.now = func() time.Time { return time.Date(2026, 11, 7, 12, 30, 0, 0, time.UTC) }
	if _, err := svc.Start(co.ID, nil, 1, "2026-09-01", "2026-09-30"); err != nil {
		t.Fatalf("una consulta vieja en proceso no debe bloquear: %v", err)
	}
	rows, _ := svc.ListHistory(co.ID)
	if len(rows) != 2 || rows[0].Status != models.DamHistoryReady || rows[1].Status != models.DamHistoryFailed || rows[1].ErrorCode != "interrumpida" {
		t.Fatalf("caducadas: %+v", rows)
	}
}

func TestDamHistory_quitarYLimpiar(t *testing.T) {
	f := newFakeSunatDAM(t, damSunatJSON)
	svc, co := newDamTest(t, f)
	a, _ := svc.Start(co.ID, nil, 1, "2026-10-01", "2026-10-31")
	svc.Start(co.ID, nil, 1, "2026-09-01", "2026-09-30")
	database.DB.Create(&models.DamHistory{CompanyID: co.ID, Desde: "2026-08-01", Hasta: "2026-08-31", Status: models.DamHistoryRunning, CreatedAt: svc.now()})
	other := models.DamHistory{CompanyID: co.ID + 1, Desde: "2026-08-01", Hasta: "2026-08-31", Status: models.DamHistoryReady}
	database.DB.Create(&other)

	if _, _, err := svc.GetHistory(co.ID+1, a.ID); err == nil {
		t.Error("no se puede leer una consulta de otra empresa")
	}
	if err := svc.DeleteHistory(co.ID, a.ID); err != nil {
		t.Fatal(err)
	}
	if err := svc.DeleteHistory(co.ID, a.ID); err == nil {
		t.Error("quitar dos veces debía fallar")
	}
	if n, err := svc.ClearHistory(co.ID); err != nil || n != 1 {
		t.Fatalf("limpiar quita lo terminado y no lo que está en proceso: %d %v", n, err)
	}
	rows, _ := svc.ListHistory(co.ID)
	if len(rows) != 1 || rows[0].Status != models.DamHistoryRunning {
		t.Errorf("debía quedar la que está en proceso: %+v", rows)
	}
	if rows, _ := svc.ListHistory(co.ID + 1); len(rows) != 1 {
		t.Error("limpiar una empresa no debe tocar a las otras")
	}

	// Una consulta quitada mientras corría no revive al terminar.
	svc.finish(a.ID, &DAMResult{Total: 1, Items: []DAMItem{{Dam: "x"}}}, nil)
	if _, _, err := svc.GetHistory(co.ID, a.ID); err == nil {
		t.Error("una consulta quitada no debía volver")
	}
}
