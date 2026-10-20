package services

// Cubre el dashboard rediseñado (propuesta B): alcance por rol, cola por revisar, resumen por módulo
// y cumplimiento por supervisor/asistente.

import (
	"testing"

	"miappfiber/config"
	"miappfiber/database"
	"miappfiber/models"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func setupDashboardOverviewTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("sqlite: %v", err)
	}
	if err := db.AutoMigrate(
		&models.Company{}, &models.User{}, &models.SupervisorPeriod{}, &models.SupervisorMonthlyControl{},
		&models.SupervisorDeclaration{}, &models.SupervisorPdt601Planilla{}, &models.SupervisorPdt621Record{},
		&models.SupervisorAttachment{}, &models.SupervisorChangeLog{}, &models.SupervisorObservation{},
		&models.CompanyAccessCredential{}, &models.ActivityRule{}, &models.ActivityTemplate{},
		&models.FinanceCalendar{}, &models.FinanceCalendarActivity{}, &models.SupervisorPreliminarVentasRecord{},
	); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	database.DB = db
	// El overview consulta en paralelo; una base ':memory:' abre una base distinta por conexión, así que se
	// fija una sola conexión para que todas las consultas vean las mismas tablas.
	if sqlDB, err := db.DB(); err == nil {
		sqlDB.SetMaxOpenConns(1)
	}
	config.AppConfig = &config.Config{StoragePath: t.TempDir()}
	return db
}

func TestDashboardOverview_ScopeReviewQueueAndEntities(t *testing.T) {
	db := setupDashboardOverviewTestDB(t)
	svc := NewSupervisorService()

	mk := func(name string) models.User {
		u := models.User{Name: name, Username: name}
		if err := db.Create(&u).Error; err != nil {
			t.Fatalf("user %s: %v", name, err)
		}
		return u
	}
	sup1, sup2, as1, as2 := mk("Claudia"), mk("Rodrigo"), mk("Ana"), mk("Hugo")
	mkCo := func(code string, sup, as *models.User) models.Company {
		co := models.Company{
			RUC: "20" + code + "1", BusinessName: "Empresa " + code, InternalCode: code,
			ClientType: models.CompanyClientTypeEstudio, Status: "activo",
		}
		if sup != nil {
			co.SupervisorUserID = &sup.ID
		}
		if as != nil {
			co.AssistantUserID = &as.ID
		}
		if err := db.Create(&co).Error; err != nil {
			t.Fatalf("company: %v", err)
		}
		return co
	}
	c1 := mkCo("D001", &sup1, &as1)
	c2 := mkCo("D002", &sup1, &as1)
	c3 := mkCo("D003", &sup2, &as2)
	_ = mkCo("D004", nil, nil) // sin supervisor
	if _, err := svc.CreatePeriod("2026-07", "test"); err != nil {
		t.Fatalf("CreatePeriod: %v", err)
	}

	// c1 entregó su informe: queda "por revisar".
	pdfReportSubmit(t, svc, PdfReportInformeDetracciones, c1.ID, "2026-07", "2026-07-02")

	studio, err := svc.DashboardOverview(SupervisorDashboardParams{PeriodYM: "2026-07"}, true)
	if err != nil {
		t.Fatalf("DashboardOverview (estudio): %v", err)
	}
	if studio.Scope.Companies != 4 || studio.Scope.Supervisors != 2 || studio.Scope.Assistants != 2 || studio.Scope.WithoutSupervisor != 1 {
		t.Fatalf("scope estudio = %+v", studio.Scope)
	}
	if studio.Review.Total != 1 || len(studio.Review.Items) != 1 || studio.Review.Items[0].ModuleKey != models.SupervisorDeclInformeDetracciones {
		t.Fatalf("cola por revisar = %+v", studio.Review)
	}
	if studio.Review.Items[0].Assistant != "Ana" {
		t.Fatalf("asistente de la entrega = %q, want Ana", studio.Review.Items[0].Assistant)
	}
	if len(studio.Modules) != 6 {
		t.Fatalf("módulos = %d, want 6", len(studio.Modules))
	}
	if len(studio.BySupervisor) != 2 || len(studio.ByAssistant) != 2 {
		t.Fatalf("por supervisor/asistente = %d/%d, want 2/2", len(studio.BySupervisor), len(studio.ByAssistant))
	}
	var claudiaReview int64
	for _, s := range studio.BySupervisor {
		if s.Name == "Claudia" {
			claudiaReview = s.Review
		}
	}
	if claudiaReview != 1 {
		t.Fatalf("por revisar de Claudia = %d, want 1", claudiaReview)
	}
	if len(studio.Trend) != 6 {
		t.Fatalf("tendencia = %d puntos, want 6", len(studio.Trend))
	}
	if len(studio.StudioTrend) != 0 {
		t.Fatal("el administrador no necesita la referencia del estudio aparte")
	}

	// Un supervisor solo ve su cartera (alcance = sus empresas) y recibe el promedio del estudio.
	mine, err := svc.DashboardOverview(SupervisorDashboardParams{PeriodYM: "2026-07", AllowedCompanyIDs: []uint{c1.ID, c2.ID}}, false)
	if err != nil {
		t.Fatalf("DashboardOverview (supervisor): %v", err)
	}
	if mine.Scope.Companies != 2 || len(mine.BySupervisor) != 1 || len(mine.ByAssistant) != 1 {
		t.Fatalf("alcance supervisor = %+v, por supervisor=%d, por asistente=%d", mine.Scope, len(mine.BySupervisor), len(mine.ByAssistant))
	}
	if len(mine.StudioTrend) != 6 {
		t.Fatalf("referencia del estudio = %d puntos, want 6", len(mine.StudioTrend))
	}
	// c3 (de otro supervisor) no debe aparecer en nada.
	for _, a := range mine.ByAssistant {
		if a.Name == "Hugo" {
			t.Fatal("un supervisor no debe ver asistentes de otra cartera")
		}
	}
	_ = c3

	empty, err := svc.DashboardOverview(SupervisorDashboardParams{PeriodYM: "2026-07", AllowedCompanyIDs: []uint{}}, false)
	if err != nil || empty.Scope.Companies != 0 || empty.Review.Total != 0 {
		t.Fatalf("sin empresas asignadas = %+v, err=%v", empty, err)
	}
}
