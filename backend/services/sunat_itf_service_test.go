package services

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"miappfiber/models"
)

func itfRow(cells ...string) string {
	var b strings.Builder
	b.WriteString("<tr>\n")
	for _, c := range cells {
		b.WriteString("    <td width='10%' align='center'>\n       " + c + "\n    </td>\n")
	}
	b.WriteString("</tr>\n")
	return b.String()
}

func itfHeader(cols ...string) string {
	var b strings.Builder
	b.WriteString("<tr>\n<!-- cabecera vieja -->\n")
	for _, c := range cols {
		b.WriteString("    <td class=\"beta\"><strong>" + c + "</strong></td>\n")
	}
	b.WriteString("</tr>\n")
	return b.String()
}

// itfPage imita la página de resultado de SUNAT (estructura real; datos inventados).
func itfPage(extraContra string) string {
	return `<html><head><title>Resultado de la Consulta de ITF</title></head><body>
<table><tr><td class="t1">Resultado de la Consulta del ITF</td></tr></table>
<b><p class="beta" align="center">Datos de Identificaci&oacute;n</p></b>
<b>Documento: 06&nbsp;&nbsp;-&nbsp;&nbsp;RUC&nbsp;&nbsp;Nro.&nbsp;&nbsp;20111111111
</b><br><b>Nombre/Razon Social:&nbsp;&nbsp;EMPRESA DE PRUEBA S.A.C.</b><br>
<table><tr><td class="beta"><b><center>Movimientos Acumulados</center></b></td></tr></table>
<table border='1' cellpadding='0' cellspacing='0' width='100%' class="form-table">
` + itfHeader("RUC", "Declarante", "Per&iacute;odo", "Tipo", "Cod. Oper.", "Base", "Impuesto") +
		itfRow("20100000001", "BANCO UNO", "202605", "Afecta", `<a href="javascript:callDesc('13')">13</a>`, "1,000.00", "0.05") +
		itfRow("20100000001", "BANCO UNO", "202606", "Afecta", "01", "16,000.00", "0.80") + `</table>
<table><tr><td>Cantidad de registros: 2 &nbsp; Total Impuesto: 0.85 &nbsp; Total Movimientos: 17,000.00</td></tr></table>
<table><tr><td class="beta"><b><center>Movimientos de Contra Asientos por Error</center></b></td></tr></table>
<table border='1' cellpadding='0' cellspacing='0' width='100%' class="form-table">
` + itfHeader("RUC", "Per&iacute;odo", "Base", "Impuesto") + extraContra + `</table>
<table><tr><td>Cantidad de registros: ` + map[bool]string{true: "1", false: "0"}[extraContra != ""] + ` Total Impuesto: 0.00</td></tr></table>
<table><tr><td class="beta"><b><center>Exoneraci&oacute;n, Convenios e Inafectaci&oacute;n</center></b></td></tr></table>
<table border='1' width='100%'>
` + itfHeader("RUC", "Cuenta", "Fecha") + `</table>
<table><tr><td>Cantidad de registros: 0</td></tr></table>
<p>NOTA: La informaci&oacute;n que se muestra sobre "Base Imponible" es referencial.<br></p>
</body></html>`
}

func TestParseITFResult(t *testing.T) {
	res, err := parseITFResult([]byte(itfPage("")))
	if err != nil {
		t.Fatal(err)
	}
	if res.Documento != "06 - RUC Nro. 20111111111" || res.RazonSocial != "EMPRESA DE PRUEBA S.A.C." {
		t.Errorf("identificación: %q %q", res.Documento, res.RazonSocial)
	}
	a := res.Acumulados
	if a.Titulo != "Movimientos Acumulados" || len(a.Columnas) != 7 || len(a.Filas) != 2 || a.Registros != 2 {
		t.Fatalf("acumulados: %+v", a)
	}
	if a.Columnas[2] != "Período" || a.Filas[0][4] != "13" || a.Filas[0][5] != "1,000.00" || a.Filas[1][2] != "202606" {
		t.Errorf("celdas: %v %v", a.Columnas, a.Filas)
	}
	if a.TotalImpuesto == nil || *a.TotalImpuesto != 0.85 || a.TotalMovimientos == nil || *a.TotalMovimientos != 17000 {
		t.Errorf("totales: %v %v", a.TotalImpuesto, a.TotalMovimientos)
	}
	if res.ContraAsientos.Registros != 0 || len(res.ContraAsientos.Filas) != 0 || res.Exoneraciones.Registros != 0 || len(res.Exoneraciones.Columnas) != 3 {
		t.Errorf("secciones vacías: %+v %+v", res.ContraAsientos, res.Exoneraciones)
	}
	if res.Exoneraciones.Titulo != "Exoneración, Convenios e Inafectación" || !strings.HasPrefix(res.Nota, "La información") {
		t.Errorf("título/nota: %q %q", res.Exoneraciones.Titulo, res.Nota)
	}
	if res.Total() != 2 {
		t.Errorf("total: %d", res.Total())
	}

	// Con una fila en contra asientos.
	res, err = parseITFResult([]byte(itfPage(itfRow("20100000001", "202606", "500.00", "0.03"))))
	if err != nil || res.ContraAsientos.Registros != 1 || len(res.ContraAsientos.Filas) != 1 || res.ContraAsientos.Filas[0][3] != "0.03" {
		t.Fatalf("contra asientos: %+v %v", res.ContraAsientos, err)
	}
}

