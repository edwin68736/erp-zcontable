package database

import (
	"testing"
	"time"

	"miappfiber/models"
)

func TestMigratePdt621ObservacionesANotas(t *testing.T) {
	db := setupPdt601Pdt621MigrationTestDB(t)
	if err := db.AutoMigrate(&models.SupervisorObservation{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	// Control 1: ya tenía nota en el registro + 2 notas del historial + 1 motivo de "Observar".
	d1 := mustCreateDeclaration(t, db, 1, models.SupervisorDeclPDT621, models.SupervisorDeclObservado)
	db.Model(d1).Update("notes", "Falta hoja de compras")
	db.Create(&models.SupervisorPdt621Record{MonthlyControlID: 1, Observacion: "Nota previa"})
	// Control 2: sin registro todavía.
	d2 := mustCreateDeclaration(t, db, 2, models.SupervisorDeclPDT621, models.SupervisorDeclPendiente)
	// Una declaración PDT 601 no se toca.
	d3 := mustCreateDeclaration(t, db, 3, models.SupervisorDeclPDT601, models.SupervisorDeclPendiente)

	obs := func(declID uint, body string, day int) {
		id := declID
		at := time.Date(2026, 9, day, 10, 0, 0, 0, time.Local)
		if err := db.Create(&models.SupervisorObservation{DeclarationID: &id, UserID: 4, Body: body, CreatedAt: at}).Error; err != nil {
			t.Fatalf("obs: %v", err)
		}
	}
	obs(d1.ID, "Llamar al cliente", 10)
	obs(d1.ID, "Falta hoja de compras", 11) // motivo de Observar: no se migra
	obs(d1.ID, "Revisado de nuevo", 12)
	obs(d2.ID, "Pendiente de firma", 5)
	obs(d3.ID, "Nota de planilla", 5)

	if err := applyMigrationOnce(db, migPdt621ObservacionesANotas, migratePdt621ObservacionesANotas); err != nil {
		t.Fatalf("migración: %v", err)
	}
	// Segunda corrida: no debe duplicar.
	if err := applyMigrationOnce(db, migPdt621ObservacionesANotas, migratePdt621ObservacionesANotas); err != nil {
		t.Fatalf("migración 2: %v", err)
	}

	var r1, r2 models.SupervisorPdt621Record
	db.Where("monthly_control_id = ?", 1).First(&r1)
	db.Where("monthly_control_id = ?", 2).First(&r2)
	if want := "Nota previa\n10/09/2026: Llamar al cliente\n12/09/2026: Revisado de nuevo"; r1.Observacion != want {
		t.Fatalf("control 1 = %q, want %q", r1.Observacion, want)
	}
	if want := "05/09/2026: Pendiente de firma"; r2.Observacion != want {
		t.Fatalf("control 2 = %q, want %q", r2.Observacion, want)
	}
	var n int64
	db.Model(&models.SupervisorPdt621Record{}).Where("monthly_control_id = ?", 3).Count(&n)
	if n != 0 {
		t.Fatal("no debía crear registro PDT 621 para una declaración PDT 601")
	}
}
