package services

import (
	"encoding/json"
	"testing"
	"time"

	"miappfiber/database"
	"miappfiber/models"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func setupPdt621TestDB(t *testing.T) *gorm.DB {
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
		&models.SupervisorPdt621Record{},
		&models.CompanyAccessCredential{},
		&models.SunatDueDateCalendarRow{},
	); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	database.DB = db
	return db
}

// seedSunatSchedule crea la fila del cronograma para `month` con las 10 fechas indicadas
// (índice = dígito de RUC 0-9), replicando lo que /finance/sunat-due-dates ya mantiene.
func seedSunatSchedule(t *testing.T, db *gorm.DB, month int, dates [10]string) {
	t.Helper()
	raw, err := json.Marshal(dates)
	if err != nil {
		t.Fatalf("marshal dates: %v", err)
	}
	row := models.SunatDueDateCalendarRow{Month: month, DatesJSON: string(raw)}
	if err := db.Create(&row).Error; err != nil {
		t.Fatalf("seed sunat schedule: %v", err)
	}
}

// TestListPdt621FiltersByDigAndAssistant cubre los filtros de dígito de empresa y asistente.
func TestListPdt621FiltersByDigAndAssistant(t *testing.T) {
	db := setupPdt621TestDB(t)
	svc := NewSupervisorService()
	coA := seedEstudioCompany(t, db, "R005")
	coB := seedEstudioCompany(t, db, "R006")

	assistantA := uint(101)
	assistantB := uint(202)
	if err := db.Model(&coA).Update("assistant_user_id", assistantA).Error; err != nil {
		t.Fatalf("set assistant A: %v", err)
	}
	if err := db.Model(&coB).Update("assistant_user_id", assistantB).Error; err != nil {
		t.Fatalf("set assistant B: %v", err)
	}
	if err := db.Create(&models.CompanyAccessCredential{CompanyID: coA.ID, Dig: "3"}).Error; err != nil {
		t.Fatalf("cred A: %v", err)
	}
	if err := db.Create(&models.CompanyAccessCredential{CompanyID: coB.ID, Dig: "7"}).Error; err != nil {
		t.Fatalf("cred B: %v", err)
	}

	if _, err := svc.CreatePeriod("2026-07", "test"); err != nil {
		t.Fatalf("CreatePeriod: %v", err)
	}

	byAssistant, err := svc.ListPdt621(Pdt621ListParams{PeriodYM: "2026-07", AssistantUserID: assistantA, Page: 1, PerPage: 20})
	if err != nil {
		t.Fatalf("ListPdt621 by assistant: %v", err)
	}
	if len(byAssistant.Rows) != 1 || byAssistant.Rows[0].CompanyID != coA.ID {
		t.Fatalf("filtro asistente trajo filas inesperadas: %+v", byAssistant.Rows)
	}

	byDig, err := svc.ListPdt621(Pdt621ListParams{PeriodYM: "2026-07", Dig: "7", Page: 1, PerPage: 20})
	if err != nil {
		t.Fatalf("ListPdt621 by dig: %v", err)
	}
	if len(byDig.Rows) != 1 || byDig.Rows[0].CompanyID != coB.ID {
		t.Fatalf("filtro dig trajo filas inesperadas: %+v", byDig.Rows)
	}
}

