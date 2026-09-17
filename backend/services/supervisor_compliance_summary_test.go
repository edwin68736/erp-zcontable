package services

// Cubre el rediseño de "Cumplimiento %" en vivo (docs/diseno-limpieza-control-detail-2026-09-16.md
// §5.9): DetraccionesDashboardSummary (agregado nuevo, no existía), MonthlyComplianceSummary
// (combinadora etapa 1: PDT 601/621 + Detracciones) y el ajuste de §5.9.2b (observado se evalúa por
// fecha, igual que pendiente).

import (
	"testing"
	"time"

	"miappfiber/database"
	"miappfiber/models"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func setupComplianceSummaryTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("sqlite: %v", err)
	}
	if err := db.AutoMigrate(
		&models.Company{},
		&models.SupervisorPeriod{},
		&models.SupervisorMonthlyControl{},
		&models.SupervisorDeclaration{},
		&models.SupervisorPdt601Planilla{},
		&models.SupervisorPdt621Record{},
		&models.SupervisorAttachment{},
		&models.SupervisorChangeLog{},
		&models.CompanyAccessCredential{},
		&models.ActivityRule{},
		&models.ActivityTemplate{},
		&models.FinanceCalendar{},
		&models.FinanceCalendarActivity{},
	); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	database.DB = db
	return db
}

// seedDetraccionesCalendarRule mismo patrón que seedPdt601CalendarRule (supervisor_pdt601_service_
// test.go) pero para el tipo detracciones. Code único por período (periodYM) — un mismo test puede
// sembrar más de un período.
func seedDetraccionesCalendarRule(t *testing.T, db *gorm.DB, periodYM string, dueDay int) {
	t.Helper()
	rule := models.ActivityRule{Name: "Fecha simple", CompareMode: models.ActivityRuleCompareDate, Active: true}
	if err := db.Create(&rule).Error; err != nil {
		t.Fatalf("seed rule: %v", err)
	}
	tmpl := models.ActivityTemplate{
		Code: "AC-TEST-DETR-" + periodYM, Name: "Detracciones",
		ActivityType: models.CalendarActivityDetracciones, ActivityRuleID: &rule.ID, Active: true,
	}
	if err := db.Create(&tmpl).Error; err != nil {
		t.Fatalf("seed template: %v", err)
	}
	// find-or-create: un mismo período puede ya tener calendario si el test también sembró PDT 601
	// (seedPdt601CalendarRule) para ese mismo periodYM — finance_calendars.period_ym es único.
	var cal models.FinanceCalendar
	if err := db.Where("period_ym = ?", periodYM).First(&cal).Error; err != nil {
		cal = models.FinanceCalendar{PeriodYM: periodYM}
		if err := db.Create(&cal).Error; err != nil {
			t.Fatalf("seed calendar: %v", err)
		}
	}
	act := models.FinanceCalendarActivity{
		CalendarID: cal.ID, ActivityTemplateID: tmpl.ID, NameSnapshot: tmpl.Name,
		ActivityTypeSnapshot: models.CalendarActivityDetracciones, PrioritySnapshot: "media",
		TextColorSnapshot: "#1d4ed8", StartDay: dueDay, EndDay: dueDay, DueDay: dueDay,
		ActivityRuleID: &rule.ID,
	}
	if err := db.Create(&act).Error; err != nil {
		t.Fatalf("seed calendar activity: %v", err)
	}
}

