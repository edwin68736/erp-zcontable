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

// Reporte de SUNAT (estructura real; datos inventados). Llega en ISO-8859-1: «Ñ» es el byte 0xD1.
const rheSolReportHeader = "Fecha de Emisión|Tipo Doc. Emitido|Nro. Doc. Emitido|Estado Doc. Emitido|Tipo de Doc. Emisor|Nro. Doc. Emisor|" +
	"Apellidos y Nombres, Denominación o Razón Social del Emisor|Tipo de Renta|Gratuito|Descripción|Observación|Moneda de Operación|" +
	"Renta Bruta|Impuesto a la Renta|Renta Neta|Monto Neto Pendiente de Pago|\r\n"

func rheSolReport(rows ...string) []byte {
	s := rheSolReportHeader + strings.Join(rows, "\r\n")
	// ISO-8859-1: se convierten las letras con tilde a un solo byte.
	var b []byte
	for _, r := range s {
		if r > 255 {
			b = append(b, '?')
		} else {
			b = append(b, byte(r))
		}
	}
	return b
}

const (
	rheRow1 = "04/06/2026|RH|E001-40|NO ANULADO|RUC|10730328716|AÑAZCO BOLIVAR FIORELLA ELIZABETH      |A|NO|SERVICIO PSICOLOGICO DE MAYO |- |SOLES|460.00|0.00|460.00|0.00|"
	rheRow2 = "10/06/2026|RH|E001-41|ANULADO|RUC|10730328716|AÑAZCO BOLIVAR FIORELLA ELIZABETH      |A|SI|ASESORIA |MODALIDAD MENSUAL |DOLARES|1,900.50|0.00|1,900.50|100.00|"
)

func TestParseRheSolReport(t *testing.T) {
	items, err := parseRheSolReport(rheSolReport(rheRow1, rheRow2))
	if err != nil || len(items) != 2 {
		t.Fatalf("filas: %d %v", len(items), err)
	}
	a := items[0]
	if a.FecEmision != "2026-06-04" || a.Tipo != "RH" || a.Comprobante != "E001-40" || a.Anulado || a.EmisorDoc != "10730328716" ||
		a.EmisorNombre != "AÑAZCO BOLIVAR FIORELLA ELIZABETH" || a.Descripcion != "SERVICIO PSICOLOGICO DE MAYO" || a.Observacion != "" ||
		a.Moneda != "PEN" || a.RentaBruta != 460 || a.RentaNeta != 460 || a.Gratuito {
		t.Errorf("fila 1: %+v", a)
	}
	b := items[1]
	if !b.Anulado || b.Estado != "ANULADO" || !b.Gratuito || b.Moneda != "USD" || b.RentaBruta != 1900.5 || b.Pendiente != 100 || b.Observacion != "MODALIDAD MENSUAL" {
		t.Errorf("fila 2: %+v", b)
	}
}

func TestParseRheSolReport_formatoInesperado(t *testing.T) {
	var ae *SunatSolAccessError
	if _, err := parseRheSolReport([]byte("<html>Pagina de Error</html>")); !errors.As(err, &ae) || ae.Code != SunatAccessUnexpected {
		t.Errorf("un reporte que no es el esperado debía fallar con detalle: %v", err)
	}
	items, err := parseRheSolReport(rheSolReport())
	if err != nil || len(items) != 0 {
		t.Errorf("un reporte solo con encabezado es válido y vacío: %d %v", len(items), err)
	}
}

func TestRheSolWindows(t *testing.T) {
	loc := limaLocation()
	day := func(m time.Month, d int) time.Time { return time.Date(2026, m, d, 0, 0, 0, 0, loc) }
	w := rheSolWindows(day(1, 1), day(1, 31))
	if len(w) != 1 {
		t.Fatalf("31 días caben en un tramo: %d", len(w))
	}
	w = rheSolWindows(day(1, 1), day(3, 15))
	if len(w) != 3 || !w[0][1].Equal(day(1, 31)) || !w[1][0].Equal(day(2, 1)) || !w[2][1].Equal(day(3, 15)) {
		t.Errorf("tramos: %v", w)
	}
	for _, x := range w {
		if int(x[1].Sub(x[0]).Hours()/24)+1 > 31 {
			t.Errorf("un tramo pasa de 31 días: %v", x)
		}
	}
}

func TestRheSolValidateRange(t *testing.T) {
	s := &RheSolService{now: func() time.Time { return time.Date(2026, 11, 10, 12, 0, 0, 0, time.UTC) }}
	if _, _, err := s.ValidateRange("2026-06-01", "2026-11-10"); err != nil {
		t.Errorf("rango válido: %v", err)
	}
	bad := map[[2]string]string{
		{"01/06/2026", "2026-11-10"}: "AAAA-MM-DD",
		{"2026-11-10", "2026-06-01"}: "mayor",
		{"2026-06-01", "2026-11-11"}: "posterior a hoy",
		{"2025-01-01", "2026-11-10"}: "máximo",
	}
	for in, want := range bad {
		_, _, err := s.ValidateRange(in[0], in[1])
		var ae *SunatSolAccessError
		if !errors.As(err, &ae) || ae.Code != SunatAccessInvalidParams || !strings.Contains(ae.Message, want) {
			t.Errorf("%v: esperaba «%s», obtuve %v", in, want, err)
		}
	}
}

