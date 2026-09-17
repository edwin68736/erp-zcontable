package services

// Cubre la apertura de "Completado" en EntregadoATiempo/EntregadoFueraDeFecha del dashboard
// (docs/diseno-estados-pdt601-pdt621-2026-09-16.md §12.1) — sin tocar los demás buckets (Pendiente/
// Observado/Vencido/SinPlanilla/Suspendida), que ya funcionaban antes de este cambio.

import (
	"testing"
	"time"

	"miappfiber/database"
	"miappfiber/models"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func setupDashboardPuntualidadTestDB(t *testing.T) *gorm.DB {
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

func TestPdtDashboardSummary_SplitsEntregadoByPuntualidad(t *testing.T) {
	db := setupDashboardPuntualidadTestDB(t)
	svc := NewSupervisorService()
	coOnTime := seedEstudioCompany(t, db, "D001")
	coLate := seedEstudioCompany(t, db, "D002")
	coPending := seedEstudioCompany(t, db, "D003")
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
	// coPending: queda en Pendiente (nunca se guarda planilla) — control de que no se cuente como
	// entregado de ningún tipo.
	if _, err := svc.EnsurePdt601(coPending.ID, periodYM); err != nil {
		t.Fatalf("EnsurePdt601 pending: %v", err)
	}

	out, err := svc.PdtDashboardSummary(SupervisorDashboardParams{PeriodYM: periodYM})
	if err != nil {
		t.Fatalf("PdtDashboardSummary: %v", err)
	}
	got := out[models.SupervisorDeclPDT601]
	if got.Completado != 2 {
		t.Fatalf("Completado=%d, want 2", got.Completado)
	}
	if got.EntregadoATiempo != 1 {
		t.Fatalf("EntregadoATiempo=%d, want 1", got.EntregadoATiempo)
	}
	if got.EntregadoFueraDeFecha != 1 {
		t.Fatalf("EntregadoFueraDeFecha=%d, want 1", got.EntregadoFueraDeFecha)
	}
	// coPending no debe contarse como Completado/Entregado de ningún tipo — cae en Pendiente o
	// Vencido según si ya pasó la fecha límite del período respecto a "hoy" (no es el foco de este
	// test, que es la apertura por puntualidad de lo ya entregado).
	if got.Pendiente+got.Vencido != 1 {
		t.Fatalf("Pendiente+Vencido=%d, want 1 (la empresa sin planilla guardada no debe contarse como entregada)", got.Pendiente+got.Vencido)
	}
}

// TestPdtAssistantPerformance_OneRowPerAssistantAndType cubre §12.3: una fila por (asistente, tipo
// de declaración), con los mismos buckets que PdtDashboardSummary, y que empresas sin asistente
// asignado no contaminan el resultado.
func TestPdtAssistantPerformance_OneRowPerAssistantAndType(t *testing.T) {
	db := setupDashboardPuntualidadTestDB(t)
	if err := db.AutoMigrate(&models.User{}); err != nil {
		t.Fatalf("migrate users: %v", err)
	}
	svc := NewSupervisorService()

	juan := models.User{Name: "Juan Pérez", Username: "juan"}
	if err := db.Create(&juan).Error; err != nil {
		t.Fatalf("seed juan: %v", err)
	}
	maria := models.User{Name: "María López", Username: "maria"}
	if err := db.Create(&maria).Error; err != nil {
		t.Fatalf("seed maria: %v", err)
	}

	coJuanOnTime := seedEstudioCompany(t, db, "D101")
	coJuanOnTime.AssistantUserID = &juan.ID
	if err := db.Save(&coJuanOnTime).Error; err != nil {
		t.Fatalf("assign juan: %v", err)
	}
	coJuanLate := seedEstudioCompany(t, db, "D102")
	coJuanLate.AssistantUserID = &juan.ID
	if err := db.Save(&coJuanLate).Error; err != nil {
		t.Fatalf("assign juan 2: %v", err)
	}
	coMaria := seedEstudioCompany(t, db, "D103")
	coMaria.AssistantUserID = &maria.ID
	if err := db.Save(&coMaria).Error; err != nil {
		t.Fatalf("assign maria: %v", err)
	}
	coSinAsistente := seedEstudioCompany(t, db, "D104") // sin asistente asignado

	periodYM := "2026-07"
	if _, err := svc.CreatePeriod(periodYM, "test"); err != nil {
		t.Fatalf("CreatePeriod: %v", err)
	}
	seedPdt601CalendarRule(t, db, periodYM, 15, 0)

	onTime, err := svc.SavePdt601Planilla(coJuanOnTime.ID, periodYM, Pdt601PlanillaInput{RegimenLaboral: models.Pdt601RegimenGeneral, FechaEntrega: "2026-07-10"})
	if err != nil {
		t.Fatalf("save juan on_time: %v", err)
	}
	if _, err := svc.ApproveDeclaration(onTime.Declaration.ID, 9); err != nil {
		t.Fatalf("approve juan on_time: %v", err)
	}
	late, err := svc.SavePdt601Planilla(coJuanLate.ID, periodYM, Pdt601PlanillaInput{RegimenLaboral: models.Pdt601RegimenGeneral, FechaEntrega: "2026-07-20"})
	if err != nil {
		t.Fatalf("save juan late: %v", err)
	}
	if _, err := svc.ApproveDeclaration(late.Declaration.ID, 9); err != nil {
		t.Fatalf("approve juan late: %v", err)
	}
	if _, err := svc.EnsurePdt601(coMaria.ID, periodYM); err != nil {
		t.Fatalf("EnsurePdt601 maria: %v", err)
	}
	if _, err := svc.EnsurePdt601(coSinAsistente.ID, periodYM); err != nil {
		t.Fatalf("EnsurePdt601 sin asistente: %v", err)
	}

	rows, err := svc.PdtAssistantPerformance(SupervisorDashboardParams{PeriodYM: periodYM})
	if err != nil {
		t.Fatalf("PdtAssistantPerformance: %v", err)
	}

	byAssistant := map[uint]PdtAssistantSummary{}
	for _, r := range rows {
		if r.DeclarationType == models.SupervisorDeclPDT601 {
			byAssistant[r.AssistantUserID] = r
		}
	}
	juanRow, ok := byAssistant[juan.ID]
	if !ok {
		t.Fatal("no se encontró fila de Juan para pdt_601")
	}
	if juanRow.AssistantUsername != "juan" {
		t.Fatalf("AssistantUsername=%q, want juan", juanRow.AssistantUsername)
	}
	if juanRow.EntregadoATiempo != 1 || juanRow.EntregadoFueraDeFecha != 1 {
		t.Fatalf("Juan: EntregadoATiempo=%d EntregadoFueraDeFecha=%d, want 1/1", juanRow.EntregadoATiempo, juanRow.EntregadoFueraDeFecha)
	}
	if juanRow.Total != 2 {
		t.Fatalf("Juan: Total=%d, want 2", juanRow.Total)
	}

	mariaRow, ok := byAssistant[maria.ID]
	if !ok {
		t.Fatal("no se encontró fila de María para pdt_601")
	}
	if mariaRow.Total != 1 || mariaRow.EntregadoATiempo != 0 || mariaRow.EntregadoFueraDeFecha != 0 {
		t.Fatalf("María: Total=%d EntregadoATiempo=%d EntregadoFueraDeFecha=%d, want 1/0/0", mariaRow.Total, mariaRow.EntregadoATiempo, mariaRow.EntregadoFueraDeFecha)
	}

	// La empresa sin asistente asignado no debe aportar ninguna fila.
	for _, r := range rows {
		if r.AssistantUserID == 0 {
			t.Fatalf("no debía haber fila con assistant_user_id vacío: %+v", r)
		}
	}
	totalRowsForPdt601 := 0
	for _, r := range rows {
		if r.DeclarationType == models.SupervisorDeclPDT601 {
			totalRowsForPdt601++
		}
	}
	if totalRowsForPdt601 != 2 {
		t.Fatalf("esperaba exactamente 2 filas pdt_601 (Juan y María), hubo %d", totalRowsForPdt601)
	}
}

// TestPdtDashboardSummary_VencidoUsaCalendarioNoFechaGenericaDelControl cubre docs/diseno-limpieza-
// control-detail-2026-09-16.md §5.7: una declaración PDT 601 todavía sin entregar debe contar como
// "Vencido" cuando ya pasó la fecha límite del calendario interno (por grupo de RUC), aunque la
// fecha genérica del control (periodDefaultDueDate, día 20 del mes SIGUIENTE) todavía no haya
// llegado — antes de la corrección, esta empresa seguía en "Pendiente" hasta esa fecha genérica.
func TestPdtDashboardSummary_VencidoUsaCalendarioNoFechaGenericaDelControl(t *testing.T) {
	now := time.Now()
	if now.Day() == 1 {
		t.Skip("necesita al menos un día transcurrido del mes para fijar una fecha de calendario ya vencida")
	}
	db := setupDashboardPuntualidadTestDB(t)
	svc := NewSupervisorService()
	co := seedEstudioCompany(t, db, "D006")
	periodYM := now.Format("2006-01")
	if _, err := svc.CreatePeriod(periodYM, "test"); err != nil {
		t.Fatalf("CreatePeriod: %v", err)
	}
	seedPdt601CalendarRule(t, db, periodYM, now.Day()-1, 0)

	if _, err := svc.EnsurePdt601(co.ID, periodYM); err != nil {
		t.Fatalf("EnsurePdt601: %v", err)
	}

	out, err := svc.PdtDashboardSummary(SupervisorDashboardParams{PeriodYM: periodYM})
	if err != nil {
		t.Fatalf("PdtDashboardSummary: %v", err)
	}
	got := out[models.SupervisorDeclPDT601]
	if got.Vencido != 1 {
		t.Fatalf("Vencido=%d, want 1 (la fecha límite del calendario ya pasó, aunque la fecha genérica del control todavía no)", got.Vencido)
	}
	if got.Pendiente != 0 {
		t.Fatalf("Pendiente=%d, want 0", got.Pendiente)
	}
}

// Mismo caso que arriba, para PDT 621 — misma corrección aplicada en paralelo a pdt621Vencido.
func TestPdtDashboardSummary_Pdt621VencidoUsaCalendarioNoFechaGenericaDelControl(t *testing.T) {
	now := time.Now()
	if now.Day() == 1 {
		t.Skip("necesita al menos un día transcurrido del mes para fijar una fecha de calendario ya vencida")
	}
	db := setupDashboardPuntualidadTestDB(t)
	svc := NewSupervisorService()
	co := seedEstudioCompany(t, db, "D007")
	periodYM := now.Format("2006-01")
	if _, err := svc.CreatePeriod(periodYM, "test"); err != nil {
		t.Fatalf("CreatePeriod: %v", err)
	}
	seedPdt621CalendarRule(t, db, periodYM, now.Day()-1, 0)

	if _, err := svc.EnsurePdt621(co.ID, periodYM); err != nil {
		t.Fatalf("EnsurePdt621: %v", err)
	}

	out, err := svc.PdtDashboardSummary(SupervisorDashboardParams{PeriodYM: periodYM})
	if err != nil {
		t.Fatalf("PdtDashboardSummary: %v", err)
	}
	got := out[models.SupervisorDeclPDT621]
	if got.Vencido != 1 {
		t.Fatalf("Vencido=%d, want 1 (la fecha límite del calendario ya pasó, aunque la fecha genérica del control todavía no)", got.Vencido)
	}
	if got.Pendiente != 0 {
		t.Fatalf("Pendiente=%d, want 0", got.Pendiente)
	}
}

func TestPdtDashboardSummary_EntregadoSinCalendario_CuentaComoATiempo(t *testing.T) {
	db := setupDashboardPuntualidadTestDB(t)
	svc := NewSupervisorService()
	co := seedEstudioCompany(t, db, "D004")
	periodYM := "2026-07"
	if _, err := svc.CreatePeriod(periodYM, "test"); err != nil {
		t.Fatalf("CreatePeriod: %v", err)
	}
	// Sin seedPdt601CalendarRule a propósito.

	detail, err := svc.SavePdt601Planilla(co.ID, periodYM, Pdt601PlanillaInput{RegimenLaboral: models.Pdt601RegimenGeneral, FechaEntrega: "2026-07-20"})
	if err != nil {
		t.Fatalf("save: %v", err)
	}
	if _, err := svc.ApproveDeclaration(detail.Declaration.ID, 9); err != nil {
		t.Fatalf("approve: %v", err)
	}

	out, err := svc.PdtDashboardSummary(SupervisorDashboardParams{PeriodYM: periodYM})
	if err != nil {
		t.Fatalf("PdtDashboardSummary: %v", err)
	}
	got := out[models.SupervisorDeclPDT601]
	if got.EntregadoATiempo != 1 || got.EntregadoFueraDeFecha != 0 {
		t.Fatalf("sin calendario configurado: EntregadoATiempo=%d EntregadoFueraDeFecha=%d, want 1/0", got.EntregadoATiempo, got.EntregadoFueraDeFecha)
	}
}
