package services

import (
	"testing"

	"miappfiber/database"
	"miappfiber/models"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func setupPdt601TestDB(t *testing.T) *gorm.DB {
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
		&models.SupervisorAttachment{},
		&models.CompanyAccessCredential{},
	); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	database.DB = db
	return db
}

func seedEstudioCompany(t *testing.T, db *gorm.DB, code string) models.Company {
	t.Helper()
	co := models.Company{
		RUC:          "20" + code + "1",
		BusinessName: "Empresa " + code,
		InternalCode: code,
		ClientType:   models.CompanyClientTypeEstudio,
		Status:       "activo",
	}
	if err := db.Create(&co).Error; err != nil {
		t.Fatalf("company: %v", err)
	}
	return co
}

// TestSavePdt601PlanillaRoundTrip cubre guardar → leer → listar, aislamiento por período y upsert.
func TestSavePdt601PlanillaRoundTrip(t *testing.T) {
	db := setupPdt601TestDB(t)
	svc := NewSupervisorService()
	co := seedEstudioCompany(t, db, "P001")

	if _, err := svc.CreatePeriod("2026-05", "test"); err != nil {
		t.Fatalf("CreatePeriod 05: %v", err)
	}
	if _, err := svc.CreatePeriod("2026-06", "test"); err != nil {
		t.Fatalf("CreatePeriod 06: %v", err)
	}

	in := Pdt601PlanillaInput{
		TrabajadoresONP:             4,
		TrabajadoresAFP:             6,
		Essalud:                     100,
		Onp:                         50,
		Afp:                         30,
		Sis:                         10,
		Rta4ta:                      5,
		Rta5ta:                      5,
		Rh:                          0,
		FechaEntrega:                "2026-06-10",
		NPS:                         "NPS-123",
		EstadoEnvioBoletas:          "Enviado",
		FechaEnvioNpsTicketsBoletas: "2026-06-12",
	}
	saved, err := svc.SavePdt601Planilla(co.ID, "2026-05", in)
	if err != nil {
		t.Fatalf("SavePdt601Planilla: %v", err)
	}
	if saved.Planilla == nil {
		t.Fatal("detalle sin planilla tras guardar")
	}
	if saved.Planilla.TrabajadoresTotal != 10 {
		t.Fatalf("trabajadores_total=%d want 10", saved.Planilla.TrabajadoresTotal)
	}
	if saved.Planilla.TotalAportes != 200 {
		t.Fatalf("total_aportes=%v want 200", saved.Planilla.TotalAportes)
	}
	if saved.Planilla.FechaEntrega == nil || *saved.Planilla.FechaEntrega != "2026-06-10" {
		t.Fatalf("fecha_entrega=%v want 2026-06-10", saved.Planilla.FechaEntrega)
	}

	// GET del detalle rehidrata la planilla guardada.
	got, err := svc.EnsurePdt601(co.ID, "2026-05")
	if err != nil {
		t.Fatalf("EnsurePdt601: %v", err)
	}
	if got.Planilla == nil || got.Planilla.NPS != "NPS-123" {
		t.Fatalf("planilla rehidratada inesperada: %+v", got.Planilla)
	}
	if got.Planilla.FechaEnvioNpsTicketsBoletas == nil || *got.Planilla.FechaEnvioNpsTicketsBoletas != "2026-06-12" {
		t.Fatalf("fecha_envio_nps_tickets_boletas=%v want 2026-06-12", got.Planilla.FechaEnvioNpsTicketsBoletas)
	}

	// El listado del período 2026-05 trae la planilla.
	list05, err := svc.ListPdt601(Pdt601ListParams{PeriodYM: "2026-05", Page: 1, PerPage: 20})
	if err != nil {
		t.Fatalf("ListPdt601 05: %v", err)
	}
	if len(list05.Rows) != 1 {
		t.Fatalf("filas 05=%d want 1", len(list05.Rows))
	}
	if list05.Rows[0].Planilla == nil || list05.Rows[0].Planilla.TrabajadoresTotal != 10 {
		t.Fatalf("planilla en listado 05 inesperada: %+v", list05.Rows[0].Planilla)
	}

	// Aislamiento por período: 2026-06 no tiene planilla.
	list06, err := svc.ListPdt601(Pdt601ListParams{PeriodYM: "2026-06", Page: 1, PerPage: 20})
	if err != nil {
		t.Fatalf("ListPdt601 06: %v", err)
	}
	if len(list06.Rows) != 1 {
		t.Fatalf("filas 06=%d want 1", len(list06.Rows))
	}
	if list06.Rows[0].Planilla != nil {
		t.Fatalf("06 no debería tener planilla: %+v", list06.Rows[0].Planilla)
	}

	// Re-guardar el mismo período actualiza (upsert), no duplica.
	in.TrabajadoresONP = 7
	if _, err := svc.SavePdt601Planilla(co.ID, "2026-05", in); err != nil {
		t.Fatalf("Save upsert: %v", err)
	}
	var count int64
	if err := db.Model(&models.SupervisorPdt601Planilla{}).Count(&count).Error; err != nil {
		t.Fatalf("count: %v", err)
	}
	if count != 1 {
		t.Fatalf("filas planilla=%d want 1 (upsert)", count)
	}
	again, err := svc.EnsurePdt601(co.ID, "2026-05")
	if err != nil {
		t.Fatalf("EnsurePdt601 tras upsert: %v", err)
	}
	if again.Planilla.TrabajadoresTotal != 13 {
		t.Fatalf("trabajadores_total tras upsert=%d want 13", again.Planilla.TrabajadoresTotal)
	}
}

