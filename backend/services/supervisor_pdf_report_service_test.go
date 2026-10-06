package services

// Cubre los módulos de informe en PDF (Informe detracciones / Siscont balances): entrega con fecha de
// cumplimiento, un solo archivo por declaración (el nuevo reemplaza al anterior), revisión del
// supervisor (aprobar / observar / reabrir con el enum reducido) y los filtros del listado.

import (
	"strings"
	"testing"
	"time"

	"miappfiber/config"
	"miappfiber/database"
	"miappfiber/models"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func setupPdfReportTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("sqlite: %v", err)
	}
	if err := db.AutoMigrate(
		&models.Company{},
		&models.User{},
		&models.SupervisorPeriod{},
		&models.SupervisorMonthlyControl{},
		&models.SupervisorDeclaration{},
		&models.SupervisorAttachment{},
		&models.SupervisorChangeLog{},
		&models.SupervisorObservation{},
		&models.CompanyAccessCredential{},
		&models.ActivityRule{},
		&models.ActivityTemplate{},
		&models.FinanceCalendar{},
		&models.FinanceCalendarActivity{},
	); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	database.DB = db
	// DeleteAttachment toca el disco: apunta a un directorio temporal del test.
	config.AppConfig = &config.Config{StoragePath: t.TempDir()}
	return db
}

func pdfReportSubmit(t *testing.T, svc *SupervisorService, mod PdfReportModule, companyID uint, period, fecha string) *PdfReportDetail {
	t.Helper()
	detail, err := svc.EnsurePdfReport(mod, companyID, period)
	if err != nil {
		t.Fatalf("EnsurePdfReport: %v", err)
	}
	out, err := svc.SubmitPdfReport(mod, detail, 7, "informe.pdf", "/storage/supervisors/x/informe.pdf", fecha)
	if err != nil {
		t.Fatalf("SubmitPdfReport: %v", err)
	}
	return out
}

func TestPdfReport_SubmitMovesToPorRevisarWithFechaEntrega(t *testing.T) {
	db := setupPdfReportTestDB(t)
	svc := NewSupervisorService()
	co := seedEstudioCompany(t, db, "P001")
	if _, err := svc.CreatePeriod("2026-07", "test"); err != nil {
		t.Fatalf("CreatePeriod: %v", err)
	}

	detail, err := svc.EnsurePdfReport(PdfReportInformeDetracciones, co.ID, "2026-07")
	if err != nil {
		t.Fatalf("EnsurePdfReport: %v", err)
	}
	if detail.Declaration.Status != models.SupervisorDeclPendiente {
		t.Fatalf("estado inicial=%s, want pendiente", detail.Declaration.Status)
	}

	out := pdfReportSubmit(t, svc, PdfReportInformeDetracciones, co.ID, "2026-07", "2026-07-10")
	if out.Declaration.Status != models.SupervisorDeclPorRevisar {
		t.Fatalf("estado=%s, want por_revisar", out.Declaration.Status)
	}
	if out.FechaEntrega == nil || *out.FechaEntrega != "2026-07-10" {
		t.Fatalf("FechaEntrega=%v, want 2026-07-10", out.FechaEntrega)
	}
}

func TestPdfReport_ModulesAreIndependentPerCompany(t *testing.T) {
	db := setupPdfReportTestDB(t)
	svc := NewSupervisorService()
	co := seedEstudioCompany(t, db, "P002")
	if _, err := svc.CreatePeriod("2026-07", "test"); err != nil {
		t.Fatalf("CreatePeriod: %v", err)
	}
	pdfReportSubmit(t, svc, PdfReportInformeDetracciones, co.ID, "2026-07", "2026-07-10")

	siscont, err := svc.EnsurePdfReport(PdfReportSiscontBalances, co.ID, "2026-07")
	if err != nil {
		t.Fatalf("EnsurePdfReport siscont: %v", err)
	}
	if siscont.Declaration.Status != models.SupervisorDeclPendiente {
		t.Fatalf("siscont=%s, want pendiente (no debe heredar la entrega del otro módulo)", siscont.Declaration.Status)
	}
}

