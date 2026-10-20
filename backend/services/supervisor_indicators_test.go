package services

import (
	"testing"

	"miappfiber/models"
)

// Los indicadores de supervisión salen del alcance de cada supervisor: cada uno ve solo su cartera, el
// filtro por supervisor del administrador es equivalente, y las tasas se calculan por dígito de RUC.
func TestSupervisorIndicators_ScopePerSupervisorAndDigits(t *testing.T) {
	db := setupDashboardOverviewTestDB(t)
	svc := NewSupervisorService()

	mk := func(name string) models.User {
		u := models.User{Name: name, Username: name}
		if err := db.Create(&u).Error; err != nil {
			t.Fatalf("user: %v", err)
		}
		return u
	}
	sup1, sup2, ana := mk("Claudia"), mk("Rodrigo"), mk("Ana")
	mkCo := func(code, dig string, sup *models.User) models.Company {
		co := models.Company{RUC: "20" + code + "1", BusinessName: "Empresa " + code, InternalCode: code,
			ClientType: models.CompanyClientTypeEstudio, Status: "activo", SupervisorUserID: &sup.ID, AssistantUserID: &ana.ID}
		if err := db.Create(&co).Error; err != nil {
			t.Fatalf("company: %v", err)
		}
		if err := db.Create(&models.CompanyAccessCredential{CompanyID: co.ID, Dig: dig}).Error; err != nil {
			t.Fatalf("credential: %v", err)
		}
		return co
	}
	c1, c2, c3 := mkCo("A001", "3", &sup1), mkCo("A002", "3", &sup1), mkCo("B001", "5", &sup2)
	if _, err := svc.CreatePeriod("2026-07", "test"); err != nil {
		t.Fatalf("CreatePeriod: %v", err)
	}
	// Siscont: c1 revisado (entregado), c2 y c3 sin entregar.
	d := pdfReportSubmit(t, svc, PdfReportSiscontBalances, c1.ID, "2026-07", "2026-07-02")
	if _, err := svc.ApproveDeclaration(d.Declaration.ID, sup1.ID); err != nil {
		t.Fatalf("ApproveDeclaration: %v", err)
	}
	_ = c2

	get := func(p SupervisorDashboardParams) *SupervisorIndicators {
		t.Helper()
		out, err := svc.SupervisorIndicators(p)
		if err != nil {
			t.Fatalf("SupervisorIndicators: %v", err)
		}
		return out
	}
	kpi := func(in *SupervisorIndicators, key string) IndicatorKpi {
		t.Helper()
		for _, k := range in.Kpis {
			if k.Key == key {
				return k
			}
		}
		t.Fatalf("kpi %s no encontrado", key)
		return IndicatorKpi{}
	}

	// Supervisor 1 (alcance = sus dos empresas): balances 1 de 2, solo en el dígito 3.
	mine := get(SupervisorDashboardParams{PeriodYM: "2026-07", AllowedCompanyIDs: []uint{c1.ID, c2.ID}})
	if mine.Companies != 2 || len(mine.Supervisors) != 1 || mine.Supervisors[0].UserID != sup1.ID {
		t.Fatalf("alcance sup1 = %d empresas, supervisores %+v", mine.Companies, mine.Supervisors)
	}
	b := kpi(mine, "balances")
	if b.MetaPct != 100 || b.Total.Total != 2 || b.Total.OnTime != 1 || b.Total.Pending != 1 || b.Total.RatePct != 50 {
		t.Fatalf("balances sup1 = %+v", b.Total)
	}
	if len(b.ByDigit) != 10 || b.ByDigit[3].Total != 2 || b.ByDigit[3].OnTime != 1 || b.ByDigit[5].Total != 0 {
		t.Fatalf("balances por dígito = %+v", b.ByDigit)
	}

	// Supervisor 2: su propia empresa, sin mezclar la cartera del otro.
	other := get(SupervisorDashboardParams{PeriodYM: "2026-07", AllowedCompanyIDs: []uint{c3.ID}})
	ob := kpi(other, "balances")
	if other.Companies != 1 || ob.Total.Total != 1 || ob.Total.OnTime != 0 || ob.ByDigit[5].Total != 1 {
		t.Fatalf("balances sup2 = %+v (%d empresas)", ob, other.Companies)
	}

	// Administrador (alcance de estudio): suma todo; filtrar por supervisor equivale al alcance del supervisor.
	// Los controles del período se crean al registrar la entrega, así que se generan antes de filtrar.
	for _, co := range []models.Company{c2, c3} {
		ctl := models.SupervisorMonthlyControl{CompanyID: co.ID, PeriodYM: "2026-07", SupervisorUserID: co.SupervisorUserID}
		if err := db.Create(&ctl).Error; err != nil {
			t.Fatalf("control: %v", err)
		}
	}
	all := get(SupervisorDashboardParams{PeriodYM: "2026-07"})
	if all.Companies != 3 || kpi(all, "balances").Total.Total != 3 {
		t.Fatalf("estudio = %d empresas, balances %+v", all.Companies, kpi(all, "balances").Total)
	}
	filtered := get(SupervisorDashboardParams{PeriodYM: "2026-07", SupervisorUserID: sup1.ID})
	if filtered.Companies != 2 || kpi(filtered, "balances").Total.OnTime != 1 {
		t.Fatalf("filtro por supervisor = %d empresas, balances %+v", filtered.Companies, kpi(filtered, "balances").Total)
	}

	// Sin empresas en el alcance: estructura completa y vacía.
	empty := get(SupervisorDashboardParams{PeriodYM: "2026-07", AllowedCompanyIDs: []uint{}})
	if len(empty.Kpis) != 4 || empty.Companies != 0 || len(empty.Kpis[0].ByDigit) != 10 {
		t.Fatalf("vacío = %+v", empty)
	}
}

