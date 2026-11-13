package services

import (
	"archive/zip"
	"bytes"
	"errors"
	"io"
	"strings"
	"testing"
	"time"

	"miappfiber/database"
	"miappfiber/models"

	"github.com/xuri/excelize/v2"
)

// Respuesta real de «consultar» de la plataforma de Pagos (EL RANCHO, periodo 202608); se conservan los campos y se
// cambia lo que no hace falta.
const spotSunatJSON = `{"cod":200,"msg":"","resultado":[
{"num_pres":7857650143,"cod_usuario_sol":"USUARIO","des_prov":"PROVEEDOR DE PRUEBA S.A","cod_tipcomprobante":"01","num_ruc_proveedor":"20456179470","per_tributario":"202608","fec_pago_desc":"2026-11-04","num_npd":"0001967090707","des_adq":"EMPRESA DE PRUEBA E.I.R.L.","num_constancia":"319928191","tip_bien":"037","tip_operacion":"01","num_doc_adq":"20111111111","mto_deposito_desc":"93.00","num_cuenta":"00101333396","mto_deposito":93.00,"num_comprobante":"00002344","fec_pago":1793821085000,"tip_doc_adq":"06","num_serie":"F100","origen_desc":"WEB SUNAT","cod_tipcta":"1"},
{"num_pres":7857650143,"cod_usuario_sol":"USUARIO","des_prov":"PROVEEDOR DE PRUEBA S.A","cod_tipcomprobante":"01","num_ruc_proveedor":"20456179470","per_tributario":"202608","fec_pago_desc":"2026-11-04","num_npd":"0001967090707","des_adq":"EMPRESA DE PRUEBA E.I.R.L.","num_constancia":"319928190","tip_bien":"019","tip_operacion":"01","num_doc_adq":"20111111111","mto_deposito_desc":"258.00","num_cuenta":"00101333396","mto_deposito":258.00,"num_comprobante":"00002343","fec_pago":1793821085000,"tip_doc_adq":"06","num_serie":"F100","origen_desc":"WEB SUNAT","cod_tipcta":"1"}]}`

func TestParseSpotList(t *testing.T) {
	rows, err := parseSpotList(200, []byte(spotSunatJSON))
	if err != nil || len(rows) != 2 {
		t.Fatalf("lista: %d %v", len(rows), err)
	}
	r := rows[0]
	// Los números largos llegan como texto exacto (sin notación científica).
	if r["num_pres"] != "7857650143" || r["num_constancia"] != "319928191" || r["mto_deposito"] != "93.00" && r["mto_deposito"] != "93" || r["des_prov"] != "PROVEEDOR DE PRUEBA S.A" {
		t.Errorf("campos: %+v", r)
	}

	// Sin resultados: lista vacía, no error.
	for _, raw := range []string{`{"cod":200,"msg":"","resultado":[]}`, `{"cod":200,"msg":""}`, `{"cod":200,"resultado":null}`} {
		if rows, err := parseSpotList(200, []byte(raw)); err != nil || len(rows) != 0 {
			t.Errorf("%s: %v %v", raw, rows, err)
		}
	}

	// Errores de validación de SUNAT: el mensaje llega limpio, sin etiquetas.
	var ae *SunatSolAccessError
	_, err = parseSpotList(200, []byte(`{"cod":412,"msg":"Precondition Failed","errores":[{"cod":41205,"msg":"Error de Fechas: Ingrese un intervalo válido.<br>El rango de fechas máximo que puede consultar es de 30 días."}]}`))
	if !errors.As(err, &ae) || ae.Code != SunatAccessInvalidParams || !strings.Contains(ae.Message, "30 días") || strings.Contains(ae.Message, "<br>") {
		t.Errorf("error de SUNAT: %v", err)
	}
	if _, err := parseSpotList(502, []byte(`<html>502 Bad Gateway</html>`)); !errors.As(err, &ae) || ae.Code != SunatAccessUnexpected {
		t.Errorf("HTTP 502: %v", err)
	}
	if _, err := parseSpotList(200, []byte(`<html>sesion</html>`)); !errors.As(err, &ae) || ae.Code != SunatAccessUnexpected {
		t.Errorf("no JSON: %v", err)
	}
}

