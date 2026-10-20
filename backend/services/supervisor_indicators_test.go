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
	a.addTimeliness("", TimelinessOnTime)  // sin dígito: se ignora
	a.addTimeliness("x", TimelinessOnTime)
	k := a.kpi("x", "X", 95)
	if k.Total.Total != 4 || k.Total.OnTime != 1 || k.Total.Late != 1 || k.Total.Missing != 1 || k.Total.Pending != 1 || k.Total.RatePct != 25 {
		t.Fatalf("total = %+v", k.Total)
	}
	if k.ByDigit[7].Total != 4 || k.ByDigit[0].Total != 0 {
		t.Fatalf("por dígito = %+v", k.ByDigit)
	}
}
