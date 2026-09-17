package services

// Cubre el rediseño de estados de PDT601/PDT621 (docs/diseno-estados-pdt601-pdt621-2026-09-16.md §9):
// Aprobar/Observar/Reabrir dejan de pasar libremente por el PUT genérico de declaraciones — cada uno
// tiene su propia validación de precondición, y el PUT genérico queda bloqueado para estos dos tipos
// (mismo criterio que ya existía para Detracciones vía validateDetraccionesStatusTransition).

import (
	"testing"

	"miappfiber/models"

	"gorm.io/gorm"
)

// seedPdt601Declaration crea un control mensual + declaración pdt_601 en el estado indicado, sin pasar
// por EnsurePdt601 (que exige más setup de empresa/asistente) — alcanza para probar la lógica de
// transición en sí, que es independiente de cómo se llegó a existir la fila.
func seedPdt601Declaration(t *testing.T, db *gorm.DB, companyID uint, declType, status string) models.SupervisorDeclaration {
	t.Helper()
	ctrl := models.SupervisorMonthlyControl{CompanyID: companyID, PeriodYM: "2026-07", GeneralStatus: models.SupervisorControlPendiente}
	if err := db.Create(&ctrl).Error; err != nil {
		t.Fatalf("control: %v", err)
	}
	decl := models.SupervisorDeclaration{MonthlyControlID: ctrl.ID, DeclarationType: declType, Status: status}
	if err := db.Create(&decl).Error; err != nil {
		t.Fatalf("declaration: %v", err)
	}
	return decl
}

func TestApprovePdt601_FromPorRevisar_Succeeds(t *testing.T) {
	db := setupSupervisorTestDB(t)
	co := seedActiveCompany(t, db, "S001")
	decl := seedPdt601Declaration(t, db, co.ID, models.SupervisorDeclPDT601, models.SupervisorDeclPorRevisar)

	svc := NewSupervisorService()
	updated, err := svc.ApproveDeclaration(decl.ID, 9)
	if err != nil {
		t.Fatalf("ApproveDeclaration: %v", err)
	}
	if updated.Status != models.SupervisorDeclEntregado {
		t.Fatalf("Status=%s, want entregado", updated.Status)
	}
	if updated.ApproverUserID == nil || *updated.ApproverUserID != 9 {
		t.Fatalf("ApproverUserID=%v, want 9", updated.ApproverUserID)
	}
}

func TestApprovePdt621_FromOtherStatus_Fails(t *testing.T) {
	db := setupSupervisorTestDB(t)
	co := seedActiveCompany(t, db, "S002")
	decl := seedPdt601Declaration(t, db, co.ID, models.SupervisorDeclPDT621, models.SupervisorDeclPendiente)

	svc := NewSupervisorService()
	if _, err := svc.ApproveDeclaration(decl.ID, 9); err == nil {
		t.Fatal("no se debía poder aprobar una declaración en estado Pendiente")
	}
	var got models.SupervisorDeclaration
	db.First(&got, decl.ID)
	if got.Status != models.SupervisorDeclPendiente {
		t.Fatalf("Status=%s, no debía cambiar tras el intento fallido", got.Status)
	}
}

func TestObservePdt601_RequiresNotes(t *testing.T) {
	db := setupSupervisorTestDB(t)
	co := seedActiveCompany(t, db, "S003")
	decl := seedPdt601Declaration(t, db, co.ID, models.SupervisorDeclPDT601, models.SupervisorDeclPorRevisar)

	svc := NewSupervisorService()
	if _, err := svc.ObserveDeclaration(decl.ID, 9, "   "); err == nil {
		t.Fatal("observar sin motivo debía rechazarse")
	}
}

func TestObservePdt601_FromPorRevisar_Succeeds_AndUpdatesControlGeneralStatus(t *testing.T) {
	db := setupSupervisorTestDB(t)
	co := seedActiveCompany(t, db, "S004")
	decl := seedPdt601Declaration(t, db, co.ID, models.SupervisorDeclPDT601, models.SupervisorDeclPorRevisar)

	svc := NewSupervisorService()
	updated, err := svc.ObserveDeclaration(decl.ID, 9, "falta el sustento de un importe")
	if err != nil {
		t.Fatalf("ObserveDeclaration: %v", err)
	}
	if updated.Status != models.SupervisorDeclObservado {
		t.Fatalf("Status=%s, want observado", updated.Status)
	}
	var ctrl models.SupervisorMonthlyControl
	db.First(&ctrl, updated.MonthlyControlID)
	if ctrl.GeneralStatus != models.SupervisorControlObservado {
		t.Fatalf("GeneralStatus=%s, want observado", ctrl.GeneralStatus)
	}
}

