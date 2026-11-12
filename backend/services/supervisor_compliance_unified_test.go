package services

import (
	"testing"
	"time"

	"miappfiber/models"
)

// El dashboard del supervisor sale de la misma lista de tareas que el panel del asistente: las filas del cuadro por módulo suman
// su total, el cumplimiento tributario y el operativo son la suma de sus módulos, cada supervisor y asistente suman el general, los
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

	// 1) Cada fila suma su total; el grupo sale de la regla; solo lo «sin uso» queda fuera del cumplimiento.
	var tax, ops ComplianceSummary
	for _, m := range ov.Modules {
		if m.Pendiente+m.Observado+m.Vencido+m.ATiempo+m.FueraFecha != m.Total {
			t.Errorf("%s: pend %d + obs %d + venc %d + a tiempo %d + fuera %d no suma el total %d", m.Key, m.Pendiente, m.Observado, m.Vencido, m.ATiempo, m.FueraFecha, m.Total)
		}
		if m.SinCompleta != m.Total-m.ATiempo-m.FueraFecha {
			t.Errorf("%s: sin completar %d, want %d", m.Key, m.SinCompleta, m.Total-m.ATiempo-m.FueraFecha)
		}
		if m.Group != complianceGroup(m.Key) || m.Counts == m.Unused {
			t.Errorf("%s: grupo=%q counts=%v unused=%v no coincide con las reglas", m.Key, m.Group, m.Counts, m.Unused)
		}
		if m.Unused {
			continue
		}
		dst := &ops
		if m.Group == complianceGroupTax {
			dst = &tax
		}
		dst.OnTime += m.ATiempo
		dst.Late += m.FueraFecha
		dst.Missing += m.Vencido
		dst.Pending += m.Pendiente + m.Observado
	}
	both, err := svc.monthlyComplianceBoth(p)
	if err != nil {
		t.Fatalf("monthlyComplianceBoth: %v", err)
	}
	for name, pair := range map[string][2]ComplianceSummary{"tributario": {both.Tax, tax}, "operativo": {both.Ops, ops}} {
		got, want := pair[0], pair[1]
		if got.OnTime != want.OnTime || got.Late != want.Late || got.Missing != want.Missing || got.Pending != want.Pending {
			t.Errorf("cumplimiento %s %+v no es la suma de sus filas (a tiempo %d, fuera %d, vencido %d, pendiente %d)", name, got, want.OnTime, want.Late, want.Missing, want.Pending)
		}
	}
	if cs, _ := svc.MonthlyComplianceSummary(p); cs != both.Tax {
		t.Errorf("MonthlyComplianceSummary debe ser el tributario: %+v contra %+v", cs, both.Tax)
	}

	// 2) Los supervisores y los asistentes suman el general, en los dos indicadores.
	var supTax, supOps, assTax, assOps ComplianceSummary
	for _, r := range ov.BySupervisor {
		supTax.addSummary(r.Compliance)
		supOps.addSummary(r.Operational)
	}
	for _, r := range ov.ByAssistant {
		assTax.addSummary(r.Compliance)
		assOps.addSummary(r.Operational)
	}
	for name, got := range map[string][2]ComplianceSummary{"supervisores/tributario": {supTax, both.Tax}, "supervisores/operativo": {supOps, both.Ops}, "asistentes/tributario": {assTax, both.Tax}, "asistentes/operativo": {assOps, both.Ops}} {
		if got[0].Total != got[1].Total || got[0].OnTime != got[1].OnTime || got[0].Missing != got[1].Missing {
			t.Errorf("%s suman %+v, el general es %+v", name, got[0], got[1])
		}
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
		if a.Total != m.Total || a.OnTime != m.ATiempo || a.Late != m.FueraFecha || a.Overdue+a.ObservedOverdue != m.Vencido {
			t.Errorf("%s: el dashboard (%d tareas, %d a tiempo, %d fuera, %d vencidas) no coincide con el panel del asistente (%d, %d, %d, %d)",
				m.Key, m.Total, m.ATiempo, m.FueraFecha, m.Vencido, a.Total, a.OnTime, a.Late, a.Overdue+a.ObservedOverdue)
		}
	}

	// 4) Acotar a un supervisor da solo lo suyo.
	only, err := svc.MonthlyComplianceSummary(SupervisorDashboardParams{PeriodYM: "2026-07", SupervisorUserID: sup2.ID})
	if err != nil {
		t.Fatalf("MonthlyComplianceSummary (supervisor): %v", err)
	}
	if only.Total >= both.Tax.Total || only.Total == 0 {
		t.Errorf("el supervisor 2 tiene 1 de 3 empresas: total %d, general %d", only.Total, both.Tax.Total)
	}
}