// TestListPdt601FiltersByDigAndAssistant cubre los filtros de dígito de empresa y asistente.
func TestListPdt601FiltersByDigAndAssistant(t *testing.T) {
	db := setupPdt601TestDB(t)
	svc := NewSupervisorService()
	coA := seedEstudioCompany(t, db, "P005")
	coB := seedEstudioCompany(t, db, "P006")

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

	byAssistant, err := svc.ListPdt601(Pdt601ListParams{PeriodYM: "2026-07", AssistantUserID: assistantA, Page: 1, PerPage: 20})
	if err != nil {
		t.Fatalf("ListPdt601 by assistant: %v", err)
	}
	if len(byAssistant.Rows) != 1 || byAssistant.Rows[0].CompanyID != coA.ID {
		t.Fatalf("filtro asistente trajo filas inesperadas: %+v", byAssistant.Rows)
	}

	byDig, err := svc.ListPdt601(Pdt601ListParams{PeriodYM: "2026-07", Dig: "7", Page: 1, PerPage: 20})
	if err != nil {
		t.Fatalf("ListPdt601 by dig: %v", err)
	}
	if len(byDig.Rows) != 1 || byDig.Rows[0].CompanyID != coB.ID {
		t.Fatalf("filtro dig trajo filas inesperadas: %+v", byDig.Rows)
	}
}

// TestGetPdt601PlanillaOnlyNoLazyCreate cubre que la lectura pura no crea control/declaración
// cuando no existen, y que sí devuelve los datos cuando la planilla fue guardada antes.
func TestGetPdt601PlanillaOnlyNoLazyCreate(t *testing.T) {
	db := setupPdt601TestDB(t)
	svc := NewSupervisorService()
	co := seedEstudioCompany(t, db, "P004")

	if _, err := svc.CreatePeriod("2026-07", "test"); err != nil {
		t.Fatalf("CreatePeriod: %v", err)
	}

	// Sin control/planilla previos: no debe crear nada ni fallar.
	got, err := svc.GetPdt601PlanillaOnly(co.ID, "2026-07")
	if err != nil {
		t.Fatalf("GetPdt601PlanillaOnly (vacío): %v", err)
	}
	if got != nil {
		t.Fatalf("esperaba nil sin control/planilla, got=%+v", got)
	}
	var controlCount int64
	if err := db.Model(&models.SupervisorMonthlyControl{}).Count(&controlCount).Error; err != nil {
		t.Fatalf("count controls: %v", err)
	}
	if controlCount != 0 {
		t.Fatalf("GetPdt601PlanillaOnly no debería crear monthly_control, count=%d", controlCount)
	}

	// Tras guardar la planilla (vía el flujo normal, que sí crea control), la lectura pura la trae.
	if _, err := svc.SavePdt601Planilla(co.ID, "2026-07", Pdt601PlanillaInput{Afp: 250}); err != nil {
		t.Fatalf("SavePdt601Planilla: %v", err)
	}
	got2, err := svc.GetPdt601PlanillaOnly(co.ID, "2026-07")
	if err != nil {
		t.Fatalf("GetPdt601PlanillaOnly (con datos): %v", err)
	}
	if got2 == nil || got2.Afp != 250 {
		t.Fatalf("planilla leída inesperada: %+v", got2)
	}
}

// TestSavePdt601PlanillaSinPlanilla cubre marcar "sin planilla": persiste el flag, se refleja en
// el detalle y el listado, y el filtro sintético "sin_planilla" solo trae esas empresas.
func TestSavePdt601PlanillaSinPlanilla(t *testing.T) {
	db := setupPdt601TestDB(t)
	svc := NewSupervisorService()
	coA := seedEstudioCompany(t, db, "P002")
	coB := seedEstudioCompany(t, db, "P003")

	if _, err := svc.CreatePeriod("2026-07", "test"); err != nil {
		t.Fatalf("CreatePeriod: %v", err)
	}

	// Empresa A: sin planilla (marcada, sin importes).
	savedA, err := svc.SavePdt601Planilla(coA.ID, "2026-07", Pdt601PlanillaInput{SinPlanilla: true})
	if err != nil {
		t.Fatalf("SavePdt601Planilla A: %v", err)
	}
	if savedA.Planilla == nil || !savedA.Planilla.SinPlanilla {
		t.Fatalf("planilla A debería tener sin_planilla=true: %+v", savedA.Planilla)
	}
	if savedA.Planilla.TotalAportes != 0 {
		t.Fatalf("planilla A total_aportes=%v want 0", savedA.Planilla.TotalAportes)
	}

	// Empresa B: planilla normal con importes.
	if _, err := svc.SavePdt601Planilla(coB.ID, "2026-07", Pdt601PlanillaInput{Essalud: 100}); err != nil {
		t.Fatalf("SavePdt601Planilla B: %v", err)
	}

	// El filtro sintético "sin_planilla" solo trae la empresa A.
	filtered, err := svc.ListPdt601(Pdt601ListParams{PeriodYM: "2026-07", Status: "sin_planilla", Page: 1, PerPage: 20})
	if err != nil {
		t.Fatalf("ListPdt601 filtrado: %v", err)
	}
	if len(filtered.Rows) != 1 || filtered.Rows[0].CompanyID != coA.ID {
		t.Fatalf("filtro sin_planilla trajo filas inesperadas: %+v", filtered.Rows)
	}
	if filtered.Rows[0].IsOverdue {
		t.Fatalf("fila sin_planilla no debería marcarse vencida")
	}
}
