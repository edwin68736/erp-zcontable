package services

// Cubre el panel del asistente ("Mi panel"): lista de trabajo con estados, observaciones del
// supervisor y alcance limitado a las empresas del propio asistente.

import (
	"testing"
	"time"

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
	if len(mine.Modules) != 7 || len(mine.Trend) != 6 {
		t.Fatalf("módulos=%d tendencia=%d, want 7/6", len(mine.Modules), len(mine.Trend))
	}

	empty, err := svc.AssistantOverview(SupervisorDashboardParams{PeriodYM: "2026-07", AllowedCompanyIDs: []uint{}})
	if err != nil || empty.Companies != 0 || len(empty.Work) != 0 {
		t.Fatalf("sin empresas = %+v, err=%v", empty, err)
	}
}

// "Mi cumplimiento" y la tendencia usan el mismo conjunto de módulos que la lista de trabajo:
// Informe detracciones y Siscont entran al total (como exentos si no tienen regla de plazo).
func TestAssistantOverview_ComplianceCoversSameModulesAsWorkList(t *testing.T) {
	db := setupDashboardOverviewTestDB(t)
	svc := NewSupervisorService()

	sup := models.User{Name: "Claudia", Username: "claudia"}
	ana := models.User{Name: "Ana", Username: "ana"}
	for _, u := range []*models.User{&sup, &ana} {
		if err := db.Create(u).Error; err != nil {
			t.Fatalf("user: %v", err)
		}
	}
	co := models.Company{RUC: "20A0011", BusinessName: "Empresa A", InternalCode: "A001",
		ClientType: models.CompanyClientTypeEstudio, Status: "activo", SupervisorUserID: &sup.ID, AssistantUserID: &ana.ID}
	if err := db.Create(&co).Error; err != nil {
		t.Fatalf("company: %v", err)
	}
	if _, err := svc.CreatePeriod("2026-07", "test"); err != nil {
		t.Fatalf("CreatePeriod: %v", err)
	}
	p := SupervisorDashboardParams{PeriodYM: "2026-07", AllowedCompanyIDs: []uint{co.ID}}

	base, err := svc.MonthlyComplianceSummary(p)
	if err != nil {
		t.Fatalf("MonthlyComplianceSummary: %v", err)
	}
	got, err := svc.AssistantOverview(p)
	if err != nil {
		t.Fatalf("AssistantOverview: %v", err)
	}
	// Una empresa × 2 módulos de informe extra (sin regla de plazo → exento).
	if got.Compliance.Total != base.Total+2 {
		t.Fatalf("total cumplimiento = %d, want %d (base %d + Informe + Siscont)", got.Compliance.Total, base.Total+2, base.Total)
	}
	if got.Compliance.Exempt != base.Exempt+2 {
		t.Fatalf("exentos = %d, want %d", got.Compliance.Exempt, base.Exempt+2)
	}
	if got.Compliance.CompliancePct != base.CompliancePct {
		t.Fatalf("sin regla de plazo el %% no debe cambiar: %v vs %v", got.Compliance.CompliancePct, base.CompliancePct)
	}
	// Tendencia: el último mes es el del período y usa la misma base que el cumplimiento.
	last := got.Trend[len(got.Trend)-1]
	if last.PeriodYM != "2026-07" || last.TotalControls != got.Compliance.Total {
		t.Fatalf("tendencia final = %+v, want 2026-07 con total %d", last, got.Compliance.Total)
	}
	// Cada mes de la tendencia suma los mismos 2 módulos de informe (1 empresa).
	for _, pt := range got.Trend {
		if pt.TotalControls < 2 {
			t.Fatalf("mes %s sin los módulos de informe: %+v", pt.PeriodYM, pt)
		}
	}
}