func TestValidateSpotFilter(t *testing.T) {
	s := &SunatSpotService{now: func() time.Time { return time.Date(2026, 11, 13, 12, 0, 0, 0, time.UTC) }}
	ok := []SpotFilter{
		{TipoCuenta: "1", TipoPago: "individuales", Modo: "fecha", Desde: "2026-10-15", Hasta: "2026-11-13"}, // 30 días justos
		{TipoCuenta: "1", TipoPago: "individuales", Modo: "periodo", Periodo: "202608"},
		{TipoCuenta: "1", TipoPago: "individuales", Modo: "periodo", Periodo: "202611"}, // el mes actual
		{TipoCuenta: "3", TipoPago: "masivos", Modo: "fecha", Desde: "2026-11-01", Hasta: "2026-11-13"},
		{TipoCuenta: "1", TipoPago: "pasajeros", Modo: "fecha", Desde: "2026-11-13", Hasta: "2026-11-13"},
	}
	for _, f := range ok {
		if _, err := s.Validate(f); err != nil {
			t.Errorf("%+v debía ser válido: %v", f, err)
		}
	}
	// Por periodo se descartan las fechas; por fecha, el periodo (SUNAT no acepta ambos).
	g, _ := s.Validate(SpotFilter{TipoCuenta: "1", TipoPago: "individuales", Modo: "periodo", Periodo: "202608", Desde: "2026-01-01", Hasta: "2026-01-02"})
	if g.Desde != "" || g.Hasta != "" || g.Periodo != "202608" {
		t.Errorf("por periodo: %+v", g)
	}
	g, _ = s.Validate(SpotFilter{TipoCuenta: "1", TipoPago: "individuales", Modo: "fecha", Desde: "2026-11-01", Hasta: "2026-11-05", Periodo: "202608"})
	if g.Periodo != "" {
		t.Errorf("por fecha: %+v", g)
	}

	bad := []struct {
		f    SpotFilter
		want string
	}{
		{SpotFilter{TipoCuenta: "", TipoPago: "individuales", Modo: "fecha"}, "tipo de cuenta"},
		{SpotFilter{TipoCuenta: "9", TipoPago: "individuales", Modo: "fecha"}, "tipo de cuenta"},
		{SpotFilter{TipoCuenta: "1", TipoPago: "otros", Modo: "fecha"}, "tipo de pago"},
		{SpotFilter{TipoCuenta: "2", TipoPago: "masivos", Modo: "fecha", Desde: "2026-11-01", Hasta: "2026-11-02"}, "no existe para el tipo de cuenta"},
		{SpotFilter{TipoCuenta: "3", TipoPago: "pasajeros", Modo: "fecha", Desde: "2026-11-01", Hasta: "2026-11-02"}, "no existe para el tipo de cuenta"},
		{SpotFilter{TipoCuenta: "1", TipoPago: "individuales", Modo: ""}, "fecha de pago o por periodo"},
		{SpotFilter{TipoCuenta: "1", TipoPago: "individuales", Modo: "fecha", Desde: "13/11/2026", Hasta: "13/11/2026"}, "AAAA-MM-DD"},
		{SpotFilter{TipoCuenta: "1", TipoPago: "individuales", Modo: "fecha", Desde: "2026-11-10", Hasta: "2026-11-01"}, "no puede ser mayor"},
		{SpotFilter{TipoCuenta: "1", TipoPago: "individuales", Modo: "fecha", Desde: "2026-10-14", Hasta: "2026-11-13"}, "máximo es de 30"},
		{SpotFilter{TipoCuenta: "1", TipoPago: "individuales", Modo: "fecha", Desde: "2026-11-10", Hasta: "2026-11-14"}, "posterior a hoy"},
		{SpotFilter{TipoCuenta: "1", TipoPago: "individuales", Modo: "periodo", Periodo: "2026"}, "AAAAMM"},
		{SpotFilter{TipoCuenta: "1", TipoPago: "individuales", Modo: "periodo", Periodo: "202613"}, "AAAAMM"},
		{SpotFilter{TipoCuenta: "1", TipoPago: "individuales", Modo: "periodo", Periodo: "200408"}, "anterior a 200409"},
		{SpotFilter{TipoCuenta: "1", TipoPago: "individuales", Modo: "periodo", Periodo: "202612"}, "posterior al mes actual"},
		{SpotFilter{TipoCuenta: "1", TipoPago: "masivos", Modo: "periodo", Periodo: "202608"}, "solo se consultan los pagos individuales"},
	}
	for _, c := range bad {
		_, err := s.Validate(c.f)
		var ae *SunatSolAccessError
		if !errors.As(err, &ae) || ae.Code != SunatAccessInvalidParams || !strings.Contains(ae.Message, c.want) {
			t.Errorf("%+v: esperaba error con %q, obtuve %v", c.f, c.want, err)
		}
	}
}

