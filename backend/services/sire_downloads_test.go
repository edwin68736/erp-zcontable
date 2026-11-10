package services

import (
	"archive/zip"
	"bytes"
	"net/http"
	"strings"
	"testing"
	"time"

	"miappfiber/database"
	"miappfiber/models"

	"github.com/xuri/excelize/v2"
	"gorm.io/gorm"
)

func sireDlSetup(t *testing.T, f *fakeSire) (*SireService, *SireSession, uint, *gorm.DB) {
	t.Helper()
	db := setupCompanyRucTestDB(t)
	if err := db.AutoMigrate(&models.CompanyAccessCredential{}, &models.CompanyAccessLog{}, &models.SireDownload{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	// SQLite en memoria: cada conexión nueva sería otra base vacía, y el proceso en segundo plano usa otra goroutine.
	if sqlDB, err := db.DB(); err == nil {
		sqlDB.SetMaxOpenConns(1)
	}
	old := sireDlPollInterval
	sireDlPollInterval = 5 * time.Millisecond
	t.Cleanup(func() { sireDlPollInterval = old })
	co := models.Company{RUC: "20123456789", BusinessName: "Empresa SAC", Status: "activo", ClientType: models.CompanyClientTypeEstudio}
	if err := db.Create(&co).Error; err != nil {
		t.Fatal(err)
	}
	ss := f.session(t, co.ID)
	return ss.svc, ss, co.ID, db
}

func sireDlWait(t *testing.T, id uint) models.SireDownload {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		var r models.SireDownload
		if err := database.DB.First(&r, id).Error; err == nil && r.Status != models.SireDownloadProcessing {
			return r
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("la descarga %d no terminó", id)
	return models.SireDownload{}
}

func zipTxt(t *testing.T, name, content string) []byte {
	t.Helper()
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	fw, _ := w.Create(name)
	_, _ = fw.Write([]byte(content))
	_ = w.Close()
	return buf.Bytes()
}

// sireDlHandler responde el flujo completo de la propuesta: ticket → estado → archivo.
func sireDlHandler(state string, withFile bool, txt []byte) func(w http.ResponseWriter, r *http.Request) {
	return func(w http.ResponseWriter, r *http.Request) {
		p := strings.TrimPrefix(r.URL.Path, "/v1/contribuyente/migeigv/libros/")
		switch {
		case strings.Contains(p, "propuesta/web/propuesta/") && strings.HasSuffix(p, "/exportapropuesta"), strings.HasSuffix(p, "/exportacioncomprobantepropuesta"):
			_, _ = w.Write([]byte(`{"numTicket":"20260300000099"}`))
		case strings.HasSuffix(p, "consultaestadotickets"):
			files := ""
			if withFile {
				files = `,"archivoReporte":[{"codTipoAchivoReporte":"0","nomArchivoReporte":"propuesta.zip"}]`
			}
			_, _ = w.Write([]byte(`{"registros":[{"numTicket":"20260300000099","codEstadoProceso":"` + state + `","codProceso":"10","perTributario":"202610"` + files + `}]}`))
		case strings.HasSuffix(p, "archivoreporte"):
			_, _ = w.Write(txt)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}
}

const sireDlTxt = "Ruc|Razon Social|Periodo|Tipo CP/Doc.|Nro CP o Doc. Nro Inicial (Rango)|Total CP\n" +
	"20123456789|EMPRESA SAC|202610|1|516|5550.72\n" +
	"20123456789|EMPRESA SAC|202610|1|517|997.92\n"

func TestSireDownload_FlujoCompletoGuardaElExcel(t *testing.T) {
	f := newFakeSire(t)
	f.handler = sireDlHandler("06", true, zipTxt(t, "propuesta.txt", sireDlTxt))
	svc, ss, companyID, _ := sireDlSetup(t, f)

	row, err := svc.StartDownload(ss, companyID, 5, "ventas", "202610", "")
	if err != nil || row.Status != models.SireDownloadProcessing || row.Mode != SireDownloadModeNoGlosas {
		t.Fatalf("StartDownload: %+v err=%v", row, err)
	}
	done := sireDlWait(t, row.ID)
	if done.Status != models.SireDownloadReady || done.Rows != 2 || done.Size == 0 || done.Ticket != "20260300000099" || done.FinishedAt == nil || done.Step != "" {
		t.Fatalf("resultado: %+v", done)
	}

	// Se puede bajar el Excel del historial sin volver a SUNAT.
	hits := f.apiHits
	data, name, err := svc.DownloadFile(companyID, row.ID, "20123456789")
	if err != nil || name != "20123456789-202610-SIREV-Propuesta.xlsx" {
		t.Fatalf("DownloadFile: name=%q err=%v", name, err)
	}
	if f.apiHits != hits {
		t.Errorf("no debe consultar a SUNAT al bajar del historial")
	}
	x, err := excelize.OpenReader(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("Excel inválido: %v", err)
	}
	defer x.Close()
	if v, _ := x.GetCellValue("Reporte Ventas", "A2"); v != "20123456789" {
		t.Errorf("A2 = %q", v)
	}
	// El listado no trae los bytes del archivo.
	list, _ := svc.ListDownloads(companyID, "")
	if len(list) != 1 || len(list[0].Data) != 0 || list[0].Status != models.SireDownloadReady {
		t.Errorf("listado: %+v", list)
	}
}

func TestSireDownload_SinMovimientosYErrores(t *testing.T) {
	f := newFakeSire(t)
	svc, ss, companyID, _ := sireDlSetup(t, f)

	// Terminado pero SUNAT no entrega archivo: sin movimientos.
	f.handler = sireDlHandler("06", false, nil)
	row, _ := svc.StartDownload(ss, companyID, 1, "compras", "202610", "sin_glosas")
	if d := sireDlWait(t, row.ID); d.Status != models.SireDownloadNoData {
		t.Fatalf("sin archivo: %+v", d)
	}

	// Archivo solo con encabezado: también sin movimientos.
	f.handler = sireDlHandler("06", true, zipTxt(t, "propuesta.txt", "Ruc|Total CP\n"))
	row, _ = svc.StartDownload(ss, companyID, 1, "compras", "202610", "")
	if d := sireDlWait(t, row.ID); d.Status != models.SireDownloadNoData {
		t.Fatalf("archivo vacío: %+v", d)
	}

	// Ticket con errores en SUNAT.
	f.handler = sireDlHandler("03", false, nil)
	row, _ = svc.StartDownload(ss, companyID, 1, "ventas", "202609", "")
	d := sireDlWait(t, row.ID)
	if d.Status != models.SireDownloadFailed || !strings.Contains(d.ErrorMessage, "terminó con errores") || d.ErrorCode != SireErrValidation {
		t.Fatalf("ticket con errores: %+v", d)
	}

	// Error de SUNAT al pedir el ticket: se guarda el motivo.
	f.handler = func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnprocessableEntity)
		_, _ = w.Write([]byte(`{"errors":[{"cod":"2001","msg":"Período no habilitado"}]}`))
	}
	row, _ = svc.StartDownload(ss, companyID, 1, "ventas", "202608", "")
	d = sireDlWait(t, row.ID)
	if d.Status != models.SireDownloadFailed || !strings.Contains(d.ErrorMessage, "Período no habilitado") {
		t.Fatalf("error al pedir: %+v", d)
	}

	// Parámetros inválidos: no se registra nada.
	for _, c := range [][3]string{{"otro", "202610", ""}, {"ventas", "2026", ""}, {"ventas", "202613", ""}, {"ventas", "202610", "con_glosas"}} {
		if _, err := svc.StartDownload(ss, companyID, 1, c[0], c[1], c[2]); err == nil {
			t.Errorf("%v debía fallar", c)
		}
	}
}

func TestSireDownload_UnaConsultaIgualEnProcesoNoSeDuplicaYLaNuevaReemplazaALaVieja(t *testing.T) {
	f := newFakeSire(t)
	release := make(chan struct{})
	inner := sireDlHandler("06", true, zipTxt(t, "propuesta.txt", sireDlTxt))
	f.handler = func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "consultaestadotickets") {
			<-release
		}
		inner(w, r)
	}
	svc, ss, companyID, db := sireDlSetup(t, f)

	a, _ := svc.StartDownload(ss, companyID, 1, "ventas", "202610", "")
	b, _ := svc.StartDownload(ss, companyID, 2, "ventas", "202610", "")
	if a.ID != b.ID {
		t.Fatalf("la misma consulta en proceso no debe duplicarse: %d y %d", a.ID, b.ID)
	}
	close(release)
	first := sireDlWait(t, a.ID)
	if first.Status != models.SireDownloadReady {
		t.Fatalf("primera: %+v", first)
	}

	// Una consulta nueva del mismo período reemplaza el resultado anterior.
	c, _ := svc.StartDownload(ss, companyID, 1, "ventas", "202610", "")
	if c.ID == a.ID {
		t.Fatalf("debe ser una consulta nueva")
	}
	sireDlWait(t, c.ID)
	var n int64
	db.Model(&models.SireDownload{}).Where("company_id = ?", companyID).Count(&n)
	if n != 1 {
		t.Errorf("debe quedar una sola entrada por período: %d", n)
	}
}