func TestPdfReport_SecondUploadReplacesFirst(t *testing.T) {
	db := setupPdfReportTestDB(t)
	svc := NewSupervisorService()
	co := seedEstudioCompany(t, db, "P003")
	if _, err := svc.CreatePeriod("2026-07", "test"); err != nil {
		t.Fatalf("CreatePeriod: %v", err)
	}
	first := pdfReportSubmit(t, svc, PdfReportSiscontBalances, co.ID, "2026-07", "2026-07-10")
	second := pdfReportSubmit(t, svc, PdfReportSiscontBalances, co.ID, "2026-07", "2026-07-12")

	var n int64
	db.Model(&models.SupervisorAttachment{}).Where("declaration_id = ?", first.Declaration.ID).Count(&n)
	if n != 1 {
		t.Fatalf("adjuntos=%d, want 1 (el nuevo reemplaza al anterior)", n)
	}
	if second.FechaEntrega == nil || *second.FechaEntrega != "2026-07-12" {
		t.Fatalf("FechaEntrega=%v, want 2026-07-12 (la del reemplazo)", second.FechaEntrega)
	}
}

func TestPdfReport_ApproveObserveReopenFlow(t *testing.T) {
	db := setupPdfReportTestDB(t)
	svc := NewSupervisorService()
	co := seedEstudioCompany(t, db, "P004")
	if _, err := svc.CreatePeriod("2026-07", "test"); err != nil {
		t.Fatalf("CreatePeriod: %v", err)
	}
	d := pdfReportSubmit(t, svc, PdfReportInformeDetracciones, co.ID, "2026-07", "2026-07-10")
	id := d.Declaration.ID

	if _, err := svc.ObserveDeclaration(id, 9, "  "); err == nil {
		t.Fatal("observar sin motivo debe fallar")
	}
	obs, err := svc.ObserveDeclaration(id, 9, "Falta el anexo 2")
	if err != nil {
		t.Fatalf("ObserveDeclaration: %v", err)
	}
	if obs.Status != models.SupervisorDeclObservado {
		t.Fatalf("estado=%s, want observado", obs.Status)
	}

	// El asistente corrige y vuelve a cargar: Observado → Por revisar.
	again := pdfReportSubmit(t, svc, PdfReportInformeDetracciones, co.ID, "2026-07", "2026-07-11")
	if again.Declaration.Status != models.SupervisorDeclPorRevisar {
		t.Fatalf("estado=%s, want por_revisar tras corregir", again.Declaration.Status)
	}

	ok, err := svc.ApproveDeclaration(id, 9)
	if err != nil {
		t.Fatalf("ApproveDeclaration: %v", err)
	}
	if ok.Status != models.SupervisorDeclEntregado {
		t.Fatalf("estado=%s, want entregado", ok.Status)
	}

	// Aprobada: no se puede reemplazar el PDF hasta reabrir.
	detail, _ := svc.EnsurePdfReport(PdfReportInformeDetracciones, co.ID, "2026-07")
	if _, err := svc.SubmitPdfReport(PdfReportInformeDetracciones, detail, 7, "otro.pdf", "/storage/x/otro.pdf", ""); err == nil {
		t.Fatal("no se debe poder cargar sobre una entrega ya aprobada")
	}
	if _, err := svc.ReopenDeclaration(id, 9, "corregir monto"); err != nil {
		t.Fatalf("ReopenDeclaration: %v", err)
	}
	pdfReportSubmit(t, svc, PdfReportInformeDetracciones, co.ID, "2026-07", "2026-07-12")
}

func TestPdfReport_ManualStatusChangeIsBlocked(t *testing.T) {
	db := setupPdfReportTestDB(t)
	svc := NewSupervisorService()
	co := seedEstudioCompany(t, db, "P005")
	if _, err := svc.CreatePeriod("2026-07", "test"); err != nil {
		t.Fatalf("CreatePeriod: %v", err)
	}
	detail, err := svc.EnsurePdfReport(PdfReportSiscontBalances, co.ID, "2026-07")
	if err != nil {
		t.Fatalf("EnsurePdfReport: %v", err)
	}
	if _, err := svc.UpdateDeclaration(detail.Declaration.ID, SupervisorDeclarationInput{Status: models.SupervisorDeclEntregado}, 9); err == nil {
		t.Fatal("el estado no se puede cambiar a mano: debe pasar por Entregar/Aprobar/Observar/Reabrir")
	}
}