// fakeSunatRhe imita el Menú SOL y la pantalla «Consulta Receptor».
type fakeSunatRhe struct {
	srv      *httptest.Server
	searches []map[string]string
	downs    int
	salio    bool
	// reports por orden de búsqueda; un nil significa «sin registros»; la cadena "ERR" devuelve la página de error.
	reports []any
}

func newFakeSunatRhe(t *testing.T, reports ...any) *fakeSunatRhe {
	f := &fakeSunatRhe{reports: reports}
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
		if r.URL.Query().Get("action") == "execute" && r.URL.Query().Get("code") == rheSolMenuCode {
			http.Redirect(w, r, rheSolFormPath, http.StatusFound)
			return
		}
		_, _ = io.WriteString(w, `<html><script>var subdominio = 'ww1';</script></html>`)
	})
	mux.HandleFunc(rheSolFormPath, func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			_, _ = io.WriteString(w, `<html><title>Consulta Receptor</title><form name="lista"></form></html>`)
			return
		}
		r.ParseForm()
		switch r.PostForm.Get("accion") {
		case "CapturaCriterioConsulatRec1":
			m := map[string]string{}
			for k := range r.PostForm {
				m[k] = r.PostForm.Get(k)
			}
			m["tipocomprobante1"] = strings.Join(r.PostForm["tipocomprobante1"], ",")
			f.searches = append(f.searches, m)
			var rep any
			if n := len(f.searches) - 1; n < len(f.reports) {
				rep = f.reports[n]
			}
			switch v := rep.(type) {
			case nil:
				_, _ = io.WriteString(w, `<html>1 a 0 de 0 <b>No se han encontrado registros para los parametros ingresados</b></html>`)
			case string:
				_, _ = io.WriteString(w, `<html><title>.:: Pagina de Error ::.</title>Se produjo un error al grabar el comprobante.</html>`)
			default:
				_ = v
				_, _ = io.WriteString(w, `<html>1 a 2 de 2 <a href="javascript:descargaArchivo()">Descargar Reporte</a></html>`)
			}
		case "descargaConsultaReceptor":
			f.downs++
			if n := len(f.searches) - 1; n >= 0 && n < len(f.reports) {
				if b, ok := f.reports[n].([]byte); ok {
					_, _ = w.Write(b)
					return
				}
			}
			w.WriteHeader(500)
		}
	})
	f.srv = httptest.NewServer(mux)
	t.Cleanup(f.srv.Close)
	return f
}

func newRheSolTest(t *testing.T, f *fakeSunatRhe) (*RheSolService, models.Company) {
	db := setupCompanyRucTestDB(t)
	if err := db.AutoMigrate(&models.CompanyAccessCredential{}, &models.CompanyAccessLog{}, &models.RheSolHistory{}); err != nil {
		t.Fatal(err)
	}
	co := models.Company{RUC: "20111111111", BusinessName: "Empresa", Status: "activo", ClientType: models.CompanyClientTypeEstudio}
	db.Create(&co)
	db.Create(&models.CompanyAccessCredential{CompanyID: co.ID, SolUsuario: "USUARIO", SolClave: "clave"})
	svc := NewRheSolService()
	svc.now = func() time.Time { return time.Date(2026, 11, 10, 12, 0, 0, 0, time.UTC) }
	svc.linkFn = func(uint, []uint, uint) (string, error) { return f.srv.URL + "/cl-ti-itmenu/MenuInternet.htm?x=1", nil }
	return svc, co
}

func TestRheSolQuery_unaBusquedaPorTramoYBajaElReporte(t *testing.T) {
	// Rango de 2 meses y medio → 3 tramos: el 1.º con datos, el 2.º sin registros, el 3.º con datos.
	f := newFakeSunatRhe(t, rheSolReport(rheRow1), nil, rheSolReport(rheRow2))
	svc, co := newRheSolTest(t, f)
	res, err := svc.Query(co.ID, nil, 1, "2026-06-01", "2026-08-15")
	if err != nil {
		t.Fatal(err)
	}
	if len(f.searches) != 3 || f.downs != 2 || res.Consultas != 3 {
		t.Fatalf("búsquedas=%d descargas=%d consultas=%d", len(f.searches), f.downs, res.Consultas)
	}
	first := f.searches[0]
	if first["fec_desde"] != "01/06/2026" || first["fec_hasta"] != "01/07/2026" { // 31 días: 01/06 a 01/07
		t.Errorf("fechas del primer tramo: %v", first)
	}
	if first["accion"] != "CapturaCriterioConsulatRec1" || first["tipocomprobante"] != "01;02;03;" || first["tipoestado"] != "00" || first["tipocomprobante1"] != "01,02,03" {
		t.Errorf("campos de la búsqueda: %v", first)
	}
	if f.searches[2]["fec_hasta"] != "15/08/2026" {
		t.Errorf("el último tramo termina en «hasta»: %v", f.searches[2])
	}
	if res.Total != 2 || res.Items[0].Comprobante != "E001-41" || res.Items[1].Comprobante != "E001-40" {
		t.Errorf("resultado (más reciente primero): %+v", res.Items)
	}
	if !f.salio {
		t.Error("debía cerrar la sesión de SOL")
	}
}

