package services

// Cubre el agregado de Buzón SOL (docs/diseno-limpieza-control-detail-2026-09-16.md §5.9.6.5, etapa
// 2 de §5.9.5): sunatInboxRealSlotsForPeriod (agrupación por semana/slot a partir de actividades de
// calendario reales) y SunatInboxDashboardSummary (agregado de las 5 categorías, 2 unidades por
// actividad real — SUNAT + SUNAFIL, §5.9.6.4).

import (
	"fmt"
	"testing"
	"time"

	"miappfiber/database"
	"miappfiber/models"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func setupSunatInboxSummaryTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("sqlite: %v", err)
	}
	if err := db.AutoMigrate(
		&models.Company{},
		&models.SupervisorPeriod{},
		&models.SupervisorMonthlyControl{},
		&models.SupervisorMailboxCaptureSlot{},
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

// seedSunatInboxCalendarActivities 1 plantilla + 1 regla (CONTROL DE HORA, datetime, 10:30) y N
// actividades reales tipo sunat_inbox en los días dados — mismo patrón que el estudio en producción
// tras el retipeo de §5.9.6.5 (1 plantilla, varias instancias de calendario, una por día real).
func seedSunatInboxCalendarActivities(t *testing.T, db *gorm.DB, periodYM string, days []int) {
	t.Helper()
	rule := models.ActivityRule{
		Name: "Control de hora", CompareMode: models.ActivityRuleCompareDateTime, MaxUploadTime: "10:30", Active: true,
	}
	if err := db.Create(&rule).Error; err != nil {
		t.Fatalf("seed rule: %v", err)
	}
	tmpl := models.ActivityTemplate{
		Code: "AC-TEST-SUNATINBOX-" + periodYM, Name: "REVISION DE BUZON ELECTRONICO SUNAT Y SUNAFIL",
		ActivityType: models.CalendarActivitySunatInbox, ActivityRuleID: &rule.ID, Active: true,
	}
	if err := db.Create(&tmpl).Error; err != nil {
		t.Fatalf("seed template: %v", err)
	}
	var cal models.FinanceCalendar
	if err := db.Where("period_ym = ?", periodYM).First(&cal).Error; err != nil {
		cal = models.FinanceCalendar{PeriodYM: periodYM}
		if err := db.Create(&cal).Error; err != nil {
			t.Fatalf("seed calendar: %v", err)
		}
	}
	for _, d := range days {
		act := models.FinanceCalendarActivity{
			CalendarID: cal.ID, ActivityTemplateID: tmpl.ID, NameSnapshot: tmpl.Name,
			ActivityTypeSnapshot: models.CalendarActivitySunatInbox, PrioritySnapshot: "media",
			TextColorSnapshot: "#b45309", StartDay: d, EndDay: d, DueDay: d,
			ActivityRuleID: &rule.ID,
		}
		if err := db.Create(&act).Error; err != nil {
			t.Fatalf("seed calendar activity day %d: %v", d, err)
		}
	}
}

// TestSunatInboxRealSlotsForPeriod_GroupsByWeekChronologically días 2/5/9/12 de setiembre 2026 son
// miércoles/sábado/miércoles/sábado reales (mismos días usados en producción, §5.9.6.5) — 2 y 5 caen
// en la misma semana calendario (lunes 31 de agosto), 9 y 12 en la siguiente (lunes 7). Slot 1 debe
// ser el primero cronológicamente dentro de cada semana, slot 2 el segundo.
func TestSunatInboxRealSlotsForPeriod_GroupsByWeekChronologically(t *testing.T) {
	db := setupSunatInboxSummaryTestDB(t)
	periodYM := "2026-09"
	seedSunatInboxCalendarActivities(t, db, periodYM, []int{2, 5, 9, 12})

	slots := sunatInboxRealSlotsForPeriod(periodYM)
	if len(slots) != 4 {
		t.Fatalf("len(slots)=%d, want 4 (%+v)", len(slots), slots)
	}
	want := []struct{ day, slotIndex int }{{2, 1}, {5, 2}, {9, 1}, {12, 2}}
	for i, w := range want {
		if slots[i].dueDate.Day() != w.day || slots[i].slotIndex != w.slotIndex {
			t.Fatalf("slots[%d]=day %d/slot %d, want day %d/slot %d (%+v)",
				i, slots[i].dueDate.Day(), slots[i].slotIndex, w.day, w.slotIndex, slots)
		}
	}
	// 2 y 5 deben quedar en la misma semana (mismo weekStart); 9 y 12 en la siguiente, distinta de la
	// primera.
	if !slots[0].weekStart.Equal(slots[1].weekStart) {
		t.Fatalf("día 2 y 5 deberían compartir semana: %v vs %v", slots[0].weekStart, slots[1].weekStart)
	}
	if slots[0].weekStart.Equal(slots[2].weekStart) {
		t.Fatalf("día 9 debería caer en una semana distinta a la de día 2/5")
	}
}

func TestSunatInboxDashboardSummary_EmptyWhenNoCalendarConfigured(t *testing.T) {
	setupSunatInboxSummaryTestDB(t)
	svc := NewSupervisorService()
	got, err := svc.SunatInboxDashboardSummary(SupervisorDashboardParams{PeriodYM: "2026-07"})
	if err != nil {
		t.Fatalf("SunatInboxDashboardSummary: %v", err)
	}
	if got.Total != 0 {
		t.Fatalf("Total=%d, want 0 (sin calendario configurado no debería sumar nada): %+v", got.Total, got)
	}
}

// TestSunatInboxDashboardSummary_MissingWhenPastDueAndNoUpload una empresa activa sin ningún control
// ni captura creada todavía (lazy) igual "debe" Buzón SOL ese período — con 2 actividades reales ya
// vencidas (período 2 meses en el pasado) y nada cargado, las 2×2 (SUNAT+SUNAFIL) unidades caen en
// missing.
func TestSunatInboxDashboardSummary_MissingWhenPastDueAndNoUpload(t *testing.T) {
	db := setupSunatInboxSummaryTestDB(t)
	svc := NewSupervisorService()
	periodYM := time.Now().AddDate(0, -2, 0).Format("2006-01")
	seedSunatInboxCalendarActivities(t, db, periodYM, []int{5, 8})
	_ = seedEstudioCompany(t, db, "M001")

	got, err := svc.SunatInboxDashboardSummary(SupervisorDashboardParams{PeriodYM: periodYM})
	if err != nil {
		t.Fatalf("SunatInboxDashboardSummary: %v", err)
	}
	if got.Missing != 4 || got.Total != 4 {
		t.Fatalf("summary=%+v, want 4 missing de 4 total (2 actividades x 2 buzones)", got)
	}
}

// TestSunatInboxDashboardSummary_OnTimeWhenUploadedBeforeDeadline carga directa de un
// SupervisorMailboxCaptureSlot con sunat_uploaded_at antes de las 10:30 del día real — el lado SUNAT
// debe salir on_time, el lado SUNAFIL (sin cargar, plazo ya vencido) missing.
func TestSunatInboxDashboardSummary_OnTimeWhenUploadedBeforeDeadline(t *testing.T) {
	db := setupSunatInboxSummaryTestDB(t)
	svc := NewSupervisorService()
	periodYM := time.Now().AddDate(0, -2, 0).Format("2006-01")
	seedSunatInboxCalendarActivities(t, db, periodYM, []int{10})
	co := seedEstudioCompany(t, db, "M010")

	var y, m int
	if _, err := fmt.Sscanf(periodYM, "%d-%d", &y, &m); err != nil {
		t.Fatalf("parse periodYM: %v", err)
	}
	dueDate := time.Date(y, time.Month(m), 10, 0, 0, 0, 0, time.Local)
	weekStart := mondayOfWeekContaining(dueDate)

	ctrl := models.SupervisorMonthlyControl{
		CompanyID: co.ID, PeriodYM: periodYM,
		GeneralStatus: models.SupervisorControlPendiente, RiskLevel: models.SupervisorRiskBajo,
	}
	if err := db.Create(&ctrl).Error; err != nil {
		t.Fatalf("seed control: %v", err)
	}
	uploadedAt := time.Date(y, time.Month(m), 10, 9, 0, 0, 0, time.Local)
	slot := models.SupervisorMailboxCaptureSlot{
		MonthlyControlID: ctrl.ID, WeekStart: weekStart, SlotIndex: 1, SlotsPerWeek: 2,
		SunatStatus: models.SupervisorMailboxStatusCargado, SunatUploadedAt: &uploadedAt,
		SunafilStatus: models.SupervisorMailboxStatusPendiente,
	}
	if err := db.Create(&slot).Error; err != nil {
		t.Fatalf("seed capture slot: %v", err)
	}

	got, err := svc.SunatInboxDashboardSummary(SupervisorDashboardParams{PeriodYM: periodYM})
	if err != nil {
		t.Fatalf("SunatInboxDashboardSummary: %v", err)
	}
	if got.OnTime != 1 {
		t.Fatalf("OnTime=%d, want 1 (%+v)", got.OnTime, got)
	}
	if got.Missing != 1 {
		t.Fatalf("Missing=%d, want 1 — SUNAFIL sin cargar y plazo vencido (%+v)", got.Missing, got)
	}
}

// TestSunatInboxDashboardSummary_ExemptWhenSuspendida control.Suspendida (§5.9.7, campo global)
// exime las 2 unidades (SUNAT+SUNAFIL) de la única actividad real del período, sin necesitar ningún
// mecanismo propio de Buzón SOL.
func TestSunatInboxDashboardSummary_ExemptWhenSuspendida(t *testing.T) {
	db := setupSunatInboxSummaryTestDB(t)
	svc := NewSupervisorService()
	periodYM := time.Now().AddDate(0, -2, 0).Format("2006-01")
	seedSunatInboxCalendarActivities(t, db, periodYM, []int{10})
	co := seedEstudioCompany(t, db, "M020")
	ctrl := models.SupervisorMonthlyControl{
		CompanyID: co.ID, PeriodYM: periodYM,
		GeneralStatus: models.SupervisorControlPendiente, RiskLevel: models.SupervisorRiskBajo,
		Suspendida: true,
	}
	if err := db.Create(&ctrl).Error; err != nil {
		t.Fatalf("seed control suspendida: %v", err)
	}

	got, err := svc.SunatInboxDashboardSummary(SupervisorDashboardParams{PeriodYM: periodYM})
	if err != nil {
		t.Fatalf("SunatInboxDashboardSummary: %v", err)
	}
	if got.Exempt != 2 || got.Total != 2 {
		t.Fatalf("summary=%+v, want 2 exempt de 2 total", got)
	}
}

// TestSunatInboxRealSlotsForPeriod_IgnoresStaleActivitySnapshot regresión de un bug real encontrado
// verificando en el navegador contra datos de dev (docs/diseno-limpieza-control-detail-2026-09-16.md
// §5.9.6.5): una actividad de calendario vieja, de un período donde la plantilla NUNCA se retipeó
// para ESE mes (su activity_type_snapshot propio se quedó en "nps", nunca se re-sincronizó — mismo
// problema documentado para PDT601/621 en §2.4), no debe contar para el agregado aunque la plantilla
// a la que apunta HOY sea sunat_inbox. Antes de este fix, sunatInboxRealSlotsForPeriod usaba
// sunatInboxCalendarActivitiesForPeriod (con sus 2 fallbacks legacy pensados para la grilla en
// pantalla, no para el agregado) y enganchaba esta actividad vieja sin regla propia, inflando
// "Exento o no aplica" en cientos de unidades que no correspondían a ninguna obligación real.
func TestSunatInboxRealSlotsForPeriod_IgnoresStaleActivitySnapshot(t *testing.T) {
	db := setupSunatInboxSummaryTestDB(t)
	periodYM := "2026-08"

	// Plantilla YA retipeada a sunat_inbox (como quedaría tras el retipeo de §5.9.6.5)...
	tmpl := models.ActivityTemplate{
		Code: "AC-TEST-STALE", Name: "REVISION DE BUZON ELECTRONICO SUNAT Y SUNAFIL",
		ActivityType: models.CalendarActivitySunatInbox, Active: true,
	}
	if err := db.Create(&tmpl).Error; err != nil {
		t.Fatalf("seed template: %v", err)
	}
	cal := models.FinanceCalendar{PeriodYM: periodYM}
	if err := db.Create(&cal).Error; err != nil {
		t.Fatalf("seed calendar: %v", err)
	}
	// ...pero la instancia de ESTE período se creó ANTES del retipeo: su propio snapshot quedó en
	// "nps" y nunca tuvo regla asignada — exactamente el estado real encontrado en agosto 2026 en la
	// BD de dev.
	act := models.FinanceCalendarActivity{
		CalendarID: cal.ID, ActivityTemplateID: tmpl.ID, NameSnapshot: tmpl.Name,
		ActivityTypeSnapshot: "nps", PrioritySnapshot: "media", TextColorSnapshot: "#b45309",
		StartDay: 20, EndDay: 20, DueDay: 20,
	}
	if err := db.Create(&act).Error; err != nil {
		t.Fatalf("seed stale activity: %v", err)
	}

	slots := sunatInboxRealSlotsForPeriod(periodYM)
	if len(slots) != 0 {
		t.Fatalf("slots=%+v, want 0 — la actividad vieja (snapshot nps) no debe contarse solo porque su plantilla hoy es sunat_inbox", slots)
	}
}
