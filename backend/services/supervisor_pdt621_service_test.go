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
		PrimeraEntregaFecha: "2026-07-05",
		PrimeraEntregaHora:  "09:30",
		Observacion:         "Archivador incompleto",
		SegundaEntregaFecha: "2026-07-08",
		SegundaEntregaHora:  "11:00",
		FechaDeclaracion:    "2026-07-10",
		TotalVentas:         12000,
		TotalCompras:        8000,
		Igv:                 720,
		Rta:                 150,
		EnvioSire:           "si",
		FechaEnvioSire:      "2026-07-11",
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

// TestListPdt621DeclarationTimelinessOnTimeAndLate cubre la comparación fecha_declaracion vs.
// el cronograma SUNAT por dígito de RUC.
func TestListPdt621DeclarationTimelinessOnTimeAndLate(t *testing.T) {
	db := setupPdt621TestDB(t)
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
	// Mes 7 (julio): dígito 0 vence el 8-ago, dígito 1 vence el 9-ago.
	seedSunatSchedule(t, db, 7, [10]string{
		"2026-08-08", "2026-08-09", "2026-08-10", "2026-08-10", "2026-08-11",
		"2026-08-11", "2026-08-12", "2026-08-12", "2026-08-13", "2026-08-13",
	})

	if _, err := svc.SavePdt621Record(coOnTime.ID, periodYM, Pdt621RecordInput{FechaDeclaracion: "2026-08-08"}); err != nil {
		t.Fatalf("save on_time: %v", err)
	}
	if _, err := svc.SavePdt621Record(coLate.ID, periodYM, Pdt621RecordInput{FechaDeclaracion: "2026-08-15"}); err != nil {
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
		t.Fatalf("dígito 0 declarado el 8-ago: timeliness=%q want %q", rowOnTime.DeclarationTimeliness, TimelinessOnTime)
	}
	if rowOnTime.ScheduleDueDate == nil || *rowOnTime.ScheduleDueDate != "2026-08-08" {
		t.Fatalf("schedule_due_date dígito 0=%v want 2026-08-08", rowOnTime.ScheduleDueDate)
	}
	rowLate := byCompany[coLate.ID]
	if rowLate.DeclarationTimeliness != TimelinessLate {
		t.Fatalf("dígito 1 declarado el 15-ago (vence 9-ago): timeliness=%q want %q", rowLate.DeclarationTimeliness, TimelinessLate)
	}
}

// TestListPdt621DeclarationTimelinessMissing cubre pendiente-vencido: sin fecha_declaracion y
// con el vencimiento del cronograma ya pasado.
func TestListPdt621DeclarationTimelinessMissing(t *testing.T) {
	db := setupPdt621TestDB(t)
	svc := NewSupervisorService()
	co := seedEstudioCompany(t, db, "R012")
	if err := db.Create(&models.CompanyAccessCredential{CompanyID: co.ID, Dig: "0"}).Error; err != nil {
		t.Fatalf("cred: %v", err)
	}

	// Período dos meses antes de "ahora" real, para que el vencimiento quede en el pasado sin
	// importar la fecha real de ejecución del test (mismo patrón que los tests de PDT 601).
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
	// No se guarda ningún record para esta empresa: sigue "sin_registro" y sin fecha_declaracion.

	res, err := svc.ListPdt621(Pdt621ListParams{PeriodYM: periodYM, Page: 1, PerPage: 20})
	if err != nil {
		t.Fatalf("ListPdt621: %v", err)
	}
	if len(res.Rows) != 1 || res.Rows[0].DeclarationTimeliness != TimelinessMissing {
		t.Fatalf("sin declarar y vencido: %+v", res.Rows)
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
