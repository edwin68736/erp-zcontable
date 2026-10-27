package services

import (
	"errors"
	"testing"
	"time"

	"miappfiber/models"

	"gorm.io/gorm"
)

// setupCompanyRucTestDB base con las tablas que leen el alta, el listado y la reactivación de empresas.
func setupCompanyRucTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db := setupCompanyListBalanceTestDB(t)
	if err := db.AutoMigrate(&models.Contact{}, &models.User{}, &models.SubscriptionPlan{}, &models.PlanCategory{}, &models.PlanTier{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return db
}

func rucTestCompany(ruc, code string) *models.Company {
	return baseValidCompany(ruc, code, time.Date(2026, 3, 15, 0, 0, 0, 0, time.UTC))
}

func TestCreateCompany_RucConflictByState(t *testing.T) {
	db := setupCompanyRucTestDB(t)
	svc := NewCompanyService()

	// activa, inactiva y eliminada, cada una con su RUC.
	act, ina, del := rucTestCompany("20111111111", "A1"), rucTestCompany("20222222222", "I1"), rucTestCompany("20333333333", "E1")
	for _, c := range []*models.Company{act, ina, del} {
		if err := svc.Create(c); err != nil {
			t.Fatalf("create: %v", err)
		}
	}
	if err := svc.SetStatus(ina.ID, "inactivo", ""); err != nil {
		t.Fatalf("SetStatus: %v", err)
	}
	if err := db.Delete(del).Error; err != nil { // soft delete; queda con status activo, como en producción
		t.Fatalf("delete: %v", err)
	}

	cases := []struct {
		ruc, kind string
		reactiv   bool
	}{
		{"20111111111", RucConflictActiva, false},
		{"20222222222", RucConflictInactiva, true},
		{"20333333333", RucConflictEliminada, true},
	}
	for _, c := range cases {
		err := svc.Create(rucTestCompany(c.ruc, "N-"+c.kind))
		var rc *ErrCompanyRucConflict
		if !errors.As(err, &rc) || rc.Conflict.Kind != c.kind || rc.Conflict.Reactivable != c.reactiv {
			t.Fatalf("RUC %s: err = %v, want conflicto %s (reactivable=%v)", c.ruc, err, c.kind, c.reactiv)
		}
	}
	// Un RUC libre se crea normal.
	if err := svc.Create(rucTestCompany("20444444444", "L1")); err != nil {
		t.Fatalf("RUC libre: %v", err)
	}
	// Cambiar el RUC de una empresa por uno ya usado también se bloquea.
	free := rucTestCompany("20555555555", "L2")
	if err := svc.Create(free); err != nil {
		t.Fatal(err)
	}
	var upd models.Company
	upd.RUC = "20111111111"
	if err := svc.Update(free.ID, &upd); err == nil {
		t.Fatal("actualizar al RUC de otra empresa debería fallar")
	}
}

func TestReactivateCompany_DeletedAndInactive(t *testing.T) {
	db := setupCompanyRucTestDB(t)
	svc := NewCompanyService()

	old := rucTestCompany("20666666666", "0421")
	if err := svc.Create(old); err != nil {
		t.Fatal(err)
	}
	if err := db.Delete(old).Error; err != nil {
		t.Fatal(err)
	}
	// Otra empresa activa toma el código mientras estaba eliminada.
	if err := svc.Create(rucTestCompany("20777777777", "0421")); err != nil {
		t.Fatal(err)
	}

	// Sin código nuevo no se puede: el anterior ya lo usa una activa.
	if _, err := svc.ReactivateCompany(old.ID, &models.Company{BusinessName: "Razón nueva SAC"}); err == nil {
		t.Fatal("reactivar con el código ocupado debería pedir uno nuevo")
	} else {
		var cc *ErrCompanyCodeConflict
		if !errors.As(err, &cc) {
			t.Fatalf("error = %v, want ErrCompanyCodeConflict", err)
		}
	}
	got, err := svc.ReactivateCompany(old.ID, &models.Company{BusinessName: "Razón nueva SAC", InternalCode: "0999"})
	if err != nil {
		t.Fatalf("ReactivateCompany: %v", err)
	}
	if got.ID != old.ID || got.DeletedAt.Valid || got.Status != "activo" || got.InternalCode != "0999" || got.BusinessName != "Razón nueva SAC" {
		t.Fatalf("reactivada = %+v", got)
	}
	// Ya está activa: no hay nada que reactivar.
	if _, err := svc.ReactivateCompany(old.ID, &models.Company{}); err == nil {
		t.Fatal("reactivar una empresa activa debería fallar")
	}

	// Inactiva (sin eliminar) también se reactiva conservando su código si sigue libre.
	ina := rucTestCompany("20888888888", "I77")
	if err := svc.Create(ina); err != nil {
		t.Fatal(err)
	}
	if err := svc.SetStatus(ina.ID, "inactivo", ""); err != nil {
		t.Fatal(err)
	}
	back, err := svc.ReactivateCompany(ina.ID, &models.Company{})
	if err != nil || back.Status != "activo" || back.InternalCode != "I77" {
		t.Fatalf("reactivar inactiva: %v / %+v", err, back)
	}
}

func TestListCompanies_StatusAndDeleted(t *testing.T) {
	db := setupCompanyRucTestDB(t)
	svc := NewCompanyService()
	a, i, d := rucTestCompany("20100000001", "L1"), rucTestCompany("20100000002", "L2"), rucTestCompany("20100000003", "L3")
	for _, c := range []*models.Company{a, i, d} {
		if err := svc.Create(c); err != nil {
			t.Fatal(err)
		}
	}
	if err := svc.SetStatus(i.ID, "inactivo", ""); err != nil {
		t.Fatal(err)
	}
	if err := db.Delete(d).Error; err != nil {
		t.Fatal(err)
	}
	ids := func(status string) []uint {
		list, err := svc.List(CompanyListParams{Status: status, ClientType: models.CompanyClientTypeEstudio})
		if err != nil {
			t.Fatal(err)
		}
		out := []uint{}
		for _, it := range list {
			out = append(out, it.ID)
		}
		return out
	}
	if got := ids("activo"); len(got) != 1 || got[0] != a.ID {
		t.Fatalf("activas = %v, want solo %d", got, a.ID)
	}
	if got := ids("inactivo"); len(got) != 1 || got[0] != i.ID {
		t.Fatalf("inactivas = %v, want solo %d", got, i.ID)
	}
	// Eliminada: no aparece ni siquiera sin filtro de estado.
	for _, id := range ids("") {
		if id == d.ID {
			t.Fatal("una empresa eliminada no debe listarse nunca")
		}
	}
}