func TestRheSolQuery_sinRegistrosYErrorDeSunat(t *testing.T) {
	f := newFakeSunatRhe(t, nil)
	svc, co := newRheSolTest(t, f)
	res, err := svc.Query(co.ID, nil, 1, "2026-10-01", "2026-10-31")
	if err != nil || res.Total != 0 || len(res.Items) != 0 || f.downs != 0 {
		t.Fatalf("sin registros: %+v %v descargas=%d", res, err, f.downs)
	}
	f2 := newFakeSunatRhe(t, "ERR")
	svc2, co2 := newRheSolTest(t, f2)
	var ae *SunatSolAccessError
	if _, err := svc2.Query(co2.ID, nil, 1, "2026-10-01", "2026-10-31"); !errors.As(err, &ae) || ae.Code != SunatAccessUnexpected || !strings.Contains(ae.Detail, "error") {
		t.Errorf("la página de error de SUNAT debía salir como error con detalle: %v", err)
	}
}

func TestRheSolQuery_rangoInvalidoNoEntraASolYLoginFallido(t *testing.T) {
	f := newFakeSunatRhe(t)
	svc, co := newRheSolTest(t, f)
	called := false
	svc.linkFn = func(uint, []uint, uint) (string, error) { called = true; return "", nil }
	if _, err := svc.Query(co.ID, nil, 1, "2026-10-31", "2026-10-01"); err == nil || called {
		t.Fatalf("debía fallar sin entrar a SOL: %v called=%v", err, called)
	}
	svc.linkFn = func(uint, []uint, uint) (string, error) { return "", accessErr(SunatAccessBadCreds, "rechazada", "") }
	var ae *SunatSolAccessError
	if _, err := svc.Query(co.ID, nil, 1, "2026-10-01", "2026-10-31"); !errors.As(err, &ae) || ae.Code != SunatAccessBadCreds {
		t.Fatalf("esperaba credenciales_rechazadas: %v", err)
	}
	if _, err := svc.Query(co.ID, []uint{9999}, 1, "2026-10-01", "2026-10-31"); err == nil {
		t.Fatal("una empresa fuera del alcance no se puede consultar")
	}
}

func TestRheSolHistory_guardaListaYQuita(t *testing.T) {
	f := newFakeSunatRhe(t, rheSolReport(rheRow1))
	svc, co := newRheSolTest(t, f)
	res, err := svc.Query(co.ID, nil, 1, "2026-06-01", "2026-06-30")
	if err != nil {
		t.Fatal(err)
	}
	id1 := svc.RecordHistory(co.ID, 3, "2026-06-01", "2026-06-30", res, nil)
	id2 := svc.RecordHistory(co.ID, 3, "2026-05-01", "2026-05-31", &RheSolResult{}, nil)
	id3 := svc.RecordHistory(co.ID, 3, "2026-04-01", "2026-04-30", nil, accessErr(SunatAccessUnavailable, "SUNAT no responde", "HTTP 503"))
	if id1 == 0 || id2 == 0 || id3 == 0 {
		t.Fatalf("debía guardar todas: %d %d %d", id1, id2, id3)
	}
	rows, err := svc.ListHistory(co.ID)
	if err != nil || len(rows) != 3 || rows[0].ID != id3 || rows[0].Status != models.RheSolHistoryFailed || rows[0].ErrorCode != SunatAccessUnavailable {
		t.Fatalf("historial: %+v %v", rows, err)
	}
	if rows[1].Status != models.RheSolHistoryNoData || rows[2].Status != models.RheSolHistoryReady || rows[2].Total != 1 || len(rows[2].Data) != 0 {
		t.Errorf("estados: %+v / %+v", rows[1], rows[2])
	}
	row, got, err := svc.GetHistory(co.ID, id1)
	if err != nil || row.ID != id1 || got == nil || len(got.Items) != 1 || got.Items[0].EmisorNombre != "AÑAZCO BOLIVAR FIORELLA ELIZABETH" {
		t.Fatalf("resultado guardado: %+v %v", got, err)
	}
	if _, _, err := svc.GetHistory(co.ID+1, id1); err == nil {
		t.Error("la consulta de otra empresa no se puede leer")
	}
	if err := svc.DeleteHistory(co.ID, id2); err != nil {
		t.Fatal(err)
	}
	if n, err := svc.ClearHistory(co.ID); err != nil || n != 2 {
		t.Errorf("limpiar: %d %v", n, err)
	}
}