func TestSireDownload_BorrarLimpiarYCaducar(t *testing.T) {
	f := newFakeSire(t)
	f.handler = sireDlHandler("06", true, zipTxt(t, "propuesta.txt", sireDlTxt))
	svc, ss, companyID, db := sireDlSetup(t, f)
	for _, c := range [][2]string{{"ventas", "202610"}, {"ventas", "202609"}, {"compras", "202610"}} {
		r, _ := svc.StartDownload(ss, companyID, 1, c[0], c[1], "")
		sireDlWait(t, r.ID)
	}
	list, _ := svc.ListDownloads(companyID, "")
	if len(list) != 3 {
		t.Fatalf("historial: %d", len(list))
	}
	if only, _ := svc.ListDownloads(companyID, "compras"); len(only) != 1 {
		t.Errorf("filtro por libro: %d", len(only))
	}

	if err := svc.DeleteDownload(companyID, list[0].ID); err != nil {
		t.Fatal(err)
	}
	if err := svc.DeleteDownload(companyID, list[0].ID); err == nil {
		t.Error("borrar dos veces debe avisar que no existe")
	}
	// Otra empresa no puede tocar ni bajar lo ajeno.
	if err := svc.DeleteDownload(companyID+1, list[1].ID); err == nil {
		t.Error("no debe borrar una descarga de otra empresa")
	}
	if _, _, err := svc.DownloadFile(companyID+1, list[1].ID, "x"); err == nil {
		t.Error("no debe entregar el Excel de otra empresa")
	}

	// Una consulta "en proceso" muy vieja se da por interrumpida; limpiar no toca lo que sigue en proceso.
	stale := models.SireDownload{CompanyID: companyID, Libro: "ventas", Period: "202601", Mode: SireDownloadModeNoGlosas, Status: models.SireDownloadProcessing, Step: "esperando", CreatedAt: time.Now().Add(-time.Hour)}
	db.Create(&stale)
	fresh := models.SireDownload{CompanyID: companyID, Libro: "ventas", Period: "202602", Mode: SireDownloadModeNoGlosas, Status: models.SireDownloadProcessing, Step: "esperando"}
	db.Create(&fresh)
	if n, err := svc.ClearDownloads(companyID, ""); err != nil || n != 3 { // 2 listas + la vieja, ya interrumpida
		t.Fatalf("ClearDownloads: n=%d err=%v", n, err)
	}
	left, _ := svc.ListDownloads(companyID, "")
	if len(left) != 1 || left[0].ID != fresh.ID || left[0].Status != models.SireDownloadProcessing {
		t.Fatalf("debe quedar solo la que sigue en proceso: %+v", left)
	}
}