// TestSavePdt621RecordRoundTrip cubre guardar → leer → listar el seguimiento PDT 621.
func TestSavePdt621RecordRoundTrip(t *testing.T) {
	db := setupPdt621TestDB(t)
	svc := NewSupervisorService()
	co := seedEstudioCompany(t, db, "R001")

	if _, err := svc.CreatePeriod("2026-07", "test"); err != nil {
		t.Fatalf("CreatePeriod: %v", err)
	}

	in := Pdt621RecordInput{
		Observacion:      "Archivador incompleto",
		FechaDeclaracion: "2026-07-10",
		TotalVentas:      12000,
		TotalCompras:     8000,
		Igv:              720,
		Rta:              150,
		EnvioSire:        "si",
		FechaEnvioSire:   "2026-07-11",
	}
	saved, err := svc.SavePdt621Record(co.ID, "2026-07", in)
	if err != nil {
		t.Fatalf("SavePdt621Record: %v", err)
	}
	if saved.Record == nil {
		t.Fatal("detalle sin record tras guardar")
	}
	if saved.Record.TotalVentas != 12000 || saved.Record.Igv != 720 {
		t.Fatalf("importes inesperados: %+v", saved.Record)
	}
	if saved.Record.FechaDeclaracion == nil || *saved.Record.FechaDeclaracion != "2026-07-10" {
		t.Fatalf("fecha_declaracion=%v want 2026-07-10", saved.Record.FechaDeclaracion)
	}

	// Lectura pura (sin lazy create adicional) rehidrata lo guardado.
	got, err := svc.GetPdt621Record(co.ID, "2026-07")
	if err != nil {
		t.Fatalf("GetPdt621Record: %v", err)
	}
	if got == nil || got.Observacion != "Archivador incompleto" {
		t.Fatalf("record rehidratado inesperado: %+v", got)
	}

	// Upsert: guardar de nuevo actualiza, no duplica.
	in.TotalVentas = 15000
	if _, err := svc.SavePdt621Record(co.ID, "2026-07", in); err != nil {
		t.Fatalf("Save upsert: %v", err)
	}
	var count int64
	if err := db.Model(&models.SupervisorPdt621Record{}).Count(&count).Error; err != nil {
		t.Fatalf("count: %v", err)
	}
	if count != 1 {
		t.Fatalf("filas record=%d want 1 (upsert)", count)
	}
	again, err := svc.GetPdt621Record(co.ID, "2026-07")
	if err != nil {
		t.Fatalf("GetPdt621Record tras upsert: %v", err)
	}
	if again.TotalVentas != 15000 {
		t.Fatalf("total_ventas tras upsert=%v want 15000", again.TotalVentas)
	}

	// El listado del período trae el record embebido.
	list, err := svc.ListPdt621(Pdt621ListParams{PeriodYM: "2026-07", Page: 1, PerPage: 20})
	if err != nil {
		t.Fatalf("ListPdt621: %v", err)
	}
	if len(list.Rows) != 1 || list.Rows[0].Record == nil {
		t.Fatalf("listado sin record embebido: %+v", list.Rows)
	}
	if list.Rows[0].TaxRegime != co.TaxRegime {
		t.Fatalf("tax_regime=%q want %q", list.Rows[0].TaxRegime, co.TaxRegime)
	}
}

// La declaración (tarea del supervisor) se mide contra la actividad PDT 621 del calendario interno, solo por fecha, en el
// calendario del mes siguiente al periodo. El cronograma oficial de SUNAT queda como dato informativo.
func TestListPdt621DeclarationTimelinessOnTimeAndLate(t *testing.T) {
	db := setupPdt621TestDBWithCalendar(t)
	svc := NewSupervisorService()
	coOnTime := seedEstudioCompany(t, db, "R010")
	coLate := seedEstudioCompany(t, db, "R011")
	if err := db.Create(&models.CompanyAccessCredential{CompanyID: coOnTime.ID, Dig: "0"}).Error; err != nil {
		t.Fatalf("cred on_time: %v", err)
	}
	if err := db.Create(&models.CompanyAccessCredential{CompanyID: coLate.ID, Dig: "1"}).Error; err != nil {
		t.Fatalf("cred late: %v", err)
	}

	periodYM := "2026-07"
	if _, err := svc.CreatePeriod(periodYM, "test"); err != nil {
		t.Fatalf("CreatePeriod: %v", err)
	}
	// Calendario de agosto: el PDT 621 vence el día 10. SUNAT (solo informativo): dígito 0 el 8-ago.
	seedPdt621CalendarRuleConHora(t, db, periodYM, 10, models.ActivityRuleCompareDate, "")
	seedSunatSchedule(t, db, 7, [10]string{
		"2026-08-08", "2026-08-09", "2026-08-10", "2026-08-10", "2026-08-11",
		"2026-08-11", "2026-08-12", "2026-08-12", "2026-08-13", "2026-08-13",
	})

	// El 10-ago es a tiempo contra el calendario aunque pase del 8-ago de SUNAT; el 11-ago es tarde.
	if _, err := svc.SavePdt621Record(coOnTime.ID, periodYM, Pdt621RecordInput{FechaDeclaracion: "2026-08-10"}); err != nil {
		t.Fatalf("save on_time: %v", err)
	}
	if _, err := svc.SavePdt621Record(coLate.ID, periodYM, Pdt621RecordInput{FechaDeclaracion: "2026-08-11"}); err != nil {
		t.Fatalf("save late: %v", err)
	}

	res, err := svc.ListPdt621(Pdt621ListParams{PeriodYM: periodYM, Page: 1, PerPage: 20})
	if err != nil {
		t.Fatalf("ListPdt621: %v", err)
	}
	byCompany := map[uint]Pdt621ListRow{}
	for _, r := range res.Rows {
		byCompany[r.CompanyID] = r
	}
	rowOnTime := byCompany[coOnTime.ID]
	if rowOnTime.DeclarationTimeliness != TimelinessOnTime {
		t.Fatalf("declarada el 10-ago (límite del calendario 10-ago): timeliness=%q want %q", rowOnTime.DeclarationTimeliness, TimelinessOnTime)
	}
	if rowOnTime.ScheduleDueDate == nil || *rowOnTime.ScheduleDueDate != "2026-08-08" {
		t.Fatalf("schedule_due_date (informativa) dígito 0=%v want 2026-08-08", rowOnTime.ScheduleDueDate)
	}
	rowLate := byCompany[coLate.ID]
	if rowLate.DeclarationTimeliness != TimelinessLate {
		t.Fatalf("declarada el 11-ago (límite 10-ago): timeliness=%q want %q", rowLate.DeclarationTimeliness, TimelinessLate)
	}
}

