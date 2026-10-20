package services

// Cubre el panel del asistente ("Mi panel"): lista de trabajo con estados, observaciones del
// supervisor y alcance limitado a las empresas del propio asistente.

import (
	"testing"

	"miappfiber/models"
)

func TestAssistantOverview_WorkListStatesAndScope(t *testing.T) {
	db := setupDashboardOverviewTestDB(t)
	svc := NewSupervisorService()

	sup := models.User{Name: "Claudia", Username: "claudia"}
	ana := models.User{Name: "Ana", Username: "ana"}
	hugo := models.User{Name: "Hugo", Username: "hugo"}
	for _, u := range []*models.User{&sup, &ana, &hugo} {
		if err := db.Create(u).Error; err != nil {
			t.Fatalf("user: %v", err)
		}
	}
	mkCo := func(code string, as *models.User) models.Company {
		co := models.Company{RUC: "20" + code + "1", BusinessName: "Empresa " + code, InternalCode: code,
			ClientType: models.CompanyClientTypeEstudio, Status: "activo", SupervisorUserID: &sup.ID, AssistantUserID: &as.ID}
		if err := db.Create(&co).Error; err != nil {
			t.Fatalf("company: %v", err)
		}
		return co
	}
	c1, c2, c3 := mkCo("A001", &ana), mkCo("A002", &ana), mkCo("A003", &ana)
	other := mkCo("H001", &hugo)
	if _, err := svc.CreatePeriod("2026-07", "test"); err != nil {
		t.Fatalf("CreatePeriod: %v", err)
	}

	pdfReportSubmit(t, svc, PdfReportInformeDetracciones, c1.ID, "2026-07", "2026-07-02") // por revisar
	d := pdfReportSubmit(t, svc, PdfReportSiscontBalances, c3.ID, "2026-07", "2026-07-02")
	if _, err := svc.ObserveDeclaration(d.Declaration.ID, sup.ID, "Falta el anexo 2"); err != nil { // observada
		t.Fatalf("ObserveDeclaration: %v", err)
	}
	_ = c2

	mine, err := svc.AssistantOverview(SupervisorDashboardParams{PeriodYM: "2026-07", AllowedCompanyIDs: []uint{c1.ID, c2.ID, c3.ID}})
	if err != nil {
		t.Fatalf("AssistantOverview: %v", err)
	}
	if mine.Companies != 3 {
		t.Fatalf("empresas = %d, want 3", mine.Companies)
	}
	if len(mine.Supervisors) != 1 || mine.Supervisors[0].UserID != sup.ID || mine.Supervisors[0].Name != "Claudia" || mine.Supervisors[0].Companies != 3 {
		t.Fatalf("supervisores = %+v, want [Claudia con 3 empresas]", mine.Supervisors)
	}
	if mine.Counts.Observed != 1 || mine.Counts.InReview != 1 {
		t.Fatalf("conteos = %+v, want 1 observada y 1 por revisar", mine.Counts)
	}
	var obs *AssistantWorkItem
	for i := range mine.Work {
		if mine.Work[i].State == "observada" {
			obs = &mine.Work[i]
		}
		if mine.Work[i].CompanyID == other.ID {
			t.Fatal("el panel no debe incluir empresas de otro asistente")
		}
	}
	if obs == nil || obs.ModuleKey != models.SupervisorDeclSiscontBalances || obs.Note != "Falta el anexo 2" || obs.NoteBy != "Claudia" {
		t.Fatalf("observación = %+v", obs)
	}
	// Orden de urgencia: ninguna "por_revisar" antes que una "observada".
	rank := map[string]int{"vencida": 0, "observada": 1, "pendiente": 2, "por_revisar": 3}
	for i := 1; i < len(mine.Work); i++ {
		if rank[mine.Work[i-1].State] > rank[mine.Work[i].State] {
			t.Fatalf("lista fuera de orden en %d: %s antes de %s", i, mine.Work[i-1].State, mine.Work[i].State)
		}
	}
	if len(mine.Modules) != 6 || len(mine.Trend) != 6 {
		t.Fatalf("módulos=%d tendencia=%d, want 6/6", len(mine.Modules), len(mine.Trend))
	}

	empty, err := svc.AssistantOverview(SupervisorDashboardParams{PeriodYM: "2026-07", AllowedCompanyIDs: []uint{}})
	if err != nil || empty.Companies != 0 || len(empty.Work) != 0 {
		t.Fatalf("sin empresas = %+v, err=%v", empty, err)
	}
}