func TestParseITFResult_latin1YErrores(t *testing.T) {
	// SUNAT entrega estas páginas en ISO-8859-1: «ó» llega como el byte 0xF3.
	page := strings.ReplaceAll(itfPage(""), "&oacute;", "\xf3")
	res, err := parseITFResult([]byte(page))
	if err != nil || res.Exoneraciones.Titulo != "Exoneración, Convenios e Inafectación" {
		t.Fatalf("latin-1: %q %v", res.Exoneraciones.Titulo, err)
	}
	var ae *SunatSolAccessError
	if _, err := parseITFResult([]byte("<html><body>Error: los periodos no son validos</body></html>")); !errors.As(err, &ae) || ae.Code != SunatAccessUnexpected || !strings.Contains(ae.Detail, "periodos") {
		t.Errorf("una página que no es el resultado debía fallar con detalle: %v", err)
	}
}

func TestValidateITFPeriods(t *testing.T) {
	s := &SunatItfService{now: func() time.Time { return time.Date(2026, 11, 7, 12, 0, 0, 0, time.UTC) }}
	ok := [][2]string{{"202601", "202610"}, {"202611", "202611"}, {" 200403 ", "200403"}, {"202112", "202611"}}
	for _, c := range ok {
		if _, _, err := s.ValidateITFPeriods(c[0], c[1]); err != nil {
			t.Errorf("%v debía ser válido: %v", c, err)
		}
	}
	bad := map[[2]string]string{
		{"2026-01", "202610"}: "AAAAMM",
		{"", ""}:              "AAAAMM",
		{"202613", "202613"}:  "mes",
		{"200402", "200501"}:  "200403",
		{"202610", "202601"}:  "no puede ser mayor",
		{"202601", "202612"}:  "mes actual",
		{"200403", "202611"}:  "máximo",
	}
	for c, want := range bad {
		_, _, err := s.ValidateITFPeriods(c[0], c[1])
		var ae *SunatSolAccessError
		if !errors.As(err, &ae) || ae.Code != SunatAccessInvalidParams || !strings.Contains(ae.Message, want) {
			t.Errorf("%v: esperaba error con %q, obtuve %v", c, want, err)
		}
	}
}

// fakeSunatITF imita el Menú SOL y la pantalla «Consulta de ITF».
type fakeSunatITF struct {
	srv    *httptest.Server
	posted map[string]string
	salio  bool
	page   string
}

func newFakeSunatITF(t *testing.T, page string) *fakeSunatITF {
	f := &fakeSunatITF{page: page}
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
		if r.URL.Query().Get("action") == "execute" && r.URL.Query().Get("code") == itfMenuCode {
			http.Redirect(w, r, itfFormPath+"?x=1", http.StatusFound)
			return
		}
		_, _ = io.WriteString(w, `<html><script>var subdominio = 'ww1';</script></html>`)
	})
	mux.HandleFunc(itfFormPath, func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			_, _ = io.WriteString(w, `<html><title>ITF - Inicio</title><input name="ejercicio"></html>`)
			return
		}
		r.ParseForm()
		f.posted = map[string]string{}
		for k := range r.PostForm {
			f.posted[k] = r.PostForm.Get(k)
		}
		_, _ = io.WriteString(w, f.page)
	})
	f.srv = httptest.NewServer(mux)
	t.Cleanup(f.srv.Close)
	return f
}

func newItfTest(t *testing.T, f *fakeSunatITF) (*SunatItfService, models.Company) {
	db := setupCompanyRucTestDB(t)
	if err := db.AutoMigrate(&models.CompanyAccessCredential{}, &models.CompanyAccessLog{}, &models.ItfHistory{}); err != nil {
		t.Fatal(err)
	}
	co := models.Company{RUC: "20111111111", BusinessName: "Empresa", Status: "activo", ClientType: models.CompanyClientTypeEstudio}
	db.Create(&co)
	db.Create(&models.CompanyAccessCredential{CompanyID: co.ID, SolUsuario: "USUARIO", SolClave: "clave"})
	svc := NewSunatItfService()
	svc.now = func() time.Time { return time.Date(2026, 11, 7, 12, 0, 0, 0, time.UTC) }
	svc.linkFn = func(uint, []uint, uint) (string, error) { return f.srv.URL + "/cl-ti-itmenu/MenuInternet.htm?x=1", nil }
	return svc, co
}

