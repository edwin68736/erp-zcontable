package services

import (
	"testing"

	"miappfiber/models"
)

// El dashboard del supervisor usa las mismas tareas que el panel del asistente, siempre con la declaración del PDT 621 incluida, y
// suma por asistente, las empresas suspendidas del periodo y la tendencia.
func TestDashboardProgress_AvanceComoElAsistenteConSuspendidasYPorAsistente(t *testing.T) {
	db := setupDashboardOverviewTestDB(t)
	svc := NewSupervisorService()

	sup := models.User{Name: "Claudia", Username: "claudia"}
	ana := models.User{Name: "Ana", Username: "ana"}
	luis := models.User{Name: "Luis", Username: "luis"}
	for _, u := range []*models.User{&sup, &ana, &luis} {
		if err := db.Create(u).Error; err != nil {
			t.Fatalf("user: %v", err)
		}
	}
	mkCo := func(ruc, code string, as *models.User) models.Company {
		co := models.Company{RUC: ruc, BusinessName: "Empresa " + code, InternalCode: code, ClientType: models.CompanyClientTypeEstudio, Status: "activo", SupervisorUserID: &sup.ID, AssistantUserID: &as.ID}
		if err := db.Create(&co).Error; err != nil {
			t.Fatalf("company: %v", err)
		}
		return co
	}
	a := mkCo("20100000013", "A1", &ana)
	b := mkCo("20100000021", "A2", &ana)
	c := mkCo("20100000047", "L1", &luis)
	if _, err := svc.CreatePeriod("2026-07", "test"); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SavePdt621Record(a.ID, "2026-07", Pdt621RecordInput{FechaDeclaracion: "2026-07-20"}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SetCompanySuspendida(c.ID, "2026-07", true, sup.ID); err != nil {
		t.Fatal(err)
	}

	got, err := svc.DashboardProgress(SupervisorDashboardParams{PeriodYM: "2026-07", AllowedCompanyIDs: []uint{a.ID, b.ID, c.ID}})
	if err != nil {
		t.Fatalf("DashboardProgress: %v", err)
	}
	if got.Companies != 3 || len(got.Trend) != 6 {
		t.Fatalf("empresas=%d tendencia=%d, quería 3 y 6", got.Companies, len(got.Trend))
	}
	// Entra la declaración del PDT 621 aunque quien llama no lo pida (es del supervisor).
	var decl, plan *AssistantModuleProgress
	for i := range got.Modules {
		switch got.Modules[i].Key {
		case pdt621DeclarationKey:
			decl = &got.Modules[i]
		case models.SupervisorDeclPDT601:
			plan = &got.Modules[i]
		}
	}
	if decl == nil || plan == nil {
		t.Fatalf("faltan módulos: %+v", got.Modules)
	}
	// La empresa suspendida no aplica: la declaración mide 2 empresas (A y B) y 1 está hecha.
	if decl.Total != 2 || decl.Completed != 1 || decl.NotApplicable != 1 {
		t.Errorf("declaración: total=%d completadas=%d no aplican=%d, quería 2/1/1", decl.Total, decl.Completed, decl.NotApplicable)
	}
	// El avance general es el de las tareas (suma de módulos) y su último punto de tendencia es el mismo.
	if got.Progress.Total == 0 || got.Trend[5].Pct != got.Progress.Pct || got.Trend[5].Total != got.Progress.Total {
		t.Errorf("progreso %+v vs tendencia %+v", got.Progress, got.Trend[5])
	}

	// Suspendidas del periodo, con su asistente.
	if len(got.Suspended) != 1 || got.Suspended[0].CompanyID != c.ID || got.Suspended[0].Assistant != "Luis" {
		t.Fatalf("suspendidas: %+v", got.Suspended)
	}

	// Por asistente: Ana (2 empresas) y Luis (1 suspendida: nada aplica). La suma de tareas por asistente es la del total.
	by := map[string]DashboardAssistantProgress{}
	var sum int64
	for _, r := range got.ByAssistant {
		by[r.Name] = r
		sum += r.Total
	}
	if by["Ana"].Companies != 2 || by["Ana"].SupervisorName != "Claudia" || by["Ana"].Completed < 1 {
		t.Errorf("Ana: %+v", by["Ana"])
	}
	if by["Luis"].Companies != 1 || by["Luis"].Total != 0 || by["Luis"].NotApplicable == 0 {
		t.Errorf("Luis: %+v", by["Luis"])
	}
	if sum != got.Progress.Total {
		t.Errorf("tareas por asistente suman %d, el total es %d", sum, got.Progress.Total)
	}

	// Sin empresas en el alcance: respuesta vacía pero completa.
	empty, err := svc.DashboardProgress(SupervisorDashboardParams{PeriodYM: "2026-07", AllowedCompanyIDs: []uint{}})
	if err != nil || empty.Companies != 0 || empty.Modules == nil || empty.Suspended == nil {
		t.Fatalf("vacío: %+v err=%v", empty, err)
	}
	if _, err := svc.DashboardProgress(SupervisorDashboardParams{PeriodYM: "2026/07"}); err == nil {
		t.Error("un periodo inválido debía fallar")
	}
}

// El supervisor ve solo su cartera pero puede filtrar por cada uno de sus asistentes: las opciones salen de SUS empresas y el filtro no
// deja pasar empresas ajenas.
func TestAssistantScopeWithin_SupervisorFiltraPorSusAsistentes(t *testing.T) {
	db := setupDashboardOverviewTestDB(t)
	svc := NewSupervisorService()
	mk := func(name string) models.User {
		u := models.User{Name: name, Username: name}
		if err := db.Create(&u).Error; err != nil {
			t.Fatal(err)
		}
		return u
	}
	sup, otra, ana, luis, eva := mk("Claudia"), mk("Rosa"), mk("Ana"), mk("Luis"), mk("Eva")
	add := func(code string, s, a *models.User) uint {
		co := models.Company{RUC: "20" + code + "1", BusinessName: "E" + code, InternalCode: code, ClientType: models.CompanyClientTypeEstudio, Status: "activo", SupervisorUserID: &s.ID, AssistantUserID: &a.ID}
		if err := db.Create(&co).Error; err != nil {
			t.Fatal(err)
		}
		return co.ID
	}
	a1, a2, l1 := add("A1", &sup, &ana), add("A2", &sup, &ana), add("L1", &sup, &luis)
	e1 := add("E1", &otra, &eva) // de otra supervisora: no es de su cartera
	mine := []uint{a1, a2, l1}

	ids, info, _, err := svc.AssistantScopeWithin(0, 0, mine)
	if err != nil || ids != nil {
		t.Fatalf("sin filtro devuelve nil para usar toda la cartera: ids=%v err=%v", ids, err)
	}
	names := map[string]int{}
	for _, a := range info.Assistants {
		names[a.Name] = a.Companies
	}
	if len(names) != 2 || names["Ana"] != 2 || names["Luis"] != 1 {
		t.Fatalf("asistentes de su cartera: %+v (Eva no debe aparecer)", info.Assistants)
	}
	ids, _, _, _ = svc.AssistantScopeWithin(ana.ID, 0, mine)
	if len(ids) != 2 {
		t.Fatalf("filtro por Ana: %v", ids)
	}
	// Un asistente ajeno a su cartera no da empresas (ni se cuela e1).
	ids, _, _, _ = svc.AssistantScopeWithin(eva.ID, 0, mine)
	if len(ids) != 0 || ids == nil {
		t.Fatalf("Eva no es de su cartera: %v", ids)
	}
	_ = e1
	if ids, info, _, _ = svc.AssistantScopeWithin(0, 0, []uint{}); ids != nil || len(info.Assistants) != 0 {
		t.Fatalf("sin empresas no hay opciones: %+v", info)
	}
}
