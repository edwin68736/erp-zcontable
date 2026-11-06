package services

import (
	"bytes"
	"strings"
	"testing"

	"miappfiber/models"

	"github.com/xuri/excelize/v2"
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

// Importar el Excel de Claves SOL no debe borrar el Client ID/Secret de SIRE (la plantilla no los trae).
func TestImportClavesSol_conservaCredencialesSire(t *testing.T) {
	db := setupCompanyRucTestDB(t)
	if err := db.AutoMigrate(&models.CompanyAccessCredential{}); err != nil {
		t.Fatal(err)
	}
	co := models.Company{RUC: "20111111111", BusinessName: "Empresa", Status: "activo", ClientType: models.CompanyClientTypeEstudio}
	db.Create(&co)
	db.Create(&models.CompanyAccessCredential{CompanyID: co.ID, SireClientID: "cid", SireClientSecret: "secreto", SolUsuario: "VIEJO"})

	f := excelize.NewFile()
	_ = f.SetSheetName("Sheet1", credImportSheetMain)
	for i, h := range []string{"ruc", "sol_usuario", "sol_clave"} {
		cell, _ := excelize.CoordinatesToCellName(i+1, 1)
		_ = f.SetCellStr(credImportSheetMain, cell, h)
	}
	for i, v := range []string{"20111111111", "NUEVO", "clave"} {
		cell, _ := excelize.CoordinatesToCellName(i+1, 2)
		_ = f.SetCellStr(credImportSheetMain, cell, v)
	}
	buf, err := f.WriteToBuffer()
	if err != nil {
		t.Fatal(err)
	}

	updated, _, valErrs, err := CompanyAccessCredentialImportCommit(bytes.NewReader(buf.Bytes()), int64(buf.Len()))
	if err != nil || len(valErrs) > 0 || updated != 1 {
		t.Fatalf("import: updated=%d errs=%v err=%v", updated, valErrs, err)
	}
	var cred models.CompanyAccessCredential
	db.Where("company_id = ?", co.ID).First(&cred)
	if cred.SolUsuario != "NUEVO" {
		t.Errorf("el import debía actualizar la clave SOL: %+v", cred)
	}
	if cred.SireClientID != "cid" || cred.SireClientSecret != "secreto" {
		t.Errorf("el import borró las credenciales SIRE: %+v", cred)
	}
}

// Excel convierte en número los valores solo-dígitos y pierde los ceros iniciales: reimportar no debe dañar
// usuarios SOL / DNI que empiezan con 0.
func TestImportClavesSol_conservaCerosIniciales(t *testing.T) {
	db := setupCompanyRucTestDB(t)
	if err := db.AutoMigrate(&models.CompanyAccessCredential{}); err != nil {
		t.Fatal(err)
	}
	co := models.Company{RUC: "20111111111", BusinessName: "Empresa", Status: "activo", ClientType: models.CompanyClientTypeEstudio}
	db.Create(&co)
	db.Create(&models.CompanyAccessCredential{CompanyID: co.ID, SolUsuario: "06766848", BnlDNI: "04712345"})

	f := excelize.NewFile()
	_ = f.SetSheetName("Sheet1", credImportSheetMain)
	for i, h := range []string{"ruc", "sol_usuario", "bnl_dni"} {
		cell, _ := excelize.CoordinatesToCellName(i+1, 1)
		_ = f.SetCellStr(credImportSheetMain, cell, h)
	}
	_ = f.SetCellStr(credImportSheetMain, "A2", "20111111111")
	_ = f.SetCellInt(credImportSheetMain, "B2", 6766848) // número: sin el cero inicial
	_ = f.SetCellInt(credImportSheetMain, "C2", 99887766) // DNI realmente distinto
	buf, _ := f.WriteToBuffer()

	if n, _, errs, err := CompanyAccessCredentialImportCommit(bytes.NewReader(buf.Bytes()), int64(buf.Len())); err != nil || len(errs) > 0 || n != 1 {
		t.Fatalf("import: %d %v %v", n, errs, err)
	}
	var cred models.CompanyAccessCredential
	db.Where("company_id = ?", co.ID).First(&cred)
	if cred.SolUsuario != "06766848" {
		t.Errorf("perdió el cero inicial del usuario: %q", cred.SolUsuario)
	}
	if cred.BnlDNI != "99887766" {
		t.Errorf("un valor distinto sí debe actualizarse: %q", cred.BnlDNI)
	}
}