// Sin declarar y con el límite del calendario ya pasado, la declaración está vencida.
func TestListPdt621DeclarationTimelinessMissing(t *testing.T) {
	db := setupPdt621TestDBWithCalendar(t)
	svc := NewSupervisorService()
	co := seedEstudioCompany(t, db, "R012")
	if err := db.Create(&models.CompanyAccessCredential{CompanyID: co.ID, Dig: "0"}).Error; err != nil {
		t.Fatalf("cred: %v", err)
	}

	// Periodo de hace dos meses: su calendario (el del mes siguiente) ya quedó atrás sin importar la fecha de ejecución.
	periodYM := time.Now().AddDate(0, -2, 0).Format("2006-01")
	if _, err := svc.CreatePeriod(periodYM, "test"); err != nil {
		t.Fatalf("CreatePeriod: %v", err)
	}
	seedPdt621CalendarRuleConHora(t, db, periodYM, 5, models.ActivityRuleCompareDate, "")

	res, err := svc.ListPdt621(Pdt621ListParams{PeriodYM: periodYM, Page: 1, PerPage: 20})
	if err != nil {
		t.Fatalf("ListPdt621: %v", err)
	}
	if len(res.Rows) != 1 || res.Rows[0].DeclarationTimeliness != TimelinessMissing {
		t.Fatalf("sin declarar y vencido: %+v", res.Rows)
	}
}

// Las dos tareas del PDT 621 son de responsables distintos y se miden por separado contra la misma actividad: el asistente
// entrega el archivador a tiempo (el supervisor lo recepciona el 10-ago a las 9:00, límite 10-ago 15:00) y el supervisor
// declara al día siguiente. El asistente cumplió; la declaración queda fuera de fecha.
func TestPdt621_DosTareas_ArchivadorATiempoYDeclaracionAlDiaSiguiente(t *testing.T) {
	db := setupPdt621TestDBWithCalendar(t)
	svc := NewSupervisorService()
	periodYM := "2026-07"
	if _, err := svc.CreatePeriod(periodYM, "test"); err != nil {
		t.Fatalf("CreatePeriod: %v", err)
	}
	seedPdt621CalendarRuleConHora(t, db, periodYM, 10, models.ActivityRuleCompareDateTime, "15:00")
	co := seedEstudioCompany(t, db, "R030")
	if _, err := svc.SavePdt621Record(co.ID, periodYM, Pdt621RecordInput{FechaDeclaracion: "2026-08-11"}); err != nil {
		t.Fatalf("save declaración: %v", err)
	}
	recepcionarPdt621EnMomento(t, svc, co.ID, periodYM, "2026-08-10 09:00")

	d, err := svc.EnsurePdt621(co.ID, periodYM)
	if err != nil {
		t.Fatalf("EnsurePdt621: %v", err)
	}
	if d.AssistantTimeliness != TimelinessOnTime {
		t.Fatalf("archivador recepcionado el 10-ago 9:00 (límite 15:00): %s, want on_time", d.AssistantTimeliness)
	}
	if d.DeclarationTimeliness != TimelinessLate {
		t.Fatalf("declarado el 11-ago (límite 10-ago): %s, want late", d.DeclarationTimeliness)
	}
	if d.ArchivadorTardio {
		t.Fatal("el archivador llegó a tiempo: no debe marcarse como tardío")
	}
}

