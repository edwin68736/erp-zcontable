package services

import (
	"strings"
	"testing"

	"miappfiber/models"
)

func TestSetSireCredentials_soloEsosDosCamposYValida(t *testing.T) {
	db := setupCompanyRucTestDB(t)
	if err := db.AutoMigrate(&models.CompanyAccessCredential{}); err != nil {
		t.Fatal(err)
	}
	co := models.Company{RUC: "20111111111", BusinessName: "Empresa", Status: "activo", ClientType: models.CompanyClientTypeEstudio}
	other := models.Company{RUC: "20222222222", BusinessName: "Otra", Status: "activo", ClientType: models.CompanyClientTypeEstudio}
	db.Create(&co)
	db.Create(&other)
	svc := NewCompanyAccessCredentialService()

	// Sin fila previa: se crea solo con los dos campos.
	if err := svc.SetSireCredentials(co.ID, "  cid-1  ", " secreto-1 ", nil); err != nil {
		t.Fatalf("primera vez: %v", err)
	}
	var cred models.CompanyAccessCredential
	db.Where("company_id = ?", co.ID).First(&cred)
	if cred.SireClientID != "cid-1" || cred.SireClientSecret != "secreto-1" {
		t.Fatalf("guardado: %+v", cred)
	}

	// Con fila previa: no toca usuario/clave SOL ni el resto.
	db.Model(&cred).Updates(map[string]any{"sol_usuario": "USER", "sol_clave": "clave-sol", "afp_usuario": "afp"})
	if err := svc.SetSireCredentials(co.ID, "cid-2", "secreto-2", nil); err != nil {
		t.Fatalf("segunda vez: %v", err)
	}
	db.Where("company_id = ?", co.ID).First(&cred)
	if cred.SireClientID != "cid-2" || cred.SireClientSecret != "secreto-2" || cred.SolUsuario != "USER" || cred.SolClave != "clave-sol" || cred.AfpUsuario != "afp" {
		t.Fatalf("no debía tocar lo demás: %+v", cred)
	}

	// Validaciones y alcance.
	for _, c := range []struct{ id, secret, want string }{
		{"", "x", "Client ID"}, {"x", "  ", "Client Secret"},
		{strings.Repeat("a", 121), "x", "demasiado largo"}, {"x", strings.Repeat("a", 256), "demasiado largo"},
	} {
		if err := svc.SetSireCredentials(co.ID, c.id, c.secret, nil); err == nil || !strings.Contains(err.Error(), c.want) {
			t.Errorf("(%q,%q) debía fallar con %q: %v", c.id, c.secret, c.want, err)
		}
	}
	if err := svc.SetSireCredentials(other.ID, "a", "b", []uint{co.ID}); err == nil {
		t.Error("una empresa fuera del alcance del usuario no se puede editar")
	}
	if err := svc.SetSireCredentials(9999, "a", "b", nil); err == nil {
		t.Error("empresa inexistente")
	}
}