func TestReopenDeclaration_FromEntregado_Succeeds(t *testing.T) {
	db := setupSupervisorTestDB(t)
	co := seedActiveCompany(t, db, "S005")
	decl := seedPdt601Declaration(t, db, co.ID, models.SupervisorDeclPDT601, models.SupervisorDeclEntregado)

	svc := NewSupervisorService()
	updated, err := svc.ReopenDeclaration(decl.ID, 3, "el supervisor aprobó por error")
	if err != nil {
		t.Fatalf("ReopenDeclaration: %v", err)
	}
	if updated.Status != models.SupervisorDeclPorRevisar {
		t.Fatalf("Status=%s, want por_revisar", updated.Status)
	}
	if updated.ReopenedBy == nil || *updated.ReopenedBy != 3 {
		t.Fatalf("ReopenedBy=%v, want 3", updated.ReopenedBy)
	}
	if updated.ReopenedAt == nil {
		t.Fatal("ReopenedAt no debía ser nil")
	}
	if updated.ReopenReason != "el supervisor aprobó por error" {
		t.Fatalf("ReopenReason=%q", updated.ReopenReason)
	}
}

func TestReopenDeclaration_RequiresReason(t *testing.T) {
	db := setupSupervisorTestDB(t)
	co := seedActiveCompany(t, db, "S006")
	decl := seedPdt601Declaration(t, db, co.ID, models.SupervisorDeclPDT601, models.SupervisorDeclEntregado)

	svc := NewSupervisorService()
	if _, err := svc.ReopenDeclaration(decl.ID, 3, ""); err == nil {
		t.Fatal("reabrir sin motivo debía rechazarse")
	}
}

func TestReopenDeclaration_FromNonEntregado_Fails(t *testing.T) {
	db := setupSupervisorTestDB(t)
	co := seedActiveCompany(t, db, "S007")
	decl := seedPdt601Declaration(t, db, co.ID, models.SupervisorDeclPDT601, models.SupervisorDeclPorRevisar)

	svc := NewSupervisorService()
	if _, err := svc.ReopenDeclaration(decl.ID, 3, "motivo"); err == nil {
		t.Fatal("no se debía poder reabrir algo que no está Entregado")
	}
}

func TestReopenDeclaration_RejectsOtherDeclarationTypes(t *testing.T) {
	db := setupSupervisorTestDB(t)
	co := seedActiveCompany(t, db, "S008")
	decl := seedPdt601Declaration(t, db, co.ID, models.SupervisorDeclSIRE, models.SupervisorDeclEntregado)

	svc := NewSupervisorService()
	if _, err := svc.ReopenDeclaration(decl.ID, 3, "motivo"); err == nil {
		t.Fatal("reabrir no debía aplicar a declaration_type distinto de pdt_601/pdt_621")
	}
}

func TestUpdateDeclaration_BlocksGenericStatusChange_ForPdt601Pdt621(t *testing.T) {
	db := setupSupervisorTestDB(t)
	co := seedActiveCompany(t, db, "S009")
	decl := seedPdt601Declaration(t, db, co.ID, models.SupervisorDeclPDT601, models.SupervisorDeclPorRevisar)

	svc := NewSupervisorService()
	if _, err := svc.UpdateDeclaration(decl.ID, SupervisorDeclarationInput{Status: models.SupervisorDeclEntregado}, 9); err == nil {
		t.Fatal("el PUT genérico no debía poder cambiar el estado de una declaración pdt_601 — use Aprobar/Observar/Reabrir")
	}
	var got models.SupervisorDeclaration
	db.First(&got, decl.ID)
	if got.Status != models.SupervisorDeclPorRevisar {
		t.Fatalf("Status=%s, no debía cambiar tras el intento bloqueado", got.Status)
	}
}

func TestUpdateDeclaration_AllowsNonStatusFields_ForPdt601Pdt621(t *testing.T) {
	db := setupSupervisorTestDB(t)
	co := seedActiveCompany(t, db, "S010")
	decl := seedPdt601Declaration(t, db, co.ID, models.SupervisorDeclPDT601, models.SupervisorDeclPorRevisar)

	svc := NewSupervisorService()
	updated, err := svc.UpdateDeclaration(decl.ID, SupervisorDeclarationInput{Notes: "nota interna, no es un cambio de estado"}, 9)
	if err != nil {
		t.Fatalf("actualizar un campo que no es Status no debía bloquearse: %v", err)
	}
	if updated.Status != models.SupervisorDeclPorRevisar {
		t.Fatalf("Status=%s, no debía cambiar", updated.Status)
	}
	if updated.Notes != "nota interna, no es un cambio de estado" {
		t.Fatalf("Notes=%q", updated.Notes)
	}
}
