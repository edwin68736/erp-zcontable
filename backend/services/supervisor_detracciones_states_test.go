package services

import (
	"testing"

	"miappfiber/models"
)

func TestDetraccionesProgressFromStatus(t *testing.T) {
	if got := detraccionesProgressFromStatus(models.SupervisorDeclPendiente); got != 0 {
		t.Fatalf("pendiente progress=%d want 0", got)
	}
	if got := detraccionesProgressFromStatus(models.SupervisorDetraccionCargado); got != 50 {
		t.Fatalf("cargado progress=%d want 50", got)
	}
	if got := detraccionesProgressFromStatus(models.SupervisorDetraccionVerificado); got != 100 {
		t.Fatalf("verificado progress=%d want 100", got)
	}
	if got := detraccionesProgressFromStatus(models.SupervisorSunatValidado); got != 100 {
		t.Fatalf("validado legacy progress=%d want 100", got)
	}
}

func TestMapLegacyDetraccionesStatus(t *testing.T) {
	st, pct := mapLegacyDetraccionesStatus(models.SupervisorDistractionAbierto, 0)
	if st != models.SupervisorDeclPendiente || pct != 0 {
		t.Fatalf("abierto -> %s %d", st, pct)
	}
	st, pct = mapLegacyDetraccionesStatus(models.SupervisorSunatValidado, 0)
	if st != models.SupervisorDetraccionVerificado || pct != 100 {
		t.Fatalf("validado -> %s %d", st, pct)
	}
	st, pct = mapLegacyDetraccionesStatus(models.SupervisorDeclEnRevision, 2)
	if st != models.SupervisorDetraccionCargado || pct != 50 {
		t.Fatalf("en_revision+att -> %s %d", st, pct)
	}
}

func TestDetraccionesAllowsUpload(t *testing.T) {
	if !detraccionesAllowsUpload(models.SupervisorDeclPendiente) {
		t.Fatal("pendiente debe permitir carga")
	}
	if !detraccionesAllowsUpload(models.SupervisorDetraccionCargado) {
		t.Fatal("cargado debe permitir reemplazo")
	}
	if detraccionesAllowsUpload(models.SupervisorDetraccionSinClave) {
		t.Fatal("sin_clave no debe permitir carga")
	}
	if detraccionesAllowsUpload(models.SupervisorDetraccionVerificado) {
		t.Fatal("verificado no debe permitir carga")
	}
}

func TestValidateDetraccionesPDFFile(t *testing.T) {
	if err := validateDetraccionesPDFFile("doc.pdf", []byte("%PDF-1.4\n")); err != nil {
		t.Fatalf("pdf válido: %v", err)
	}
	if err := validateDetraccionesPDFFile("doc.png", []byte("%PDF-1.4\n")); err == nil {
		t.Fatal("extensión no pdf debe fallar")
	}
	if err := validateDetraccionesPDFFile("doc.pdf", []byte("not-a-pdf")); err == nil {
		t.Fatal("contenido no pdf debe fallar")
	}
}

func TestValidateDetraccionesSupervisorStatusTransition(t *testing.T) {
	if err := validateDetraccionesSupervisorStatusTransition(models.SupervisorDeclPendiente, models.SupervisorDetraccionSinClave); err != nil {
		t.Fatalf("pendiente -> sin_clave: %v", err)
	}
	if err := validateDetraccionesSupervisorStatusTransition(models.SupervisorDetraccionVerificado, models.SupervisorDetraccionSinClave); err == nil {
		t.Fatal("verificado -> sin_clave no debe permitirse")
	}
}
