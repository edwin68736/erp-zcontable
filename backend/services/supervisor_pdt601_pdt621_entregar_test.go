package services

// Cubre el side-effect "Entregar automático" y el bloqueo en "Entregado"
// (docs/diseno-estados-pdt601-pdt621-2026-09-16.md §9): guardar la planilla/registro con fecha de
// entrega cargada mueve solo la declaración a "por_revisar" — no hay selector de estado manual — y una
// vez "entregado" el guardado queda bloqueado hasta que se reabra.

import (
	"testing"

	"miappfiber/models"
)

func TestSavePdt601Planilla_AutoTransitionsToPorRevisar_WhenFechaEntregaSet(t *testing.T) {
	db := setupPdt601TestDB(t)
	svc := NewSupervisorService()
	co := seedEstudioCompany(t, db, "E001")
	if _, err := svc.CreatePeriod("2026-07", "test"); err != nil {
		t.Fatalf("CreatePeriod: %v", err)
	}

	detail, err := svc.SavePdt601Planilla(co.ID, "2026-07", Pdt601PlanillaInput{
		RegimenLaboral: models.Pdt601RegimenGeneral,
		FechaEntrega:   "2026-07-10",
	})
	if err != nil {
		t.Fatalf("SavePdt601Planilla: %v", err)
	}
	if detail.Declaration.Status != models.SupervisorDeclPorRevisar {
		t.Fatalf("Status (en memoria)=%s, want por_revisar", detail.Declaration.Status)
	}
	var got models.SupervisorDeclaration
	if err := db.First(&got, detail.Declaration.ID).Error; err != nil {
		t.Fatalf("reload: %v", err)
	}
	if got.Status != models.SupervisorDeclPorRevisar {
		t.Fatalf("Status (en BD)=%s, want por_revisar", got.Status)
	}
}

func TestSavePdt601Planilla_NoTransition_WhenFechaEntregaEmpty(t *testing.T) {
	db := setupPdt601TestDB(t)
	svc := NewSupervisorService()
	co := seedEstudioCompany(t, db, "E002")
	if _, err := svc.CreatePeriod("2026-07", "test"); err != nil {
		t.Fatalf("CreatePeriod: %v", err)
	}

	detail, err := svc.SavePdt601Planilla(co.ID, "2026-07", Pdt601PlanillaInput{
		RegimenLaboral: models.Pdt601RegimenGeneral,
	})
	if err != nil {
		t.Fatalf("SavePdt601Planilla: %v", err)
	}
	if detail.Declaration.Status != models.SupervisorDeclPendiente {
		t.Fatalf("Status=%s, want pendiente (sin fecha de entrega no debe haber transición)", detail.Declaration.Status)
	}
}

func TestSavePdt601Planilla_BlockedWhenEntregado(t *testing.T) {
	db := setupPdt601TestDB(t)
	svc := NewSupervisorService()
	co := seedEstudioCompany(t, db, "E003")
	if _, err := svc.CreatePeriod("2026-07", "test"); err != nil {
		t.Fatalf("CreatePeriod: %v", err)
	}
	detail, err := svc.SavePdt601Planilla(co.ID, "2026-07", Pdt601PlanillaInput{
		RegimenLaboral: models.Pdt601RegimenGeneral,
		FechaEntrega:   "2026-07-10",
	})
	if err != nil {
		t.Fatalf("primer guardado: %v", err)
	}
	if _, err := svc.ApproveDeclaration(detail.Declaration.ID, 9); err != nil {
		t.Fatalf("ApproveDeclaration: %v", err)
	}

	if _, err := svc.SavePdt601Planilla(co.ID, "2026-07", Pdt601PlanillaInput{
		RegimenLaboral: models.Pdt601RegimenGeneral,
		Essalud:        500,
	}); err == nil {
		t.Fatal("no se debía poder editar una planilla ya entregada")
	}
}

func TestSavePdt621Record_AutoTransitionsToPorRevisar_WhenFechaEntregaSet(t *testing.T) {
	db := setupPdt621TestDB(t)
	svc := NewSupervisorService()
	co := seedEstudioCompany(t, db, "E004")
	if _, err := svc.CreatePeriod("2026-07", "test"); err != nil {
		t.Fatalf("CreatePeriod: %v", err)
	}

	detail, err := svc.SavePdt621Record(co.ID, "2026-07", Pdt621RecordInput{
		PrimeraEntregaFecha: "2026-07-10",
	})
	if err != nil {
		t.Fatalf("SavePdt621Record: %v", err)
	}
	if detail.Declaration.Status != models.SupervisorDeclPorRevisar {
		t.Fatalf("Status=%s, want por_revisar", detail.Declaration.Status)
	}
}

func TestSavePdt621Record_NoTransition_WhenFechaEntregaEmpty(t *testing.T) {
	db := setupPdt621TestDB(t)
	svc := NewSupervisorService()
	co := seedEstudioCompany(t, db, "E005")
	if _, err := svc.CreatePeriod("2026-07", "test"); err != nil {
		t.Fatalf("CreatePeriod: %v", err)
	}

	detail, err := svc.SavePdt621Record(co.ID, "2026-07", Pdt621RecordInput{})
	if err != nil {
		t.Fatalf("SavePdt621Record: %v", err)
	}
	if detail.Declaration.Status != models.SupervisorDeclPendiente {
		t.Fatalf("Status=%s, want pendiente (sin fecha de entrega no debe haber transición)", detail.Declaration.Status)
	}
}

func TestSavePdt621Record_BlockedWhenEntregado(t *testing.T) {
	db := setupPdt621TestDB(t)
	svc := NewSupervisorService()
	co := seedEstudioCompany(t, db, "E006")
	if _, err := svc.CreatePeriod("2026-07", "test"); err != nil {
		t.Fatalf("CreatePeriod: %v", err)
	}
	detail, err := svc.SavePdt621Record(co.ID, "2026-07", Pdt621RecordInput{
		PrimeraEntregaFecha: "2026-07-10",
	})
	if err != nil {
		t.Fatalf("primer guardado: %v", err)
	}
	if _, err := svc.ApproveDeclaration(detail.Declaration.ID, 9); err != nil {
		t.Fatalf("ApproveDeclaration: %v", err)
	}

	if _, err := svc.SavePdt621Record(co.ID, "2026-07", Pdt621RecordInput{
		TotalVentas: 1000,
	}); err == nil {
		t.Fatal("no se debía poder editar un registro PDT 621 ya entregado")
	}
}
