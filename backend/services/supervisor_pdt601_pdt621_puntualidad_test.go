package services

// Cubre el label de puntualidad ("Entregado" vs "Entregado fuera de fecha", nunca guardado, solo
// calculado en lectura) y los filtros nuevos entregado_a_tiempo/entregado_fuera_de_fecha
// (docs/diseno-estados-pdt601-pdt621-2026-09-16.md §5/§11) — siempre contra el calendario INTERNO,
// nunca contra el cronograma SUNAT.

import (
	"testing"

	"miappfiber/models"

	"gorm.io/gorm"
)

func seedPdt621CalendarRule(t *testing.T, db *gorm.DB, periodYM string, dueDay, graceDays int) {
	t.Helper()
	rule := models.ActivityRule{
		Name:        "Fecha simple PDT621",
		CompareMode: models.ActivityRuleCompareDate,
		GraceDays:   graceDays,
		Active:      true,
	}
	if err := db.Create(&rule).Error; err != nil {
		t.Fatalf("seed rule: %v", err)
	}
	tmpl := models.ActivityTemplate{
		Code:           "AC-TEST-PDT621",
		Name:           "PDT 621",
		ActivityType:   models.CalendarActivityPDT621,
		ActivityRuleID: &rule.ID,
		Active:         true,
	}
	if err := db.Create(&tmpl).Error; err != nil {
		t.Fatalf("seed template: %v", err)
	}
	cal := models.FinanceCalendar{PeriodYM: periodYM}
	if err := db.Create(&cal).Error; err != nil {
		t.Fatalf("seed calendar: %v", err)
	}
	act := models.FinanceCalendarActivity{
		CalendarID:           cal.ID,
		ActivityTemplateID:   tmpl.ID,
		NameSnapshot:         tmpl.Name,
		ActivityTypeSnapshot: models.CalendarActivityPDT621,
		PrioritySnapshot:     "media",
		DueDay:               dueDay,
		ActivityRuleID:       &rule.ID,
	}
	if err := db.Create(&act).Error; err != nil {
		t.Fatalf("seed activity: %v", err)
	}
}

func setupPdt621TestDBWithCalendar(t *testing.T) *gorm.DB {
	t.Helper()
	db := setupPdt621TestDB(t)
	if err := db.AutoMigrate(&models.ActivityRule{}, &models.ActivityTemplate{}, &models.FinanceCalendar{}, &models.FinanceCalendarActivity{}); err != nil {
		t.Fatalf("migrate calendar: %v", err)
	}
	return db
}

func TestPdt601EntregadoLabel_OnTimeAndLate(t *testing.T) {
	db := setupPdt601TestDB(t)
	svc := NewSupervisorService()
	coOnTime := seedEstudioCompany(t, db, "T001")
	coLate := seedEstudioCompany(t, db, "T002")
	periodYM := "2026-07"
	if _, err := svc.CreatePeriod(periodYM, "test"); err != nil {
		t.Fatalf("CreatePeriod: %v", err)
	}
	seedPdt601CalendarRule(t, db, periodYM, 15, 0)

	onTime, err := svc.SavePdt601Planilla(coOnTime.ID, periodYM, Pdt601PlanillaInput{RegimenLaboral: models.Pdt601RegimenGeneral, FechaEntrega: "2026-07-10"})
	if err != nil {
		t.Fatalf("SavePdt601Planilla on_time: %v", err)
	}
	late, err := svc.SavePdt601Planilla(coLate.ID, periodYM, Pdt601PlanillaInput{RegimenLaboral: models.Pdt601RegimenGeneral, FechaEntrega: "2026-07-20"})
	if err != nil {
		t.Fatalf("SavePdt601Planilla late: %v", err)
	}
	if _, err := svc.ApproveDeclaration(onTime.Declaration.ID, 9); err != nil {
		t.Fatalf("Approve on_time: %v", err)
	}
	if _, err := svc.ApproveDeclaration(late.Declaration.ID, 9); err != nil {
		t.Fatalf("Approve late: %v", err)
	}

	gotOnTime, err := svc.EnsurePdt601(coOnTime.ID, periodYM)
	if err != nil {
		t.Fatalf("EnsurePdt601 on_time: %v", err)
	}
	if gotOnTime.Declaration.Status != models.SupervisorDeclEntregado || gotOnTime.Timeliness != TimelinessOnTime {
		t.Fatalf("on_time: status=%s timeliness=%s", gotOnTime.Declaration.Status, gotOnTime.Timeliness)
	}
	gotLate, err := svc.EnsurePdt601(coLate.ID, periodYM)
	if err != nil {
		t.Fatalf("EnsurePdt601 late: %v", err)
	}
	if gotLate.Declaration.Status != models.SupervisorDeclEntregado || gotLate.Timeliness != TimelinessLate {
		t.Fatalf("late: status=%s timeliness=%s", gotLate.Declaration.Status, gotLate.Timeliness)
	}
}