// Preliminar de ventas entra al panel: una obligación por empresa y por entrega (2 al mes), solo si el
// calendario del período las define; lo enviado, lo suspendido y lo que no tiene calendario no pesa.
func TestAssistantOverview_PreliminarVentasWorkModuleAndCompliance(t *testing.T) {
	db := setupDashboardOverviewTestDB(t)
	svc := NewSupervisorService()

	sup := models.User{Name: "Claudia", Username: "claudia"}
	ana := models.User{Name: "Ana", Username: "ana"}
	for _, u := range []*models.User{&sup, &ana} {
		if err := db.Create(u).Error; err != nil {
			t.Fatalf("user: %v", err)
		}
	}
	mkCo := func(code string) models.Company {
		co := models.Company{RUC: "20" + code + "1", BusinessName: "Empresa " + code, InternalCode: code,
			ClientType: models.CompanyClientTypeEstudio, Status: "activo", SupervisorUserID: &sup.ID, AssistantUserID: &ana.ID}
		if err := db.Create(&co).Error; err != nil {
			t.Fatalf("company: %v", err)
		}
		return co
	}
	c1, c2, c3 := mkCo("P001"), mkCo("P002"), mkCo("P003")
	ids := []uint{c1.ID, c2.ID, c3.ID}
	if _, err := svc.CreatePeriod("2026-07", "test"); err != nil {
		t.Fatalf("CreatePeriod: %v", err)
	}
	p := SupervisorDashboardParams{PeriodYM: "2026-07", AllowedCompanyIDs: ids}

	// Sin calendario de Preliminar en el período: no aporta nada.
	none, err := svc.AssistantOverview(p)
	if err != nil {
		t.Fatalf("AssistantOverview: %v", err)
	}
	for _, w := range none.Work {
		if w.ModuleKey == models.SupervisorDeclPreliminarVentas {
			t.Fatalf("sin calendario no debe haber trabajo de preliminar: %+v", w)
		}
	}
	for _, m := range none.Modules {
		if m.Key == models.SupervisorDeclPreliminarVentas && m.Total != 0 {
			t.Fatalf("módulo preliminar sin calendario = %+v, want total 0", m)
		}
	}
	baseTotal := none.Compliance.Total

	// Calendario: entregas el 5 y el 20 de julio (ya vencidas hoy), con regla de plazo por fecha.
	rule := models.ActivityRule{Name: "Por fecha", CompareMode: models.ActivityRuleCompareDate, Active: true}
	if err := db.Create(&rule).Error; err != nil {
		t.Fatalf("rule: %v", err)
	}
	tmpl := models.ActivityTemplate{Code: "AC-PRELIM-TEST", Name: "PRELIMINAR DE VENTAS", ActivityType: models.CalendarActivityPreliminarVentas, ActivityRuleID: &rule.ID, Active: true}
	if err := db.Create(&tmpl).Error; err != nil {
		t.Fatalf("template: %v", err)
	}
	cal := models.FinanceCalendar{PeriodYM: "2026-07"}
	if err := db.Create(&cal).Error; err != nil {
		t.Fatalf("calendar: %v", err)
	}
	for _, d := range []int{5, 20} {
		act := models.FinanceCalendarActivity{CalendarID: cal.ID, ActivityTemplateID: tmpl.ID, NameSnapshot: tmpl.Name,
			ActivityTypeSnapshot: models.CalendarActivityPreliminarVentas, PrioritySnapshot: "media", TextColorSnapshot: "#000",
			StartDay: d, EndDay: d, DueDay: d, ActivityRuleID: &rule.ID}
		if err := db.Create(&act).Error; err != nil {
			t.Fatalf("activity: %v", err)
		}
	}

	// c1: entrega 1 enviada a tiempo (día 4); c2: entrega 1 solo registrada; c3: suspendida.
	mkCtrl := func(co models.Company, susp bool) models.SupervisorMonthlyControl {
		c := models.SupervisorMonthlyControl{CompanyID: co.ID, PeriodYM: "2026-07", Suspendida: susp}
		if err := db.Create(&c).Error; err != nil {
			t.Fatalf("control: %v", err)
		}
		return c
	}
	k1, k2, _ := mkCtrl(c1, false), mkCtrl(c2, false), mkCtrl(c3, true)
	sent := time.Date(2026, 7, 4, 10, 0, 0, 0, time.Local)
	for _, r := range []models.SupervisorPreliminarVentasRecord{
		{MonthlyControlID: k1.ID, SlotIndex: 1, Status: models.PreliminarVentasEnviado, SentAt: &sent, ReduccionIgvPct: 95},
		{MonthlyControlID: k2.ID, SlotIndex: 1, Status: models.PreliminarVentasRegistrado, ReduccionIgvPct: 95},
	} {
		r := r
		if err := db.Create(&r).Error; err != nil {
			t.Fatalf("record: %v", err)
		}
	}

	got, err := svc.AssistantOverview(p)
	if err != nil {
		t.Fatalf("AssistantOverview: %v", err)
	}
	var row *DashboardModuleRow
	for i := range got.Modules {
		if got.Modules[i].Key == models.SupervisorDeclPreliminarVentas {
			row = &got.Modules[i]
		}
	}
	// 3 empresas × 2 entregas = 6; la suspendida (2) queda fuera → 4: 1 a tiempo y 3 vencidas.
	if row == nil || row.Total != 4 || row.ATiempo != 1 || row.Vencido != 3 || row.Pendiente != 0 {
		t.Fatalf("módulo preliminar = %+v, want total 4, a tiempo 1, vencido 3", row)
	}
	type key struct {
		company uint
		slot    int
	}
	work := map[key]string{}
	for _, w := range got.Work {
		if w.ModuleKey == models.SupervisorDeclPreliminarVentas {
			work[key{w.CompanyID, w.Slot}] = w.State
		}
	}
	want := map[key]string{{c1.ID, 2}: "vencida", {c2.ID, 1}: "vencida", {c2.ID, 2}: "vencida"}
	if len(work) != len(want) {
		t.Fatalf("trabajo de preliminar = %v, want %v", work, want)
	}
	for k, st := range want {
		if work[k] != st {
			t.Fatalf("trabajo de preliminar = %v, want %v", work, want)
		}
	}
	// Cumplimiento: suma las 6 unidades (1 a tiempo, 3 vencidas, 2 exentas por suspensión).
	if got.Compliance.Total != baseTotal+6 || got.Compliance.OnTime < 1 {
		t.Fatalf("cumplimiento = %+v, want total %d con ≥1 a tiempo", got.Compliance, baseTotal+6)
	}
}

func TestPreliminarDateTimeliness_NoRule(t *testing.T) {
	due := time.Date(2026, 7, 14, 0, 0, 0, 0, time.Local)
	now := time.Date(2026, 7, 20, 9, 0, 0, 0, time.Local)
	early := time.Date(2026, 7, 14, 18, 0, 0, 0, time.Local)
	late := time.Date(2026, 7, 15, 8, 0, 0, 0, time.Local)
	cases := []struct {
		name string
		sent *time.Time
		now  time.Time
		want string
	}{
		{"enviado el mismo día", &early, now, TimelinessOnTime},
		{"enviado después", &late, now, TimelinessLate},
		{"sin enviar y vencido", nil, now, TimelinessMissing},
		{"sin enviar y aún en plazo", nil, time.Date(2026, 7, 14, 23, 0, 0, 0, time.Local), TimelinessPending},
	}
	for _, c := range cases {
		if got := preliminarDateTimeliness(due, c.sent, c.now); got.Timeliness != c.want || got.DueAt == nil {
			t.Errorf("%s: got %+v, want %s con fecha límite", c.name, got, c.want)
		}
	}
}