func TestPdfReport_RejectsFutureDateAndSuspended(t *testing.T) {
	db := setupPdfReportTestDB(t)
	svc := NewSupervisorService()
	co := seedEstudioCompany(t, db, "P006")
	if _, err := svc.CreatePeriod("2026-07", "test"); err != nil {
		t.Fatalf("CreatePeriod: %v", err)
	}

	future := time.Now().AddDate(0, 0, 3).Format("2006-01-02")
	if _, err := ParsePdfReportFechaEntrega(future); err == nil || !strings.Contains(err.Error(), "futura") {
		t.Fatalf("fecha futura debe rechazarse, err=%v", err)
	}
	if _, err := ParsePdfReportFechaEntrega("10/07/2026"); err == nil {
		t.Fatal("formato inválido debe rechazarse")
	}
	if d, err := ParsePdfReportFechaEntrega(""); err != nil || d == nil {
		t.Fatalf("vacía = hoy, err=%v", err)
	}

	detail, err := svc.EnsurePdfReport(PdfReportInformeDetracciones, co.ID, "2026-07")
	if err != nil {
		t.Fatalf("EnsurePdfReport: %v", err)
	}
	if err := db.Model(&models.SupervisorMonthlyControl{}).Where("id = ?", detail.ControlID).Update("suspendida", true).Error; err != nil {
		t.Fatalf("suspender: %v", err)
	}
	detail, _ = svc.EnsurePdfReport(PdfReportInformeDetracciones, co.ID, "2026-07")
	if _, err := svc.SubmitPdfReport(PdfReportInformeDetracciones, detail, 7, "x.pdf", "/storage/x.pdf", ""); err == nil {
		t.Fatal("una empresa suspendida no puede recibir entregas")
	}
}

func TestPdfReport_ListFiltersAndRows(t *testing.T) {
	db := setupPdfReportTestDB(t)
	svc := NewSupervisorService()
	a := seedEstudioCompany(t, db, "P007")
	b := seedEstudioCompany(t, db, "P008")
	c := seedEstudioCompany(t, db, "P009")
	if _, err := svc.CreatePeriod("2026-07", "test"); err != nil {
		t.Fatalf("CreatePeriod: %v", err)
	}
	pdfReportSubmit(t, svc, PdfReportInformeDetracciones, a.ID, "2026-07", "2026-07-10") // por_revisar
	d := pdfReportSubmit(t, svc, PdfReportInformeDetracciones, b.ID, "2026-07", "2026-07-10")
	if _, err := svc.ApproveDeclaration(d.Declaration.ID, 9); err != nil { // entregado
		t.Fatalf("ApproveDeclaration: %v", err)
	}
	// c: sin registro todavía → cuenta como pendiente.
	_ = c

	count := func(status string) int {
		rows, err := svc.ExportPdfReport(PdfReportInformeDetracciones, PdfReportListParams{PeriodYM: "2026-07", Status: status})
		if err != nil {
			t.Fatalf("ExportPdfReport(%q): %v", status, err)
		}
		return len(rows)
	}
	if got := count(""); got != 3 {
		t.Fatalf("todos=%d, want 3", got)
	}
	if got := count(models.SupervisorDeclPendiente); got != 1 {
		t.Fatalf("pendiente=%d, want 1 (incluye la empresa sin registro)", got)
	}
	if got := count(models.SupervisorDeclPorRevisar); got != 1 {
		t.Fatalf("por_revisar=%d, want 1", got)
	}
	if got := count(models.SupervisorDeclEntregado); got != 1 {
		t.Fatalf("entregado=%d, want 1", got)
	}

	rows, _ := svc.ExportPdfReport(PdfReportInformeDetracciones, PdfReportListParams{PeriodYM: "2026-07", Status: models.SupervisorDeclPorRevisar})
	if len(rows) != 1 || rows[0].FileName != "informe.pdf" || rows[0].FechaEntrega == nil || *rows[0].FechaEntrega != "2026-07-10" {
		t.Fatalf("fila=%+v: debe traer archivo y fecha de cumplimiento", rows)
	}

	// El otro módulo no ve las entregas de este.
	rowsSiscont, _ := svc.ExportPdfReport(PdfReportSiscontBalances, PdfReportListParams{PeriodYM: "2026-07", Status: models.SupervisorDeclPorRevisar})
	if len(rowsSiscont) != 0 {
		t.Fatalf("siscont por_revisar=%d, want 0", len(rowsSiscont))
	}
}
