package services

import (
	"testing"

	"miappfiber/database"
	"miappfiber/models"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func setupSunatDueDateTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("sqlite: %v", err)
	}
	if err := db.AutoMigrate(&models.SunatDueDateCalendarRow{}, &models.SunatOfficialDueDateRow{}, &models.User{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	database.DB = db
	return db
}

// TestSunatDueDateService_seedListUpdate cubre: siembra automática (12 filas fijas con los
// valores oficiales SUNAT 2026), lectura, edición de un mes, y que la siembra nunca duplica filas.
func TestSunatDueDateService_seedListUpdate(t *testing.T) {
	db := setupSunatDueDateTestDB(t)
	svc := NewSunatDueDateService()

	rows, err := svc.List()
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(rows) != 12 {
		t.Fatalf("filas=%d want 12", len(rows))
	}
	// Enero (mes 1) trae el valor oficial sembrado.
	if rows[0].Month != 1 || rows[0].Dates[0] != "2026-02-09" {
		t.Fatalf("mes 1 dígito 0 = %q want 2026-02-09", rows[0].Dates[0])
	}
	// Diciembre (mes 12) vence en enero del año SIGUIENTE.
	dec := rows[11]
	if dec.Month != 12 || dec.Dates[0] != "2027-01-08" {
		t.Fatalf("mes 12 dígito 0 = %q want 2027-01-08", dec.Dates[0])
	}

	// Editar solo enero; el resto de meses no debe tocarse.
	newJan := [10]string{
		"2027-02-09", "2027-02-10", "2027-02-11", "2027-02-11", "2027-02-12",
		"2027-02-12", "2027-02-13", "2027-02-13", "2027-02-16", "2027-02-16",
	}
	updated, err := svc.Update(1, []SunatDueDateUpdateInput{{Month: 1, Dates: newJan}})
	if err != nil {
		t.Fatalf("Update: %v", err)
	}
	if updated[0].Dates != newJan {
		t.Fatalf("mes 1 no se actualizó: %+v", updated[0].Dates)
	}
	if updated[1].Dates[0] != "2026-03-09" {
		t.Fatalf("mes 2 se modificó indebidamente: %q", updated[1].Dates[0])
	}

	// La siembra es idempotente: no duplica filas aunque se invoque de nuevo.
	if err := svc.EnsureSeeded(); err != nil {
		t.Fatalf("EnsureSeeded 2: %v", err)
	}
	var count int64
	db.Model(&models.SunatDueDateCalendarRow{}).Count(&count)
	if count != 12 {
		t.Fatalf("filas tras re-siembra=%d want 12", count)
	}
}

// TestSunatDueDateService_validatesDateFormat rechaza fechas mal formadas y meses fuera de rango.
func TestSunatDueDateService_validatesDateFormat(t *testing.T) {
	setupSunatDueDateTestDB(t)
	svc := NewSunatDueDateService()

	bad := [10]string{"09/02/2026", "", "", "", "", "", "", "", "", ""}
	if _, err := svc.Update(1, []SunatDueDateUpdateInput{{Month: 1, Dates: bad}}); err == nil {
		t.Fatal("se esperaba error por formato de fecha inválido")
	}

	var empty [10]string
	if _, err := svc.Update(1, []SunatDueDateUpdateInput{{Month: 13, Dates: empty}}); err == nil {
		t.Fatal("se esperaba error por mes inválido")
	}
}

// El calendario del estudio y el oficial de SUNAT son tablas distintas: editar uno no toca al otro, y cada uno se siembra
// por su cuenta con el cronograma oficial 2026 de partida.
func TestSunatDueDateService_estudioYOficialSonIndependientes(t *testing.T) {
	setupSunatDueDateTestDB(t)
	studio := NewSunatDueDateService()
	official := NewSunatOfficialDueDateService()

	so, err := official.List()
	if err != nil || len(so) != 12 || so[0].Dates[0] != "2026-02-09" {
		t.Fatalf("oficial sembrado: %d filas, %v", len(so), err)
	}
	ss, err := studio.List()
	if err != nil || len(ss) != 12 {
		t.Fatalf("estudio sembrado: %d filas, %v", len(ss), err)
	}

	// El estudio maneja otra fecha para enero dígito 0.
	jan := ss[0].Dates
	jan[0] = "2026-02-05"
	if _, err := studio.Update(7, []SunatDueDateUpdateInput{{Month: 1, Dates: jan}}); err != nil {
		t.Fatal(err)
	}
	ss, _ = studio.List()
	so, _ = official.List()
	if ss[0].Dates[0] != "2026-02-05" || so[0].Dates[0] != "2026-02-09" {
		t.Fatalf("editar el del estudio no debe cambiar el oficial: estudio=%s oficial=%s", ss[0].Dates[0], so[0].Dates[0])
	}

	// Y al revés: SUNAT corrige su cronograma sin mover el del estudio.
	offJan := so[0].Dates
	offJan[0] = "2026-02-10"
	if _, err := official.Update(7, []SunatDueDateUpdateInput{{Month: 1, Dates: offJan}}); err != nil {
		t.Fatal(err)
	}
	ss, _ = studio.List()
	so, _ = official.List()
	if ss[0].Dates[0] != "2026-02-05" || so[0].Dates[0] != "2026-02-10" {
		t.Fatalf("editar el oficial no debe cambiar el del estudio: estudio=%s oficial=%s", ss[0].Dates[0], so[0].Dates[0])
	}
	var n int64
	database.DB.Table("sunat_official_due_date_rows").Count(&n)
	if n != 12 {
		t.Errorf("el oficial debe seguir con 12 filas, tiene %d", n)
	}
}