// Si el archivador es observado y el asistente entrega por segunda vez, queda fuera de fecha u hora aunque la primera
// entrega hubiera sido a tiempo. Mientras está observado, la tarea sigue abierta (no cuenta como entregada a tiempo).
func TestPdt621_Archivador_ObservadoYSegundaEntregaQuedaFueraDeFecha(t *testing.T) {
	db := setupPdt621TestDBWithCalendar(t)
	svc := NewSupervisorService()
	periodYM := "2026-07"
	if _, err := svc.CreatePeriod(periodYM, "test"); err != nil {
		t.Fatalf("CreatePeriod: %v", err)
	}
	seedPdt621CalendarRuleConHora(t, db, periodYM, 10, models.ActivityRuleCompareDateTime, "15:00")
	co := seedEstudioCompany(t, db, "R031")
	database.DB.Model(&models.Company{}).Where("id = ?", co.ID).Update("supervisor_user_id", testPdt621SupervisorID)

	recepcionar := func(momento string) *Pdt621Detail {
		t.Helper()
		at, err := time.ParseInLocation("2006-01-02 15:04", momento, limaLoc)
		if err != nil {
			t.Fatalf("momento %q: %v", momento, err)
		}
		prev := pdt621Now
		pdt621Now = func() time.Time { return at }
		defer func() { pdt621Now = prev }()
		d, err := svc.RecepcionarPdt621(co.ID, periodYM, testPdt621SupervisorID)
		if err != nil {
			t.Fatalf("recepcionar %s: %v", momento, err)
		}
		return d
	}

	d := recepcionar("2026-08-10 09:00") // primera entrega, a tiempo
	if _, err := svc.ObserveDeclaration(d.Declaration.ID, testPdt621SupervisorID, "falta el anexo"); err != nil {
		t.Fatalf("observar: %v", err)
	}
	obs, err := svc.EnsurePdt621(co.ID, periodYM)
	if err != nil {
		t.Fatalf("EnsurePdt621 observado: %v", err)
	}
	if obs.AssistantTimeliness == TimelinessOnTime || obs.AssistantTimeliness == TimelinessLate {
		t.Fatalf("observado, sin segunda entrega: %s; la tarea sigue abierta (pendiente o vencida)", obs.AssistantTimeliness)
	}

	d = recepcionar("2026-08-10 12:00") // segunda entrega, antes de la hora límite
	if _, err := svc.ApproveDeclaration(d.Declaration.ID, testPdt621SupervisorID); err != nil {
		t.Fatalf("aprobar: %v", err)
	}
	got, err := svc.EnsurePdt621(co.ID, periodYM)
	if err != nil {
		t.Fatalf("EnsurePdt621 final: %v", err)
	}
	if got.AssistantTimeliness != TimelinessLate {
		t.Fatalf("segunda entrega tras observación: %s, want late (siempre fuera de fecha u hora)", got.AssistantTimeliness)
	}
	r, err := svc.ListPdt621(Pdt621ListParams{PeriodYM: periodYM, Status: pdt621StatusFilterEntregadoFueraDeFecha, Page: 1, PerPage: 20})
	if err != nil {
		t.Fatalf("ListPdt621: %v", err)
	}
	if len(r.Rows) != 1 {
		t.Fatalf("el filtro «entregado fuera de fecha» debía traer la empresa, trajo %d", len(r.Rows))
	}
}

