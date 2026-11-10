package services

import (
	"testing"

	"miappfiber/models"
)

// Vista del estudio del panel del asistente: todo el estudio por defecto, filtros por asistente y supervisor,
// opciones de los filtros calculadas sobre el estudio completo.
func TestStudioAssistantScope_FiltersAndOptions(t *testing.T) {
	db := setupDashboardOverviewTestDB(t)
	svc := NewSupervisorService()

	mkUser := func(name, username string) models.User {
		u := models.User{Name: name, Username: username}
		if err := db.Create(&u).Error; err != nil {
			t.Fatalf("user: %v", err)
		}
		return u
	}
	claudia, rosa := mkUser("Claudia", "claudia"), mkUser("Rosa", "rosa")
	ana, hugo := mkUser("Ana", "ana"), mkUser("Hugo", "hugo")

	mkCo := func(code string, as, sup *models.User, status string) models.Company {
		co := models.Company{RUC: "20" + code + "1", BusinessName: "Empresa " + code, InternalCode: code,
			ClientType: models.CompanyClientTypeEstudio, Status: status}
		if as != nil {
			co.AssistantUserID = &as.ID
		}
		if sup != nil {
			co.SupervisorUserID = &sup.ID
		}
		if err := db.Create(&co).Error; err != nil {
			t.Fatalf("company: %v", err)
		}
		return co
	}
	a1 := mkCo("A001", &ana, &claudia, "activo")
	a2 := mkCo("A002", &ana, &rosa, "activo")
	h1 := mkCo("H001", &hugo, &claudia, "activo")
	sin := mkCo("S001", nil, nil, "activo")
	mkCo("I001", &ana, &claudia, "inactivo") // no cuenta

	// Sin filtro: nil = todo el estudio, con las opciones completas.
	ids, info, assistantOf, err := svc.StudioAssistantScope(0, 0)
	if err != nil {
		t.Fatalf("StudioAssistantScope: %v", err)
	}
	if ids != nil {
		t.Fatalf("sin filtro ids = %v, want nil (todo el estudio)", ids)
	}
	if len(info.Assistants) != 2 || info.Assistants[0].Name != "Ana" || info.Assistants[0].Companies != 2 || info.Assistants[1].Name != "Hugo" {
		t.Fatalf("asistentes = %+v", info.Assistants)
	}
	if len(info.Supervisors) != 2 || info.Supervisors[0].Name != "Claudia" || info.Supervisors[0].Companies != 2 {
		t.Fatalf("supervisores = %+v (la empresa inactiva no cuenta)", info.Supervisors)
	}
	if info.WithoutAssistant != 1 || info.WithoutSupervisor != 1 {
		t.Fatalf("sin asignar = %d/%d, want 1/1", info.WithoutAssistant, info.WithoutSupervisor)
	}
	if assistantOf[a1.ID] != "Ana" || assistantOf[h1.ID] != "Hugo" || assistantOf[sin.ID] != "" {
		t.Fatalf("asistente por empresa = %+v", assistantOf)
	}

	has := func(list []uint, want ...uint) bool {
		if len(list) != len(want) {
			return false
		}
		seen := map[uint]bool{}
		for _, id := range list {
			seen[id] = true
		}
		for _, w := range want {
			if !seen[w] {
				return false
			}
		}
		return true
	}

	ids, info2, _, _ := svc.StudioAssistantScope(ana.ID, 0)
	if !has(ids, a1.ID, a2.ID) {
		t.Fatalf("filtro Ana = %v, want [A001 A002]", ids)
	}
	if len(info2.Assistants) != 2 {
		t.Fatalf("filtrar no debe reducir las opciones: %+v", info2.Assistants)
	}
	if ids, _, _, _ = svc.StudioAssistantScope(0, claudia.ID); !has(ids, a1.ID, h1.ID) {
		t.Fatalf("filtro Claudia = %v, want [A001 H001]", ids)
	}
	if ids, _, _, _ = svc.StudioAssistantScope(ana.ID, claudia.ID); !has(ids, a1.ID) {
		t.Fatalf("filtro Ana+Claudia = %v, want [A001]", ids)
	}
	// Combinación sin coincidencias: lista vacía y NO nil (nil significaría «todo»).
	ids, _, _, _ = svc.StudioAssistantScope(hugo.ID, rosa.ID)
	if ids == nil || len(ids) != 0 {
		t.Fatalf("Hugo+Rosa = %#v, want vacío no nil", ids)
	}
	empty, err := svc.AssistantOverview(SupervisorDashboardParams{PeriodYM: "2026-07", AllowedCompanyIDs: ids})
	if err != nil || empty.Companies != 0 {
		t.Fatalf("panel con filtro vacío = %+v, err=%v", empty, err)
	}

	// El panel del estudio sin filtro cubre todas las empresas activas.
	if _, err := svc.CreatePeriod("2026-07", "test"); err != nil {
		t.Fatalf("CreatePeriod: %v", err)
	}
	all, err := svc.AssistantOverview(SupervisorDashboardParams{PeriodYM: "2026-07"})
	if err != nil || all.Companies != 4 {
		t.Fatalf("panel del estudio = %+v, err=%v, want 4 empresas", all, err)
	}
}
