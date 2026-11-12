package services

import (
	"testing"

	"miappfiber/models"
)

// El dashboard del supervisor sale de la misma lista de tareas que el panel del asistente: las filas del cuadro por módulo suman
// su total, el cumplimiento general es la suma de los módulos que cuentan, cada supervisor y asistente suman el general, los
// clientes externos no entran, y las cifras coinciden con las del panel del asistente.
func TestDashboardOverview_UnaSolaFuenteDeCifras(t *testing.T) {
	db := setupDashboardOverviewTestDB(t)
	svc := NewSupervisorService()

	mk := func(name string) models.User {
		u := models.User{Name: name, Username: name}
		if err := db.Create(&u).Error; err != nil {
			t.Fatalf("user %s: %v", name, err)
		}
		return u
	}
	sup1, sup2, ana, hugo := mk("Claudia"), mk("Rodrigo"), mk("Ana"), mk("Hugo")
	mkCo := func(code, clientType string, sup, as *models.User) models.Company {
		co := models.Company{RUC: "20" + code + "1", BusinessName: "Empresa " + code, InternalCode: code, ClientType: clientType, Status: "activo"}
		if sup != nil {
			co.SupervisorUserID = &sup.ID
		}
		if as != nil {
			co.AssistantUserID = &as.ID
		}
		if err := db.Create(&co).Error; err != nil {
			t.Fatalf("company %s: %v", code, err)
		}
		return co
	}
	c1 := mkCo("A001", models.CompanyClientTypeEstudio, &sup1, &ana)
	mkCo("A002", models.CompanyClientTypeEstudio, &sup1, &ana)
	c3 := mkCo("H001", models.CompanyClientTypeEstudio, &sup2, &hugo)
	mkCo("X001", models.CompanyClientTypeExterno, nil, nil) // cliente externo de POS: no es del estudio
	if _, err := svc.CreatePeriod("2026-07", "test"); err != nil {
		t.Fatalf("CreatePeriod: %v", err)
	}
	pdfReportSubmit(t, svc, PdfReportInformeDetracciones, c1.ID, "2026-07", "2026-07-02")
	d := pdfReportSubmit(t, svc, PdfReportSiscontBalances, c3.ID, "2026-07", "2026-07-02")
	if _, err := svc.ObserveDeclaration(d.Declaration.ID, sup2.ID, "Falta el anexo"); err != nil {
		t.Fatalf("ObserveDeclaration: %v", err)
	}

	p := SupervisorDashboardParams{PeriodYM: "2026-07"}
	ov, err := svc.DashboardOverview(p, true)
	if err != nil {
		t.Fatalf("DashboardOverview: %v", err)
	}
	if ov.Scope.Companies != 3 {
		t.Fatalf("empresas = %d, want 3 (el cliente externo no es del estudio)", ov.Scope.Companies)
	}
	if len(ov.Modules) == 0 {
		t.Fatal("el cuadro por módulo no puede venir vacío")
	}

	// 1) Cada fila suma su total, y solo las filas que cuentan entran en el cumplimiento general.
	var cOnTime, cLate, cMissing, cPending int64
	for _, m := range ov.Modules {
		if m.Pendiente+m.Observado+m.Vencido+m.ATiempo+m.FueraFecha != m.Total {
			t.Errorf("%s: pend %d + obs %d + venc %d + a tiempo %d + fuera %d no suma el total %d", m.Key, m.Pendiente, m.Observado, m.Vencido, m.ATiempo, m.FueraFecha, m.Total)
		}
		if m.SinCompleta != m.Total-m.ATiempo-m.FueraFecha {
			t.Errorf("%s: sin completar %d, want %d", m.Key, m.SinCompleta, m.Total-m.ATiempo-m.FueraFecha)
		}
		if m.Counts != complianceCountsModule(m.Key) {
			t.Errorf("%s: counts=%v no coincide con la regla del cumplimiento general", m.Key, m.Counts)
		}
		if m.Counts {
			cOnTime += m.ATiempo
			cLate += m.FueraFecha
			cMissing += m.Vencido
			cPending += m.Pendiente + m.Observado
		}
	}
	cs, err := svc.MonthlyComplianceSummary(p)
	if err != nil {
		t.Fatalf("MonthlyComplianceSummary: %v", err)
	}
	if cs.OnTime != cOnTime || cs.Late != cLate || cs.Missing != cMissing || cs.Pending != cPending {
		t.Errorf("el cumplimiento general %+v no es la suma de las filas que cuentan (a tiempo %d, fuera %d, vencido %d, pendiente %d)", cs, cOnTime, cLate, cMissing, cPending)
	}

	// 2) Los supervisores y los asistentes suman el general (cada empresa tiene uno de cada).
	var supTotal, assTotal ComplianceSummary
	for _, r := range ov.BySupervisor {
		supTotal.addSummary(r.Compliance)
	}
	for _, r := range ov.ByAssistant {
		assTotal.addSummary(r.Compliance)
	}
	if supTotal.Total != cs.Total || supTotal.OnTime != cs.OnTime || supTotal.Missing != cs.Missing {
		t.Errorf("los supervisores suman %+v, el general es %+v", supTotal, cs)
	}
	if assTotal.Total != cs.Total || assTotal.OnTime != cs.OnTime || assTotal.Missing != cs.Missing {
		t.Errorf("los asistentes suman %+v, el general es %+v", assTotal, cs)
	}

	// 3) Mismas cifras que el panel del asistente (vista del estudio) para cada módulo.
	as, err := svc.AssistantOverview(SupervisorDashboardParams{PeriodYM: "2026-07", IncludeSupervisorTasks: true})
	if err != nil {
		t.Fatalf("AssistantOverview: %v", err)
	}
	byKey := map[string]AssistantModuleProgress{}
	for _, m := range as.Modules {
		byKey[m.Key] = m
	}
	for _, m := range ov.Modules {
		a, ok := byKey[m.Key]
		if !ok {
			t.Errorf("%s no está en el panel del asistente", m.Key)
			continue
		}
		if a.Total != m.Total || a.OnTime != m.ATiempo || a.Late != m.FueraFecha || a.Overdue != m.Vencido {
			t.Errorf("%s: el dashboard (%d tareas, %d a tiempo, %d fuera, %d vencidas) no coincide con el panel del asistente (%d, %d, %d, %d)",
				m.Key, m.Total, m.ATiempo, m.FueraFecha, m.Vencido, a.Total, a.OnTime, a.Late, a.Overdue)
		}
	}

	// 4) Acotar a un supervisor da solo lo suyo.
	only, err := svc.MonthlyComplianceSummary(SupervisorDashboardParams{PeriodYM: "2026-07", SupervisorUserID: sup2.ID})
	if err != nil {
		t.Fatalf("MonthlyComplianceSummary (supervisor): %v", err)
	}
	if only.Total >= cs.Total || only.Total == 0 {
		t.Errorf("el supervisor 2 tiene 1 de 3 empresas: total %d, general %d", only.Total, cs.Total)
	}
}