// TestDetraccionesDashboardSummary_ClassifiesFourCases cubre las 4 categorías que no dependen de
// timing de reloj real: missing (plazo pasado, sin carga), pending (plazo futuro, sin carga),
// exempt por Suspendida (§5.9.7 — control global) y exempt por sin_clave (§5.9.2, exención propia
// del status). on_time/late no se prueban acá porque UploadDetraccionesPDF sella la hora real (ver
// TestDetraccionesDashboardSummary_OnTimeUpload para ese caso).
func TestDetraccionesDashboardSummary_ClassifiesFourCases(t *testing.T) {
	db := setupComplianceSummaryTestDB(t)
	svc := NewSupervisorService()

	pastYM := time.Now().AddDate(0, -2, 0).Format("2006-01")
	if _, err := svc.CreatePeriod(pastYM, "test"); err != nil {
		t.Fatalf("CreatePeriod pastYM: %v", err)
	}
	seedDetraccionesCalendarRule(t, db, pastYM, 15)
	coMissing := seedEstudioCompany(t, db, "T001")
	if _, err := svc.EnsureDetracciones(coMissing.ID, pastYM); err != nil {
		t.Fatalf("EnsureDetracciones missing: %v", err)
	}

	futureYM := time.Now().Format("2006-01")
	futureDay := time.Now().Day() + 10
	if futureDay > 28 {
		futureDay = 28
	}
	if _, err := svc.CreatePeriod(futureYM, "test"); err != nil {
		t.Fatalf("CreatePeriod futureYM: %v", err)
	}
	seedDetraccionesCalendarRule(t, db, futureYM, futureDay)

	coPending := seedEstudioCompany(t, db, "T002")
	if _, err := svc.EnsureDetracciones(coPending.ID, futureYM); err != nil {
		t.Fatalf("EnsureDetracciones pending: %v", err)
	}

	coSuspendida := seedEstudioCompany(t, db, "T003")
	if _, err := svc.EnsureDetracciones(coSuspendida.ID, futureYM); err != nil {
		t.Fatalf("EnsureDetracciones suspendida: %v", err)
	}
	if _, err := svc.SetDetraccionesSuspendida(coSuspendida.ID, futureYM, true); err != nil {
		t.Fatalf("SetDetraccionesSuspendida: %v", err)
	}

	coSinClave := seedEstudioCompany(t, db, "T004")
	det, err := svc.EnsureDetracciones(coSinClave.ID, futureYM)
	if err != nil {
		t.Fatalf("EnsureDetracciones sin_clave: %v", err)
	}
	if _, err := svc.SetDetraccionesSupervisorStatus(det.Declaration.ID, models.SupervisorDetraccionSinClave, 9); err != nil {
		t.Fatalf("SetDetraccionesSupervisorStatus: %v", err)
	}

	// Cada aserción se acota con CompanyID: DetraccionesDashboardSummary evalúa TODAS las empresas
	// activas del estudio para el período dado (a propósito — una empresa sin declaración todavía
	// igual "debe" detracciones ese período, es el mismo criterio lazy-create de EnsureDetracciones),
	// así que sin este filtro las 4 empresas sembradas (existen globalmente, no por período) se
	// contarían entre sí en cada llamada.
	gotMissing, err := svc.DetraccionesDashboardSummary(SupervisorDashboardParams{PeriodYM: pastYM, CompanyID: coMissing.ID})
	if err != nil {
		t.Fatalf("DetraccionesDashboardSummary pastYM: %v", err)
	}
	if gotMissing.Missing != 1 || gotMissing.Total != 1 {
		t.Fatalf("pastYM summary=%+v, want 1 missing de 1 total", gotMissing)
	}

	gotPending, err := svc.DetraccionesDashboardSummary(SupervisorDashboardParams{PeriodYM: futureYM, CompanyID: coPending.ID})
	if err != nil {
		t.Fatalf("DetraccionesDashboardSummary pending: %v", err)
	}
	if gotPending.Pending != 1 || gotPending.Total != 1 {
		t.Fatalf("pending summary=%+v, want 1 pending de 1 total", gotPending)
	}

	gotSuspendida, err := svc.DetraccionesDashboardSummary(SupervisorDashboardParams{PeriodYM: futureYM, CompanyID: coSuspendida.ID})
	if err != nil {
		t.Fatalf("DetraccionesDashboardSummary suspendida: %v", err)
	}
	if gotSuspendida.Exempt != 1 || gotSuspendida.Total != 1 {
		t.Fatalf("suspendida summary=%+v, want 1 exempt de 1 total", gotSuspendida)
	}

	gotSinClave, err := svc.DetraccionesDashboardSummary(SupervisorDashboardParams{PeriodYM: futureYM, CompanyID: coSinClave.ID})
	if err != nil {
		t.Fatalf("DetraccionesDashboardSummary sin_clave: %v", err)
	}
	if gotSinClave.Exempt != 1 || gotSinClave.Total != 1 {
		t.Fatalf("sin_clave summary=%+v, want 1 exempt de 1 total", gotSinClave)
	}
}