// Un periodo sin comprobantes: el ticket termina y anuncia un archivo, pero SUNAT responde 2244 «El archivo solicitado no
// existe» al pedirlo (caso real de una empresa nueva). Debe quedar como «sin datos», no como error.
func TestSireDownload_ArchivoInexistente2244EsSinMovimientos(t *testing.T) {
	f := newFakeSire(t)
	base := sireDlHandler("06", true, nil)
	f.handler = func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "archivoreporte") {
			w.WriteHeader(http.StatusUnprocessableEntity)
			_, _ = w.Write([]byte(`{"cod":"422","msg":"Unprocessable Entity - Se presentaron errores de validación que impidieron completar el Request","errors":[{"cod":"2244","msg":"El archivo solicitado no existe."}]}`))
			return
		}
		base(w, r)
	}
	svc, ss, companyID, _ := sireDlSetup(t, f)
	row, _ := svc.StartDownload(ss, companyID, 1, "compras", "202609", "")
	if d := sireDlWait(t, row.ID); d.Status != models.SireDownloadNoData || d.ErrorCode != "" {
		t.Fatalf("2244 debía ser sin datos: %+v", d)
	}

	// Otro 422 del archivo sigue siendo un error.
	f.handler = func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "archivoreporte") {
			w.WriteHeader(http.StatusUnprocessableEntity)
			_, _ = w.Write([]byte(`{"cod":"422","msg":"x","errors":[{"cod":"9999","msg":"Otro problema"}]}`))
			return
		}
		base(w, r)
	}
	row, _ = svc.StartDownload(ss, companyID, 1, "ventas", "202609", "")
	if d := sireDlWait(t, row.ID); d.Status != models.SireDownloadFailed || d.ErrorCode != SireErrValidation {
		t.Fatalf("otro error debía seguir siendo error: %+v", d)
	}
}
