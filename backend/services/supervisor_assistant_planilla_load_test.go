package services

import (
	"testing"

	"miappfiber/models"
)

// La carga de planillas por asistente suma los trabajadores (ONP + AFP) de las empresas de cada uno; si la planilla del mes aún
// no se registró usa la última que tenga trabajadores y la marca como estimada; las empresas «sin planilla» o suspendidas no cuentan.
func TestAssistantOverview_CargaDePlanillasPorAsistente(t *testing.T) {
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
	mk := func(code string, as *models.User) models.Company {
		co := models.Company{RUC: "20" + code + "1", BusinessName: "Empresa " + code, InternalCode: code,
			ClientType: models.CompanyClientTypeEstudio, Status: "activo", SupervisorUserID: &sup.ID}
		if as != nil {
			co.AssistantUserID = &as.ID
		}
		if err := db.Create(&co).Error; err != nil {
			t.Fatalf("company: %v", err)
		}
		return co
	}
	a1, a2, a3 := mk("A001", &ana), mk("A002", &ana), mk("A003", &ana) // A3: sin planilla este mes pero con datos de junio
	h1, h2 := mk("H001", &hugo), mk("H002", &hugo)                     // H2: sin planilla (no aplica)
	n1 := mk("N001", nil)                                              // sin asistente, sin ningún dato
	for _, p := range []string{"2026-06", "2026-07"} {
		if _, err := svc.CreatePeriod(p, "test"); err != nil {
			t.Fatalf("CreatePeriod %s: %v", p, err)
		}
	}
	save := func(co models.Company, period string, in Pdt601PlanillaInput) {
		t.Helper()
		in.RegimenLaboral = models.Pdt601RegimenGeneral
		if _, err := svc.SavePdt601Planilla(co.ID, period, in); err != nil {
			t.Fatalf("SavePdt601Planilla %s %s: %v", co.InternalCode, period, err)
		}
	}
	save(a1, "2026-07", Pdt601PlanillaInput{TrabajadoresONP: 5, TrabajadoresAFP: 3})
	save(a2, "2026-07", Pdt601PlanillaInput{TrabajadoresONP: 2})
	save(a3, "2026-06", Pdt601PlanillaInput{TrabajadoresONP: 7, TrabajadoresAFP: 3}) // mes anterior: estimado
	save(h1, "2026-07", Pdt601PlanillaInput{TrabajadoresONP: 40, TrabajadoresAFP: 12})
	save(h2, "2026-07", Pdt601PlanillaInput{SinPlanilla: true})

	got, err := svc.AssistantOverview(SupervisorDashboardParams{PeriodYM: "2026-07", AllowedCompanyIDs: []uint{a1.ID, a2.ID, a3.ID, h1.ID, h2.ID, n1.ID}})
	if err != nil {
		t.Fatalf("AssistantOverview: %v", err)
	}
	var mod *AssistantModuleProgress
	for i := range got.Modules {
		if got.Modules[i].Key == models.SupervisorDeclPDT601 {
			mod = &got.Modules[i]
		}
	}
	if mod == nil || mod.Planilla == nil {
		t.Fatalf("PDT 601 debe traer la carga de planillas: %+v", mod)
	}
	pl := mod.Planilla
	// Hugo: 52 trabajadores (solo H1; H2 no aplica). Ana: 8 + 2 + 10 estimados = 20. Sin asistente: la empresa sin datos.
	if len(pl.ByAssistant) != 3 {
		t.Fatalf("asistentes = %d, want 3: %+v", len(pl.ByAssistant), pl.ByAssistant)
	}
	first, second, third := pl.ByAssistant[0], pl.ByAssistant[1], pl.ByAssistant[2]
	if first.Name != "Hugo" || first.Workers != 52 || first.WorkersONP != 40 || first.WorkersAFP != 12 || first.Companies != 1 || first.Estimated != 0 {
		t.Errorf("1.º (mayor carga) = %+v, want Hugo con 52 trabajadores en 1 empresa", first)
	}
	if second.Name != "Ana" || second.Workers != 20 || second.Companies != 3 || second.Estimated != 1 || second.NoData != 0 {
		t.Errorf("2.º = %+v, want Ana con 20 trabajadores en 3 empresas (1 estimada)", second)
	}
	if third.AssistantID != 0 || third.Name != "Sin asistente asignado" || third.Workers != 0 || third.NoData != 1 || third.Companies != 1 {
		t.Errorf("3.º = %+v, want «Sin asistente asignado» con 1 empresa sin datos", third)
	}
	if pl.Workers != 72 || pl.WorkersONP+pl.WorkersAFP != 72 || pl.Companies != 5 || pl.Estimated != 1 || pl.NoData != 1 {
		t.Errorf("totales = %+v, want 72 trabajadores en 5 empresas (1 estimada, 1 sin datos)", pl)
	}
	// Las tareas de PDT 601 se reparten igual que las empresas que aplican.
	if second.Total != 3 || first.Total != 1 {
		t.Errorf("tareas: Ana=%d Hugo=%d, want 3 y 1", second.Total, first.Total)
	}
	// Los otros módulos no traen esta carga.
	for _, m := range got.Modules {
		if m.Key != models.SupervisorDeclPDT601 && m.Planilla != nil {
			t.Errorf("%s no debe traer la carga de planillas", m.Key)
		}
	}
}