// TestDetraccionesDashboardSummary_OnTimeUpload cubre on_time: un adjunto con created_at de hoy
// contra un plazo en el futuro. Inserta el SupervisorAttachment directo (no vía
// UploadDetraccionesPDF, que escribe a disco usando config.AppConfig.StoragePath — no inicializado
// en tests unitarios) para aislar solo la clasificación de puntualidad.
func TestDetraccionesDashboardSummary_OnTimeUpload(t *testing.T) {
	db := setupComplianceSummaryTestDB(t)
	svc := NewSupervisorService()

	periodYM := time.Now().Format("2006-01")
	dueDay := time.Now().Day() + 5
	if dueDay > 28 {
		dueDay = 28
	}
	if _, err := svc.CreatePeriod(periodYM, "test"); err != nil {
		t.Fatalf("CreatePeriod: %v", err)
	}
	seedDetraccionesCalendarRule(t, db, periodYM, dueDay)

	co := seedEstudioCompany(t, db, "T010")
	det, err := svc.EnsureDetracciones(co.ID, periodYM)
	if err != nil {
		t.Fatalf("EnsureDetracciones: %v", err)
	}
	declID := det.Declaration.ID
	att := models.SupervisorAttachment{
		DeclarationID: &declID, FileName: "detraccion.pdf", FileURL: "/x.pdf", UploadedByUserID: 9,
	}
	if err := db.Create(&att).Error; err != nil {
		t.Fatalf("seed attachment: %v", err)
	}
	if err := db.Model(&models.SupervisorDeclaration{}).Where("id = ?", declID).
		Update("status", models.SupervisorDetraccionCargado).Error; err != nil {
		t.Fatalf("seed status cargado: %v", err)
	}

	got, err := svc.DetraccionesDashboardSummary(SupervisorDashboardParams{PeriodYM: periodYM})
	if err != nil {
		t.Fatalf("DetraccionesDashboardSummary: %v", err)
	}
	if got.OnTime != 1 || got.Total != 1 {
		t.Fatalf("summary=%+v, want 1 on_time de 1 total", got)
	}
}