func TestItfQuery_enviaElFormularioYLeeElResultado(t *testing.T) {
	f := newFakeSunatITF(t, itfPage(""))
	svc, co := newItfTest(t, f)
	res, err := svc.Query(co.ID, nil, 1, "202605", "202610")
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]string{"tipdocdec": "06", "numdocdec": "20111111111", "ejercicio": "202605", "ejerciciofin": "202610", "accion": "ppsiguiente"}
	for k, v := range want {
		if f.posted[k] != v {
			t.Errorf("campo %s = %q, quería %q (enviado: %v)", k, f.posted[k], v, f.posted)
		}
	}
	if res.Desde != "202605" || res.Hasta != "202610" || res.Total() != 2 {
		t.Errorf("resultado: %+v", res)
	}
	if !f.salio {
		t.Error("debía cerrar la sesión de SOL")
	}
}

func TestItfQuery_periodosInvalidosNoLlamanASunat(t *testing.T) {
	f := newFakeSunatITF(t, itfPage(""))
	svc, co := newItfTest(t, f)
	called := false
	svc.linkFn = func(uint, []uint, uint) (string, error) { called = true; return "", nil }
	if _, err := svc.Query(co.ID, nil, 1, "202610", "202601"); err == nil || called {
		t.Fatalf("debía fallar sin entrar a SOL: %v called=%v", err, called)
	}
}

func TestItfQuery_errorDeLoginYEmpresaFueraDeAlcance(t *testing.T) {
	f := newFakeSunatITF(t, itfPage(""))
	svc, co := newItfTest(t, f)
	svc.linkFn = func(uint, []uint, uint) (string, error) { return "", accessErr(SunatAccessBadCreds, "rechazada", "") }
	var ae *SunatSolAccessError
	if _, err := svc.Query(co.ID, nil, 1, "202601", "202602"); !errors.As(err, &ae) || ae.Code != SunatAccessBadCreds {
		t.Fatalf("esperaba credenciales_rechazadas: %v", err)
	}
	if _, err := svc.Query(co.ID, []uint{9999}, 1, "202601", "202602"); err == nil {
		t.Fatal("una empresa fuera del alcance no se puede consultar")
	}
}

func TestItfHistory_guardaListaYQuita(t *testing.T) {
	f := newFakeSunatITF(t, itfPage(""))
	svc, co := newItfTest(t, f)
	res, err := svc.Query(co.ID, nil, 1, "202605", "202610")
	if err != nil {
		t.Fatal(err)
	}
	id1 := svc.RecordHistory(co.ID, 3, "202605", "202610", res, nil)
	id2 := svc.RecordHistory(co.ID, 3, "202601", "202602", &ITFResult{}, nil)
	id3 := svc.RecordHistory(co.ID, 3, "202601", "202602", nil, accessErr(SunatAccessUnavailable, "SUNAT no responde. Inténtelo más tarde: ñandú", "HTTP 503"))
	other := svc.RecordHistory(co.ID+1, 3, "202601", "202602", res, nil)
	if id1 == 0 || id2 == 0 || id3 == 0 || other == 0 {
		t.Fatalf("debía guardar todas: %d %d %d %d", id1, id2, id3, other)
	}
	rows, err := svc.ListHistory(co.ID)
	if err != nil || len(rows) != 3 {
		t.Fatalf("historial: %d %v", len(rows), err)
	}
	if rows[0].ID != id3 || rows[0].Status != models.ItfHistoryFailed || rows[0].ErrorCode != SunatAccessUnavailable {
		t.Errorf("lo más reciente primero, con su error: %+v", rows[0])
	}
	if rows[1].Status != models.ItfHistoryNoData || rows[2].Status != models.ItfHistoryReady || rows[2].Total != 2 || rows[2].TotalImpuesto != 0.85 || rows[2].TotalMovimientos != 17000 || len(rows[2].Data) != 0 {
		t.Errorf("estados/totales: %+v / %+v", rows[1], rows[2])
	}
	row, got, err := svc.GetHistory(co.ID, id1)
	if err != nil || got == nil || len(got.Acumulados.Filas) != 2 || row.Desde != "202605" {
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

func TestItfHistory_conservaSoloLasUltimas(t *testing.T) {
	f := newFakeSunatITF(t, itfPage(""))
	svc, co := newItfTest(t, f)
	for i := 0; i < itfHistoryKeep+3; i++ {
		svc.RecordHistory(co.ID, 1, "202601", "202602", nil, errors.New(fmt.Sprint(i)))
	}
	if rows, _ := svc.ListHistory(co.ID); len(rows) != itfHistoryKeep {
		t.Fatalf("debía conservar %d, hay %d", itfHistoryKeep, len(rows))
	}
}