func TestSpotExcel_mismasColumnasQueLaReferencia(t *testing.T) {
	rows, _ := parseSpotList(200, []byte(spotSunatJSON))
	f := SpotFilter{TipoCuenta: "1", TipoPago: "individuales", Modo: "periodo", Periodo: "202608"}
	raw, err := SpotExcel(rows, f)
	if err != nil {
		t.Fatal(err)
	}
	x, err := excelize.OpenReader(bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	defer x.Close()
	if x.GetSheetName(0) != "Detracciones" {
		t.Errorf("hoja: %q", x.GetSheetName(0))
	}
	got, _ := x.GetRows("Detracciones")
	if len(got) != 3 {
		t.Fatalf("filas: %d", len(got))
	}
	wantHead := []string{"Tipo Comp.", "Serie", "Número Comp.", "Periodo Trib.", "Tipo Doc Adq", "RUC Proveedor", "Nombre Proveedor", "Nro Constancia", "Monto", "Fecha Pago",
		"Tipo Cuenta ID", "Nro Cuenta Banco", "Tipo Bien", "Tipo Oper.", "Doc Adquiriente", "Adquiriente", "Nro Pago Detracciones", "Desc. Cuenta"}
	if strings.Join(got[0], "|") != strings.Join(wantHead, "|") {
		t.Errorf("encabezado: %v", got[0])
	}
	// Primera fila: igual a la del reporte de la referencia (con los datos de esta prueba).
	wantRow := []string{"01", "F100", "00002344", "202608", "06", "20456179470", "PROVEEDOR DE PRUEBA S.A", "319928191", "93", "04/11/2026", "1", "00101333396", "037", "01", "20111111111", "EMPRESA DE PRUEBA E.I.R.L.", "0001967090707", "Convencional"}
	if strings.Join(got[1], "|") != strings.Join(wantRow, "|") {
		t.Errorf("fila 1:\n got  %v\n want %v", got[1], wantRow)
	}
	// El monto es un número (se puede sumar), no texto.
	if v, _ := x.GetCellValue("Detracciones", "I3"); v != "258" {
		t.Errorf("monto: %q", v)
	}
	if n, _ := x.GetCellType("Detracciones", "I3"); n != excelize.CellTypeNumber && n != excelize.CellTypeUnset {
		t.Errorf("tipo de celda del monto: %v", n)
	}
}

func TestSpotReportName(t *testing.T) {
	if n := SpotReportName(SpotFilter{Modo: "periodo", Periodo: "202608"}, "20605127721"); n != "Reporte_Detracciones_202608_20605127721.xlsx" {
		t.Errorf("por periodo: %s", n)
	}
	if n := SpotReportName(SpotFilter{Modo: "fecha", Desde: "2026-10-15", Hasta: "2026-11-13"}, "20605127721"); n != "Reporte_Detracciones_20261015_20261113_20605127721.xlsx" {
		t.Errorf("por fecha: %s", n)
	}
}

func TestSpotConstanciaHTML_arreglaLosAcentos(t *testing.T) {
	raw := []byte("<html>\n<head>\n<title>Constancia</title></head><body><td>01 - Venta de bienes o prestaciÃ³n de servicios</td><td>037 - DemÃ¡s Servicios</td></body></html>")
	out := string(spotConstanciaHTML(raw))
	if !strings.Contains(out, "prestación de servicios") || !strings.Contains(out, "Demás Servicios") {
		t.Errorf("acentos: %s", out)
	}
	if strings.Contains(out, "ruxit") || strings.Contains(out, "<script") {
		t.Errorf("el script de SUNAT debía quitarse: %s", out)
	}
	if !strings.Contains(strings.ToLower(out), `<meta charset="utf-8">`) {
		t.Errorf("sin charset: %s", out)
	}
	// Un HTML que ya está bien no se toca.
	ok := "<html><head><meta charset=\"utf-8\"></head><body>Depósito</body></html>"
	if string(spotConstanciaHTML([]byte(ok))) != ok {
		t.Error("un HTML correcto no se debe cambiar")
	}
}

// fakeSpotAPI imita la sesión de la plataforma de Pagos.
type fakeSpotAPI struct {
	rows       []spotRow
	filter     SpotFilter
	pedidas    []string
	fallan     map[string]bool
	consultaEr error
	cerrada    bool
}

func (f *fakeSpotAPI) consultar(fl SpotFilter) ([]spotRow, error) {
	f.filter = fl
	return f.rows, f.consultaEr
}
func (f *fakeSpotAPI) constancia(n string, _ int) ([]byte, error) {
	f.pedidas = append(f.pedidas, n)
	if f.fallan[n] {
		return nil, accessErr(SunatAccessUnexpected, "SUNAT no entregó la constancia.", n)
	}
	return []byte("<html><head></head><body>CONSTANCIA " + n + "</body></html>"), nil
}
func (f *fakeSpotAPI) constanciaMasiva(n string) ([]byte, error) {
	f.pedidas = append(f.pedidas, "M"+n)
	return []byte("TXT " + n), nil
}
func (f *fakeSpotAPI) close() { f.cerrada = true }

func newSpotTest(t *testing.T, api *fakeSpotAPI) (*SunatSpotService, models.Company) {
	db := setupCompanyRucTestDB(t)
	if err := db.AutoMigrate(&models.CompanyAccessCredential{}, &models.CompanyAccessLog{}, &models.DetraccionDownload{}); err != nil {
		t.Fatal(err)
	}
	co := models.Company{RUC: "20111111111", BusinessName: "Empresa", Status: "activo", ClientType: models.CompanyClientTypeEstudio}
	db.Create(&co)
	db.Create(&models.CompanyAccessCredential{CompanyID: co.ID, SolUsuario: "USUARIO", SolClave: "clave"})
	svc := NewSunatSpotService()
	svc.async = false
	svc.pace = 0
	svc.now = func() time.Time { return time.Date(2026, 11, 13, 12, 0, 0, 0, time.UTC) }
	svc.linkFn = func(uint, []uint, uint) (string, error) { return "https://example.test/enlace", nil }
	svc.openFn = func(string, time.Duration) (spotAPI, error) { return api, nil }
	return svc, co
}

func zipNames(t *testing.T, data []byte) map[string][]byte {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	out := map[string][]byte{}
	for _, f := range zr.File {
		rc, _ := f.Open()
		b, _ := io.ReadAll(rc)
		rc.Close()
		out[f.Name] = b
	}
	return out
}

func TestSpotStart_bajaLasConstanciasYGuardaExcelYZip(t *testing.T) {
	rows, _ := parseSpotList(200, []byte(spotSunatJSON))
	api := &fakeSpotAPI{rows: rows}
	svc, co := newSpotTest(t, api)

	row, err := svc.Start(co.ID, nil, 7, SpotFilter{TipoCuenta: "1", TipoPago: "individuales", Modo: "periodo", Periodo: "202608"})
	if err != nil {
		t.Fatal(err)
	}
	if row.Status != models.DetraccionDownloadRunning || row.Periodo != "202608" || row.RequestedBy != 7 {
		t.Errorf("la fila nace en proceso: %+v", row)
	}
	// Con periodo, las fechas van vacías (como la pantalla de SUNAT).
	if api.filter.Periodo != "202608" || api.filter.Desde != "" || api.filter.TipoCuenta != "1" {
		t.Errorf("filtro enviado: %+v", api.filter)
	}
	if !api.cerrada {
		t.Error("debía cerrar la sesión de Pagos")
	}
	if strings.Join(api.pedidas, ",") != "319928191,319928190" {
		t.Errorf("constancias pedidas: %v", api.pedidas)
	}
	list, _ := svc.ListHistory(co.ID)
	if len(list) != 1 || list[0].Status != models.DetraccionDownloadReady || list[0].Total != 2 || list[0].Bajadas != 2 || list[0].Monto != 351 || len(list[0].Zip) != 0 || list[0].FinishedAt == nil {
		t.Fatalf("fila terminada: %+v", list)
	}
	_, zipBytes, err := svc.GetZip(co.ID, row.ID)
	if err != nil {
		t.Fatal(err)
	}
	files := zipNames(t, zipBytes)
	if len(files) != 3 || files["constancias/Constancia_319928191.html"] == nil || files["constancias/Constancia_319928190.html"] == nil || files["Reporte_Detracciones_202608_20111111111.xlsx"] == nil {
		names := []string{}
		for k := range files {
			names = append(names, k)
		}
		t.Fatalf("archivos del ZIP: %v", names)
	}
	name, xlsx, err := ZipExcel(zipBytes)
	if err != nil || name != "Reporte_Detracciones_202608_20111111111.xlsx" || len(xlsx) == 0 {
		t.Errorf("ZipExcel: %q %d %v", name, len(xlsx), err)
	}
}

func TestSpotStart_sinResultadosErroresYConstanciasQueFallan(t *testing.T) {
	api := &fakeSpotAPI{}
	svc, co := newSpotTest(t, api)
	f := SpotFilter{TipoCuenta: "1", TipoPago: "individuales", Modo: "fecha", Desde: "2026-11-01", Hasta: "2026-11-13"}

	// Sin resultados.
	if _, err := svc.Start(co.ID, nil, 1, f); err != nil {
		t.Fatal(err)
	}
	list, _ := svc.ListHistory(co.ID)
	if len(list) != 1 || list[0].Status != models.DetraccionDownloadNoData || list[0].Total != 0 {
		t.Fatalf("sin resultados: %+v", list)
	}

	// Una constancia que no se baja: la descarga termina igual, con el aviso, y el Excel trae todos los pagos.
	api.rows, _ = parseSpotList(200, []byte(spotSunatJSON))
	api.fallan = map[string]bool{"319928190": true}
	if _, err := svc.Start(co.ID, nil, 1, f); err != nil {
		t.Fatal(err)
	}
	list, _ = svc.ListHistory(co.ID)
	if list[0].Status != models.DetraccionDownloadReady || list[0].Total != 2 || list[0].Bajadas != 1 || !strings.Contains(list[0].Aviso, "1 constancia no se pudo bajar") {
		t.Fatalf("constancia fallida: %+v", list[0])
	}
	_, zipBytes, _ := svc.GetZip(co.ID, list[0].ID)
	if files := zipNames(t, zipBytes); len(files) != 2 || files["constancias/Constancia_319928191.html"] == nil {
		t.Errorf("zip: %v", len(files))
	}

	// Error de SUNAT en la consulta: la fila guarda el error.
	api.consultaEr = accessErr(SunatAccessInvalidParams, "Error de Fechas", "consultar: cod 412")
	svc.Start(co.ID, nil, 1, f)
	list, _ = svc.ListHistory(co.ID)
	if list[0].Status != models.DetraccionDownloadFailed || list[0].ErrorCode != SunatAccessInvalidParams || list[0].ErrorMessage != "Error de Fechas" {
		t.Fatalf("error de consulta: %+v", list[0])
	}

	// Login rechazado: la sesión de Pagos ni se abre.
	opened := false
	svc.openFn = func(string, time.Duration) (spotAPI, error) { opened = true; return api, nil }
	svc.linkFn = func(uint, []uint, uint) (string, error) {
		return "", accessErr(SunatAccessBadCreds, "Credenciales rechazadas", "302")
	}
	svc.Start(co.ID, nil, 1, f)
	list, _ = svc.ListHistory(co.ID)
	if opened || list[0].Status != models.DetraccionDownloadFailed || list[0].ErrorCode != SunatAccessBadCreds {
		t.Fatalf("login rechazado: %+v opened=%v", list[0], opened)
	}

	// Filtros inválidos o empresa fuera del alcance: ni siquiera queda en el historial.
	n := len(list)
	if _, err := svc.Start(co.ID, nil, 1, SpotFilter{TipoCuenta: "1", TipoPago: "individuales", Modo: "fecha", Desde: "2026-09-01", Hasta: "2026-11-13"}); err == nil {
		t.Error("un rango de más de 30 días debía fallar")
	}
	if _, err := svc.Start(co.ID, []uint{9999}, 1, f); err == nil {
		t.Error("una empresa fuera del alcance no se puede consultar")
	}
	if list, _ = svc.ListHistory(co.ID); len(list) != n {
		t.Errorf("las inválidas no se guardan: %d vs %d", len(list), n)
	}

	// Quitar y limpiar.
	if err := svc.DeleteHistory(co.ID, list[0].ID); err != nil {
		t.Error(err)
	}
	if err := svc.DeleteHistory(co.ID, 99999); err == nil {
		t.Error("quitar una descarga que no existe debía fallar")
	}
	if _, err := svc.ClearHistory(co.ID); err != nil {
		t.Error(err)
	}
	if list, _ = svc.ListHistory(co.ID); len(list) != 0 {
		t.Errorf("historial limpio: %d", len(list))
	}
}

func TestSpotStart_unaSolaDescargaALaVez(t *testing.T) {
	api := &fakeSpotAPI{}
	svc, co := newSpotTest(t, api)
	// Hay una descarga en proceso reciente: no se acepta otra.
	svc.async = false
	f := SpotFilter{TipoCuenta: "1", TipoPago: "individuales", Modo: "fecha", Desde: "2026-11-01", Hasta: "2026-11-13"}
	enProceso := models.DetraccionDownload{CompanyID: co.ID, TipoCuenta: "1", TipoPago: "individuales", Modo: "fecha", Status: models.DetraccionDownloadRunning, CreatedAt: svc.now()}
	if err := database.DB.Create(&enProceso).Error; err != nil {
		t.Fatal(err)
	}
	_, err := svc.Start(co.ID, nil, 1, f)
	var ae *SunatSolAccessError
	if !errors.As(err, &ae) || ae.Code != SunatAccessInProgress {
		t.Fatalf("debía rechazar: %v", err)
	}
	// Si lleva demasiado «en proceso» (el servidor se reinició), se da por fallida y se acepta la nueva.
	svc.now = func() time.Time { return time.Date(2026, 11, 13, 13, 0, 0, 0, time.UTC) }
	if _, err := svc.Start(co.ID, nil, 1, f); err != nil {
		t.Fatalf("tras vencer la anterior: %v", err)
	}
	list, _ := svc.ListHistory(co.ID)
	var interrumpida bool
	for _, r := range list {
		interrumpida = interrumpida || r.ErrorCode == "interrumpida"
	}
	if !interrumpida {
		t.Errorf("la vieja debía quedar interrumpida: %+v", list)
	}
}