// TestMonthlyComplianceSummary_CombinesPdtAndDetracciones cubre la combinadora etapa 1 (§5.9.5): un
// on_time de PDT 601 + Detracciones (evaluado para TODA empresa activa del período, tenga o no
// declaración creada — mismo criterio lazy-create de DetraccionesDashboardSummary) deben sumarse en
// un solo ComplianceSummary. Con 2 empresas activas y plazo de Detracciones ya vencido: la que solo
// tiene PDT 601 a tiempo también "debe" Detracciones y no la presentó → 1 on_time (PDT) + 2 missing
// (Detracciones de ambas empresas) = 33.3%.
func TestMonthlyComplianceSummary_CombinesPdtAndDetracciones(t *testing.T) {
	db := setupComplianceSummaryTestDB(t)
	svc := NewSupervisorService()

	periodYM := time.Now().AddDate(0, -2, 0).Format("2006-01")
	if _, err := svc.CreatePeriod(periodYM, "test"); err != nil {
		t.Fatalf("CreatePeriod: %v", err)
	}
	seedPdt601CalendarRule(t, db, periodYM, 15, 0)
	seedDetraccionesCalendarRule(t, db, periodYM, 15)

	coPdtOnTime := seedEstudioCompany(t, db, "T020")
	saved, err := svc.SavePdt601Planilla(coPdtOnTime.ID, periodYM, Pdt601PlanillaInput{RegimenLaboral: models.Pdt601RegimenGeneral, FechaEntrega: "2026-07-15"})
	if err != nil {
		// FechaEntrega fija no importa para on_time/late (se compara contra el dueDay del período,
		// no un año fijo) — lo relevante es que sea <= dueDay del mismo mes/año del período.
		t.Fatalf("SavePdt601Planilla: %v", err)
	}
	if _, err := svc.ApproveDeclaration(saved.Declaration.ID, 9); err != nil {
		t.Fatalf("ApproveDeclaration: %v", err)
	}

	coDetrMissing := seedEstudioCompany(t, db, "T021")
	if _, err := svc.EnsureDetracciones(coDetrMissing.ID, periodYM); err != nil {
		t.Fatalf("EnsureDetracciones: %v", err)
	}

	cs, err := svc.MonthlyComplianceSummary(SupervisorDashboardParams{PeriodYM: periodYM})
	if err != nil {
		t.Fatalf("MonthlyComplianceSummary: %v", err)
	}
	if cs.OnTime != 1 {
		t.Fatalf("OnTime=%d, want 1 (%+v)", cs.OnTime, cs)
	}
	if cs.Missing != 2 {
		t.Fatalf("Missing=%d, want 2 (%+v)", cs.Missing, cs)
	}
	if cs.Total != 3 {
		t.Fatalf("Total=%d, want 3 (%+v)", cs.Total, cs)
	}
	if cs.CompliancePct != 33.3 {
		t.Fatalf("CompliancePct=%v, want 33.3 (%+v)", cs.CompliancePct, cs)
	}
}

// TestPdtBucketsSQL_ObservadoCuentaComoVencidoSiYaPaso cubre §5.9.2b: una declaración PDT 601
// observada, con plazo ya vencido, debe contar como "vencido" (missing) en el agregado — antes
// (d.status <> observadoStatus) la excluía siempre, sin importar la fecha.
func TestPdtBucketsSQL_ObservadoCuentaComoVencidoSiYaPaso(t *testing.T) {
	db := setupComplianceSummaryTestDB(t)
	svc := NewSupervisorService()

	periodYM := time.Now().AddDate(0, -2, 0).Format("2006-01")
	if _, err := svc.CreatePeriod(periodYM, "test"); err != nil {
		t.Fatalf("CreatePeriod: %v", err)
	}
	seedPdt601CalendarRule(t, db, periodYM, 15, 0)

	co := seedEstudioCompany(t, db, "T030")
	saved, err := svc.SavePdt601Planilla(co.ID, periodYM, Pdt601PlanillaInput{RegimenLaboral: models.Pdt601RegimenGeneral, FechaEntrega: "2026-07-14"})
	if err != nil {
		t.Fatalf("SavePdt601Planilla: %v", err)
	}
	// Observado se hace desde "por_revisar" (estado en el que queda tras fijar fecha_entrega) — NO
	// se puede observar después de aprobar (observePdt601Pdt621Declaration exige por_revisar).
	if _, err := svc.ObserveDeclaration(saved.Declaration.ID, 9, "revisar sustento"); err != nil {
		t.Fatalf("ObserveDeclaration: %v", err)
	}

	out, err := svc.PdtDashboardSummary(SupervisorDashboardParams{PeriodYM: periodYM})
	if err != nil {
		t.Fatalf("PdtDashboardSummary: %v", err)
	}
	got := out[models.SupervisorDeclPDT601]
	if got.Observado != 1 {
		t.Fatalf("Observado=%d, want 1 (%+v)", got.Observado, got)
	}
	if got.Vencido != 1 {
		t.Fatalf("Vencido=%d, want 1 — observada + plazo vencido debe contar como vencido (%+v)", got.Vencido, got)
	}
}
