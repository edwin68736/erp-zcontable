package services

import (
	"testing"

	"miappfiber/models"
)

// Claves SOL lista solo empresas activas; con InactiveOnly (solo el administrador lo puede pedir) lista solo las
// inactivas. Las eliminadas no aparecen en ninguna de las dos vistas.
func TestCredentialList_ActiveInactiveAndDeleted(t *testing.T) {
	db := setupCompanyRucTestDB(t)
	if err := db.AutoMigrate(&models.CompanyAccessCredential{}); err != nil {
		t.Fatal(err)
	}
	mk := func(code, status string) models.Company {
		co := models.Company{RUC: "20" + code + "1", BusinessName: "Empresa " + code, InternalCode: code,
			ClientType: models.CompanyClientTypeEstudio, Status: status}
		if err := db.Create(&co).Error; err != nil {
			t.Fatal(err)
		}
		return co
	}
	act, ina, del := mk("K001", "activo"), mk("K002", "inactivo"), mk("K003", "inactivo")
	if err := db.Delete(&del).Error; err != nil {
		t.Fatal(err)
	}
	svc := NewCompanyAccessCredentialService()
	ids := func(inactive bool) []uint {
		res, err := svc.List(CompanyAccessCredentialListParams{PerPage: 50, InactiveOnly: inactive})
		if err != nil {
			t.Fatal(err)
		}
		out := []uint{}
		for _, r := range res.Rows {
			out = append(out, r.CompanyID)
		}
		return out
	}
	if got := ids(false); len(got) != 1 || got[0] != act.ID {
		t.Fatalf("activas = %v, want solo %d", got, act.ID)
	}
	if got := ids(true); len(got) != 1 || got[0] != ina.ID {
		t.Fatalf("inactivas = %v, want solo %d (la eliminada no cuenta)", got, ina.ID)
	}
	facets, err := svc.FilterFacets(nil, true)
	if err != nil || facets == nil {
		t.Fatalf("FilterFacets inactivas: %v", err)
	}
}