func TestIndicatorDigitAcc(t *testing.T) {
	a := newIndicatorDigitAcc()
	a.addTimeliness("7", TimelinessOnTime)
	a.addTimeliness(" 7 ", TimelinessLate)
	a.addTimeliness("7", TimelinessMissing)
	a.addTimeliness("7", TimelinessPending)
	a.addTimeliness("7", TimelinessExempt) // no cuenta
	a.addTimeliness("", TimelinessOnTime)  // sin dígito: cuenta en el total, no en las filas por dígito
	a.addTimeliness("x", TimelinessOnTime)
	k := a.kpi("x", "X", 95)
	if k.Total.Total != 6 || k.Total.OnTime != 3 || k.Total.Late != 1 || k.Total.Missing != 1 || k.Total.Pending != 1 || k.Total.RatePct != 50 || k.NoDigit != 2 {
		t.Fatalf("total = %+v", k.Total)
	}
	if k.ByDigit[7].Total != 4 || k.ByDigit[0].Total != 0 {
		t.Fatalf("por dígito = %+v", k.ByDigit)
	}
}

// Los indicadores se calculan fila por fila; los módulos del dashboard con una consulta agrupada. Ambos
// tienen que contar lo mismo: si no, el dashboard mostraría dos números distintos para lo mismo.
func TestSupervisorIndicators_ReconcileWithPdtModuleSummary(t *testing.T) {
	db := setupDashboardPuntualidadTestDB(t)
	// El agregado consulta en paralelo; una base ":memory:" abre una base distinta por conexión.
	if sqlDB, err := db.DB(); err == nil {
		sqlDB.SetMaxOpenConns(1)
	}
	svc := NewSupervisorService()
	periodYM := "2026-07"
	if _, err := svc.CreatePeriod(periodYM, "test"); err != nil {
		t.Fatalf("CreatePeriod: %v", err)
	}
	seedPdt601CalendarRule(t, db, periodYM, 15, 0)
	// Misma regla/calendario para PDT 621 (una sola fila de calendario por período).
	var cal models.FinanceCalendar
	if err := db.Where("period_ym = ?", periodYM).First(&cal).Error; err != nil {
		t.Fatalf("calendar: %v", err)
	}
	var rule models.ActivityRule
	if err := db.First(&rule).Error; err != nil {
		t.Fatalf("rule: %v", err)
	}
	tmpl := models.ActivityTemplate{Code: "AC-TEST-621B", Name: "PDT 621", ActivityType: models.CalendarActivityPDT621, ActivityRuleID: &rule.ID, Active: true}
	if err := db.Create(&tmpl).Error; err != nil {
		t.Fatalf("template: %v", err)
	}
	if err := db.Create(&models.FinanceCalendarActivity{CalendarID: cal.ID, ActivityTemplateID: tmpl.ID, NameSnapshot: "PDT 621",
		ActivityTypeSnapshot: models.CalendarActivityPDT621, PrioritySnapshot: "media", DueDay: 15, ActivityRuleID: &rule.ID}).Error; err != nil {
		t.Fatalf("activity: %v", err)
	}

	mk := func(code, dig string) models.Company {
		co := seedEstudioCompany(t, db, code)
		if err := db.Create(&models.CompanyAccessCredential{CompanyID: co.ID, Dig: dig}).Error; err != nil {
			t.Fatalf("credential: %v", err)
		}
		return co
	}
	onTime, late, none := mk("R001", "3"), mk("R002", "3"), mk("R003", "5")
	if d, err := svc.SavePdt601Planilla(onTime.ID, periodYM, Pdt601PlanillaInput{RegimenLaboral: models.Pdt601RegimenGeneral, FechaEntrega: "2026-07-10"}); err != nil {
		t.Fatalf("601 on time: %v", err)
	} else if _, err := svc.ApproveDeclaration(d.Declaration.ID, 9); err != nil {
		t.Fatalf("approve: %v", err)
	}
	if d, err := svc.SavePdt601Planilla(late.ID, periodYM, Pdt601PlanillaInput{RegimenLaboral: models.Pdt601RegimenGeneral, FechaEntrega: "2026-07-20"}); err != nil {
		t.Fatalf("601 late: %v", err)
	} else if _, err := svc.ApproveDeclaration(d.Declaration.ID, 9); err != nil {
		t.Fatalf("approve: %v", err)
	}
	d621 := map[string]uint{}
	for name, c := range map[string]struct {
		co    models.Company
		fecha string
	}{"onTime": {onTime, "2026-07-10"}, "late": {late, "2026-07-20"}} {
		d, err := svc.SavePdt621Record(c.co.ID, periodYM, Pdt621RecordInput{PrimeraEntregaFecha: c.fecha})
		if err != nil {
			t.Fatalf("621 %s: %v", name, err)
		}
		d621[name] = d.Declaration.ID
	}
	if _, err := svc.EnsurePdt601(none.ID, periodYM); err != nil {
		t.Fatalf("ensure 601: %v", err)
	}
	if _, err := svc.EnsurePdt621(none.ID, periodYM); err != nil {
		t.Fatalf("ensure 621: %v", err)
	}

	p := SupervisorDashboardParams{PeriodYM: periodYM}
	sum, err := svc.PdtDashboardSummary(p)
	if err != nil {
		t.Fatalf("PdtDashboardSummary: %v", err)
	}
	ind, err := svc.SupervisorIndicators(p)
	if err != nil {
		t.Fatalf("SupervisorIndicators: %v", err)
	}
	byKey := map[string]IndicatorDigit{}
	for _, k := range ind.Kpis {
		byKey[k.Key] = k.Total
	}
	check := func(name string, got IndicatorDigit, want PdtTypeSummary) {
		t.Helper()
		if got.OnTime != want.EntregadoATiempo || got.Late != want.EntregadoFueraDeFecha || got.Missing != want.Vencido || got.Pending != want.Pendiente {
			t.Errorf("%s: indicador a tiempo/tarde/vencido/pendiente = %d/%d/%d/%d; módulo = %d/%d/%d/%d", name,
				got.OnTime, got.Late, got.Missing, got.Pending,
				want.EntregadoATiempo, want.EntregadoFueraDeFecha, want.Vencido, want.Pendiente)
		}
		if got.Total != want.Total-want.SinPlanilla-want.Suspendida {
			t.Errorf("%s: total indicador %d, módulo %d (sin exentos)", name, got.Total, want.Total-want.SinPlanilla-want.Suspendida)
		}
	}
	check("planillas (PDT 601)", byKey["planillas"], sum[models.SupervisorDeclPDT601])

	// Diferencia a propósito: el KPI 3 mide la entrega del asistente (fecha de la 1.ª entrega contra el
	// plazo interno), igual que el libro de Excel; el módulo PDT 621 solo cuenta como entregado lo que el
	// supervisor ya aprobó. Antes de aprobar, el KPI ya cuenta 1 a tiempo y 1 tarde y el módulo los ve vencidos.
	if k3 := byKey["archivadores"]; k3.OnTime != 1 || k3.Late != 1 || k3.Missing != 1 {
		t.Fatalf("KPI 3 antes de aprobar = %+v, want 1 a tiempo, 1 tarde, 1 vencido", k3)
	}
	if m := sum[models.SupervisorDeclPDT621]; m.EntregadoATiempo != 0 || m.Vencido != 3 {
		t.Fatalf("módulo PDT 621 antes de aprobar = %+v, want 0 entregados y 3 vencidos", m)
	}
	// Ya aprobadas las entregas, indicador y módulo coinciden.
	for _, id := range d621 {
		if _, err := svc.ApproveDeclaration(id, 9); err != nil {
			t.Fatalf("approve 621: %v", err)
		}
	}
	sum, _ = svc.PdtDashboardSummary(p)
	ind, _ = svc.SupervisorIndicators(p)
	for _, k := range ind.Kpis {
		byKey[k.Key] = k.Total
	}
	check("archivadores (PDT 621) aprobados", byKey["archivadores"], sum[models.SupervisorDeclPDT621])
}