// Una observada con el plazo ya vencido cuenta como VENCIDA en el cumplimiento (regla del estudio, §5.9.2b) y en el cuadro va en
// «Venc.», no en «Obs.»; una observada con el plazo vigente no se castiga (queda pendiente).
func TestCompliance_ObservadaConPlazoVencidoCuentaComoVencida(t *testing.T) {
	db := setupComplianceSummaryTestDB(t)
	svc := NewSupervisorService()

	periodYM := time.Now().AddDate(0, -2, 0).Format("2006-01") // su plazo (el mes siguiente) ya pasó
	if _, err := svc.CreatePeriod(periodYM, "test"); err != nil {
		t.Fatalf("CreatePeriod: %v", err)
	}
	seedPdt601CalendarRule(t, db, periodYM, 15, 0)
	co := seedEstudioCompany(t, db, "T030")
	saved, err := svc.SavePdt601Planilla(co.ID, periodYM, Pdt601PlanillaInput{RegimenLaboral: models.Pdt601RegimenGeneral, FechaEntrega: "2026-07-15"})
	if err != nil {
		t.Fatalf("SavePdt601Planilla: %v", err)
	}
	if _, err := svc.ObserveDeclaration(saved.Declaration.ID, 9, "Falta firmar"); err != nil {
		t.Fatalf("ObserveDeclaration: %v", err)
	}

	both, err := svc.monthlyComplianceBoth(SupervisorDashboardParams{PeriodYM: periodYM})
	if err != nil {
		t.Fatalf("monthlyComplianceBoth: %v", err)
	}
	var row *DashboardModuleRow
	for i := range both.Rows {
		if both.Rows[i].Key == models.SupervisorDeclPDT601 {
			row = &both.Rows[i]
		}
	}
	if row == nil || row.Vencido != 1 || row.Observado != 0 {
		t.Fatalf("PDT 601: una observada vencida debe ir en «Venc.» y no en «Obs.»: %+v", row)
	}
	if both.Tax.Missing < 1 {
		t.Errorf("la observada vencida debe contar como vencida en el cumplimiento: %+v", both.Tax)
	}
}