func TestPdt601Filter_EntregadoATiempoYFueraDeFecha(t *testing.T) {
	db := setupPdt601TestDB(t)
	svc := NewSupervisorService()
	coOnTime := seedEstudioCompany(t, db, "T003")
	coLate := seedEstudioCompany(t, db, "T004")
	periodYM := "2026-07"
	if _, err := svc.CreatePeriod(periodYM, "test"); err != nil {
		t.Fatalf("CreatePeriod: %v", err)
	}
	seedPdt601CalendarRule(t, db, periodYM, 15, 0)

	onTime, err := svc.SavePdt601Planilla(coOnTime.ID, periodYM, Pdt601PlanillaInput{RegimenLaboral: models.Pdt601RegimenGeneral, FechaEntrega: "2026-07-10"})
	if err != nil {
		t.Fatalf("save on_time: %v", err)
	}
	late, err := svc.SavePdt601Planilla(coLate.ID, periodYM, Pdt601PlanillaInput{RegimenLaboral: models.Pdt601RegimenGeneral, FechaEntrega: "2026-07-20"})
	if err != nil {
		t.Fatalf("save late: %v", err)
	}
	if _, err := svc.ApproveDeclaration(onTime.Declaration.ID, 9); err != nil {
		t.Fatalf("approve on_time: %v", err)
	}
	if _, err := svc.ApproveDeclaration(late.Declaration.ID, 9); err != nil {
		t.Fatalf("approve late: %v", err)
	}

	resATiempo, err := svc.ListPdt601(Pdt601ListParams{PeriodYM: periodYM, Status: pdt601StatusFilterEntregadoATiempo, Page: 1, PerPage: 20})
	if err != nil {
		t.Fatalf("ListPdt601 a_tiempo: %v", err)
	}
	if len(resATiempo.Rows) != 1 || resATiempo.Rows[0].CompanyID != coOnTime.ID {
		t.Fatalf("entregado_a_tiempo debía traer solo %d, trajo %+v", coOnTime.ID, resATiempo.Rows)
	}

	resFuera, err := svc.ListPdt601(Pdt601ListParams{PeriodYM: periodYM, Status: pdt601StatusFilterEntregadoFueraDeFecha, Page: 1, PerPage: 20})
	if err != nil {
		t.Fatalf("ListPdt601 fuera_de_fecha: %v", err)
	}
	if len(resFuera.Rows) != 1 || resFuera.Rows[0].CompanyID != coLate.ID {
		t.Fatalf("entregado_fuera_de_fecha debía traer solo %d, trajo %+v", coLate.ID, resFuera.Rows)
	}
}

func TestPdt601Filter_FueraDeFecha_VacioSinCalendarioConfigurado(t *testing.T) {
	db := setupPdt601TestDB(t)
	svc := NewSupervisorService()
	co := seedEstudioCompany(t, db, "T005")
	periodYM := "2026-07"
	if _, err := svc.CreatePeriod(periodYM, "test"); err != nil {
		t.Fatalf("CreatePeriod: %v", err)
	}
	// Sin seedPdt601CalendarRule a propósito: no hay actividad configurada en el calendario.

	detail, err := svc.SavePdt601Planilla(co.ID, periodYM, Pdt601PlanillaInput{RegimenLaboral: models.Pdt601RegimenGeneral, FechaEntrega: "2026-07-20"})
	if err != nil {
		t.Fatalf("save: %v", err)
	}
	if _, err := svc.ApproveDeclaration(detail.Declaration.ID, 9); err != nil {
		t.Fatalf("approve: %v", err)
	}

	resFuera, err := svc.ListPdt601(Pdt601ListParams{PeriodYM: periodYM, Status: pdt601StatusFilterEntregadoFueraDeFecha, Page: 1, PerPage: 20})
	if err != nil {
		t.Fatalf("ListPdt601 fuera_de_fecha: %v", err)
	}
	if len(resFuera.Rows) != 0 {
		t.Fatalf("sin calendario configurado no debía haber ningún 'fuera de fecha', trajo %+v", resFuera.Rows)
	}
	resATiempo, err := svc.ListPdt601(Pdt601ListParams{PeriodYM: periodYM, Status: pdt601StatusFilterEntregadoATiempo, Page: 1, PerPage: 20})
	if err != nil {
		t.Fatalf("ListPdt601 a_tiempo: %v", err)
	}
	if len(resATiempo.Rows) != 1 {
		t.Fatalf("sin calendario configurado, 'entregado' debía contar como a tiempo, trajo %+v", resATiempo.Rows)
	}
}