// TestPdt621BlockedWhenControlSuspendida cubre docs/diseno-limpieza-control-detail-2026-09-16.md
// §5.9.7: "suspendida" pasó a ser global por control (ya no se marca desde el propio record PDT
// 621, solo desde Control de Detracciones) — debe salir exempt en ambos cumplimientos (declaración
// SUNAT y entrega interna del asistente) sin importar la regla configurada, mismo criterio que "sin
// planilla" en PDT 601, y SavePdt621Record debe rechazarse mientras el control esté suspendido.
func TestPdt621BlockedWhenControlSuspendida(t *testing.T) {
	db := setupPdt621TestDB(t)
	svc := NewSupervisorService()
	co := seedEstudioCompany(t, db, "R020")
	if err := db.Create(&models.CompanyAccessCredential{CompanyID: co.ID, Dig: "0"}).Error; err != nil {
		t.Fatalf("cred: %v", err)
	}

	// Período con vencimiento ya pasado — si "suspendida" no eximiera, saldría "missing".
	periodYM := time.Now().AddDate(0, -2, 0).Format("2006-01")
	if _, err := svc.CreatePeriod(periodYM, "test"); err != nil {
		t.Fatalf("CreatePeriod: %v", err)
	}
	month := int(time.Now().AddDate(0, -2, 0).Month())
	yesterday := time.Now().AddDate(0, 0, -1).Format("2006-01-02")
	dates := [10]string{}
	for i := range dates {
		dates[i] = yesterday
	}
	seedSunatSchedule(t, db, month, dates)

	detail, err := svc.EnsurePdt621(co.ID, periodYM)
	if err != nil {
		t.Fatalf("EnsurePdt621: %v", err)
	}
	// Simula lo que hace Control de Detracciones (§5.9.7.3) — el único lugar que en el código real
	// marca este campo.
	if err := db.Model(&models.SupervisorMonthlyControl{}).
		Where("id = ?", detail.ControlID).Update("suspendida", true).Error; err != nil {
		t.Fatalf("marcar suspendida: %v", err)
	}

	if _, err := svc.SavePdt621Record(co.ID, periodYM, Pdt621RecordInput{TotalVentas: 999}); err == nil {
		t.Fatal("SavePdt621Record debía rechazarse con la empresa suspendida")
	}

	res, err := svc.ListPdt621(Pdt621ListParams{PeriodYM: periodYM, Page: 1, PerPage: 20})
	if err != nil {
		t.Fatalf("ListPdt621: %v", err)
	}
	if len(res.Rows) != 1 {
		t.Fatalf("filas inesperadas: %+v", res.Rows)
	}
	row := res.Rows[0]
	if !row.Suspendida {
		t.Fatalf("row.Suspendida debía ser true: %+v", row)
	}
	if row.DeclarationTimeliness != TimelinessExempt {
		t.Fatalf("empresa suspendida: declaration_timeliness=%q want %q", row.DeclarationTimeliness, TimelinessExempt)
	}
	if row.AssistantTimeliness != TimelinessExempt {
		t.Fatalf("empresa suspendida: assistant_timeliness=%q want %q", row.AssistantTimeliness, TimelinessExempt)
	}
	if row.IsOverdue {
		t.Fatalf("empresa suspendida no debería quedar is_overdue=true")
	}
}

// TestListPdt621DeclarationTimelinessNoRuleWithoutSchedule cubre el caso sin cronograma
// cargado para el mes del período: debe salir no_rule, no romper el listado.
func TestListPdt621DeclarationTimelinessNoRuleWithoutSchedule(t *testing.T) {
	db := setupPdt621TestDB(t)
	svc := NewSupervisorService()
	co := seedEstudioCompany(t, db, "R014")
	if err := db.Create(&models.CompanyAccessCredential{CompanyID: co.ID, Dig: "0"}).Error; err != nil {
		t.Fatalf("cred: %v", err)
	}

	periodYM := "2026-07"
	if _, err := svc.CreatePeriod(periodYM, "test"); err != nil {
		t.Fatalf("CreatePeriod: %v", err)
	}
	// Ningún SunatDueDateCalendarRow sembrado para el mes 7: no hay cronograma que validar.

	res, err := svc.ListPdt621(Pdt621ListParams{PeriodYM: periodYM, Page: 1, PerPage: 20})
	if err != nil {
		t.Fatalf("ListPdt621: %v", err)
	}
	if len(res.Rows) != 1 || res.Rows[0].CompanyID != co.ID {
		t.Fatalf("filas inesperadas: %+v", res.Rows)
	}
	if res.Rows[0].DeclarationTimeliness != TimelinessNoRule {
		t.Fatalf("sin cronograma cargado: timeliness=%q want %q", res.Rows[0].DeclarationTimeliness, TimelinessNoRule)
	}
	if res.Rows[0].ScheduleDueDate != nil {
		t.Fatalf("schedule_due_date debería ser nil sin cronograma, got %v", res.Rows[0].ScheduleDueDate)
	}
}
