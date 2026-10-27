package services

import (
	"testing"

	"miappfiber/models"
)

// Suspender desde cualquier módulo: la marca es global del control mensual (la leen todos los módulos), la
// empresa sigue activa y visible, y solo se puede suspender a empresas activas del estudio.
func TestSetCompanySuspendida_FromAnyModule(t *testing.T) {
	db := setupDashboardOverviewTestDB(t)
	if err := db.AutoMigrate(&models.SupervisorPreliminarVentasRecord{}); err != nil {
		t.Fatal(err)
	}
	svc := NewSupervisorService()
	mk := func(code, status string) models.Company {
		co := models.Company{RUC: "20" + code + "1", BusinessName: "Empresa " + code, InternalCode: code,
			ClientType: models.CompanyClientTypeEstudio, Status: status}
		if err := db.Create(&co).Error; err != nil {
			t.Fatal(err)
		}
		return co
	}
	active, inactive := mk("S001", "activo"), mk("S002", "inactivo")
	if _, err := svc.CreatePeriod("2026-07", "test"); err != nil {
		t.Fatal(err)
	}

	got, err := svc.SetCompanySuspendida(active.ID, "2026-07", true, 9)
	if err != nil || !got {
		t.Fatalf("suspender: %v / %v", err, got)
	}
	var ctrl models.SupervisorMonthlyControl
	if err := db.Where("company_id = ? AND period_ym = ?", active.ID, "2026-07").First(&ctrl).Error; err != nil || !ctrl.Suspendida {
		t.Fatalf("el control debe quedar suspendido (creado si no existía): %v %+v", err, ctrl)
	}
	// Los módulos la leen del mismo lugar: Preliminar la muestra suspendida y la empresa sigue en la lista.
	rows, _, err := svc.ListPreliminarVentas(PreliminarVentasListParams{PeriodYM: "2026-07", PerPage: 50})
	if err != nil || len(rows) != 1 || !rows[0].Suspendida {
		t.Fatalf("preliminar = %+v (err %v), want la empresa suspendida visible", rows, err)
	}
	// El cambio queda en el registro de cambios, con quién lo hizo.
	var log models.SupervisorChangeLog
	if err := db.Where("entity_type = ? AND entity_id = ? AND field_name = ?", "monthly_control", ctrl.ID, "suspendida").First(&log).Error; err != nil ||
		log.NewValue != "true" || log.OldValue != "false" || log.UserID != 9 {
		t.Fatalf("registro de cambios = %+v (err %v)", log, err)
	}

	// Reactivar (quitar la suspensión) y repetirlo no duplica el registro.
	if _, err := svc.SetCompanySuspendida(active.ID, "2026-07", false, 9); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SetCompanySuspendida(active.ID, "2026-07", false, 9); err != nil {
		t.Fatal(err)
	}
	db.First(&ctrl, ctrl.ID)
	if ctrl.Suspendida {
		t.Fatal("la suspensión debía quitarse")
	}
	var n int64
	db.Model(&models.SupervisorChangeLog{}).Where("entity_type = ? AND entity_id = ?", "monthly_control", ctrl.ID).Count(&n)
	if n != 2 {
		t.Fatalf("registros de cambio = %d, want 2 (suspender y reactivar; el repetido no cuenta)", n)
	}

	// Una empresa inactiva no se suspende, ni un período inexistente.
	if _, err := svc.SetCompanySuspendida(inactive.ID, "2026-07", true, 9); err == nil {
		t.Fatal("no se debe suspender una empresa inactiva")
	}
	if _, err := svc.SetCompanySuspendida(active.ID, "2025-01", true, 9); err == nil {
		t.Fatal("un período inexistente debe fallar")
	}
}