func TestPdt621EntregadoLabel_UsesInternalCalendar_NotSunatSchedule(t *testing.T) {
	db := setupPdt621TestDBWithCalendar(t)
	svc := NewSupervisorService()
	co := seedEstudioCompany(t, db, "T006")
	periodYM := "2026-07"
	if _, err := svc.CreatePeriod(periodYM, "test"); err != nil {
		t.Fatalf("CreatePeriod: %v", err)
	}
	seedPdt621CalendarRule(t, db, periodYM, 15, 0)

	detail, err := svc.SavePdt621Record(co.ID, periodYM, Pdt621RecordInput{PrimeraEntregaFecha: "2026-07-20"})
	if err != nil {
		t.Fatalf("SavePdt621Record: %v", err)
	}
	if _, err := svc.ApproveDeclaration(detail.Declaration.ID, 9); err != nil {
		t.Fatalf("Approve: %v", err)
	}

	got, err := svc.EnsurePdt621(co.ID, periodYM)
	if err != nil {
		t.Fatalf("EnsurePdt621: %v", err)
	}
	if got.AssistantTimeliness != TimelinessLate {
		t.Fatalf("AssistantTimeliness=%s, want late (entregó el 20, vencía el 15 según el calendario interno)", got.AssistantTimeliness)
	}
}

func TestPdt621Filter_EntregadoATiempoYFueraDeFecha(t *testing.T) {
	db := setupPdt621TestDBWithCalendar(t)
	svc := NewSupervisorService()
	coOnTime := seedEstudioCompany(t, db, "T007")
	coLate := seedEstudioCompany(t, db, "T008")
	periodYM := "2026-07"
	if _, err := svc.CreatePeriod(periodYM, "test"); err != nil {
		t.Fatalf("CreatePeriod: %v", err)
	}
	seedPdt621CalendarRule(t, db, periodYM, 15, 0)

	onTime, err := svc.SavePdt621Record(coOnTime.ID, periodYM, Pdt621RecordInput{PrimeraEntregaFecha: "2026-07-10"})
	if err != nil {
		t.Fatalf("save on_time: %v", err)
	}
	late, err := svc.SavePdt621Record(coLate.ID, periodYM, Pdt621RecordInput{PrimeraEntregaFecha: "2026-07-20"})
	if err != nil {
		t.Fatalf("save late: %v", err)
	}
	if _, err := svc.ApproveDeclaration(onTime.Declaration.ID, 9); err != nil {
		t.Fatalf("approve on_time: %v", err)
	}
	if _, err := svc.ApproveDeclaration(late.Declaration.ID, 9); err != nil {
		t.Fatalf("approve late: %v", err)
	}

	resATiempo, err := svc.ListPdt621(Pdt621ListParams{PeriodYM: periodYM, Status: pdt621StatusFilterEntregadoATiempo, Page: 1, PerPage: 20})
	if err != nil {
		t.Fatalf("ListPdt621 a_tiempo: %v", err)
	}
	if len(resATiempo.Rows) != 1 || resATiempo.Rows[0].CompanyID != coOnTime.ID {
		t.Fatalf("entregado_a_tiempo debía traer solo %d, trajo %+v", coOnTime.ID, resATiempo.Rows)
	}

	resFuera, err := svc.ListPdt621(Pdt621ListParams{PeriodYM: periodYM, Status: pdt621StatusFilterEntregadoFueraDeFecha, Page: 1, PerPage: 20})
	if err != nil {
		t.Fatalf("ListPdt621 fuera_de_fecha: %v", err)
	}
	if len(resFuera.Rows) != 1 || resFuera.Rows[0].CompanyID != coLate.ID {
		t.Fatalf("entregado_fuera_de_fecha debía traer solo %d, trajo %+v", coLate.ID, resFuera.Rows)
	}
}