// Informe de detracciones y Siscont balances no cuentan mientras nadie los entregue («sin uso»); apenas hay una entrega, ese módulo
// pasa a contar en el indicador operativo.
func TestCompliance_ModulosSinUsoNoCuentan(t *testing.T) {
	db := setupDashboardOverviewTestDB(t)
	svc := NewSupervisorService()
	sup := models.User{Name: "Claudia", Username: "claudia"}
	ana := models.User{Name: "Ana", Username: "ana"}
	for _, u := range []*models.User{&sup, &ana} {
		if err := db.Create(u).Error; err != nil {
			t.Fatal(err)
		}
	}
	co := models.Company{RUC: "20A0011", BusinessName: "Empresa A", InternalCode: "A001", ClientType: models.CompanyClientTypeEstudio, Status: "activo", SupervisorUserID: &sup.ID, AssistantUserID: &ana.ID}
	if err := db.Create(&co).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := svc.CreatePeriod("2026-07", "test"); err != nil {
		t.Fatal(err)
	}
	p := SupervisorDashboardParams{PeriodYM: "2026-07"}
	find := func(rows []DashboardModuleRow, key string) *DashboardModuleRow {
		for i := range rows {
			if rows[i].Key == key {
				return &rows[i]
			}
		}
		return nil
	}

	both, err := svc.monthlyComplianceBoth(p)
	if err != nil {
		t.Fatal(err)
	}
	inf, sis := find(both.Rows, models.SupervisorDeclInformeDetracciones), find(both.Rows, models.SupervisorDeclSiscontBalances)
	if inf == nil || sis == nil || !inf.Unused || !sis.Unused || inf.Counts || sis.Counts {
		t.Fatalf("sin entregas, informe y balances deben salir «sin uso»: %+v %+v", inf, sis)
	}
	// El operativo solo trae lo que sí cuenta (aquí el archivador del PDT 621 de la única empresa): nada de informe ni balances.
	if both.Ops.Total != 1 {
		t.Errorf("lo «sin uso» no entra en el cumplimiento operativo: %+v", both.Ops)
	}

	pdfReportSubmit(t, svc, PdfReportInformeDetracciones, co.ID, "2026-07", "2026-07-02")
	both, err = svc.monthlyComplianceBoth(p)
	if err != nil {
		t.Fatal(err)
	}
	inf, sis = find(both.Rows, models.SupervisorDeclInformeDetracciones), find(both.Rows, models.SupervisorDeclSiscontBalances)
	if inf == nil || inf.Unused || !inf.Counts {
		t.Errorf("con una entrega, el informe pasa a contar: %+v", inf)
	}
	if sis == nil || !sis.Unused {
		t.Errorf("los balances siguen sin uso: %+v", sis)
	}
	if both.Ops.Total != 2 {
		t.Errorf("el informe ya entra en el cumplimiento operativo (archivador + informe): %+v", both.Ops)
	}
}

// Un mes sin ninguna entrega es «sin datos» en la tendencia (aunque tenga tareas vencidas): nadie usaba el sistema, no es un 0 % real.
func TestComplianceTrend_MesSinEntregasEsSinDatos(t *testing.T) {
	db := setupComplianceSummaryTestDB(t)
	svc := NewSupervisorService()
	periodYM := time.Now().AddDate(0, -2, 0).Format("2006-01")
	if _, err := svc.CreatePeriod(periodYM, "test"); err != nil {
		t.Fatalf("CreatePeriod: %v", err)
	}
	seedPdt601CalendarRule(t, db, periodYM, 15, 0)
	co := seedEstudioCompany(t, db, "T040")
	p := SupervisorDashboardParams{PeriodYM: periodYM}

	pts, err := svc.ComplianceTrend(p, 3)
	if err != nil || len(pts) != 3 {
		t.Fatalf("ComplianceTrend: %v %v", pts, err)
	}
	last := pts[len(pts)-1]
	if last.HasData || last.Missing == 0 {
		t.Fatalf("sin entregas pero con tareas vencidas debía ser «sin datos»: %+v", last)
	}

	saved, err := svc.SavePdt601Planilla(co.ID, periodYM, Pdt601PlanillaInput{RegimenLaboral: models.Pdt601RegimenGeneral, FechaEntrega: "2026-07-15"})
	if err != nil {
		t.Fatalf("SavePdt601Planilla: %v", err)
	}
	if _, err := svc.ApproveDeclaration(saved.Declaration.ID, 9); err != nil {
		t.Fatalf("ApproveDeclaration: %v", err)
	}
	pts, err = svc.ComplianceTrend(p, 3)
	if err != nil {
		t.Fatal(err)
	}
	if !pts[len(pts)-1].HasData {
		t.Errorf("con una entrega el mes ya tiene datos: %+v", pts[len(pts)-1])
	}
}
