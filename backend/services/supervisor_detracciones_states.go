package services

import (
	"errors"
	"fmt"
	"path/filepath"
	"strings"

	"miappfiber/database"
	"miappfiber/models"
)

// detraccionesProgressFromStatus avance por estado operativo simplificado.
func detraccionesProgressFromStatus(status string) int {
	switch status {
	case models.SupervisorDeclPendiente:
		return 0
	case models.SupervisorDetraccionCargado:
		return 50
	case models.SupervisorDetraccionVerificado,
		models.SupervisorDetraccionSinClave,
		models.SupervisorDetraccionNoCorresponde,
		models.SupervisorSunatValidado:
		return 100
	default:
		return 0
	}
}

func detraccionesAllowsUpload(status string) bool {
	switch status {
	case models.SupervisorDeclPendiente, models.SupervisorDetraccionCargado:
		return true
	default:
		return false
	}
}

func detraccionesIsTerminal(status string) bool {
	switch status {
	case models.SupervisorDetraccionVerificado,
		models.SupervisorDetraccionSinClave,
		models.SupervisorDetraccionNoCorresponde,
		models.SupervisorSunatValidado:
		return true
	default:
		return false
	}
}

func normalizeDetraccionesDisplayStatus(status string) string {
	switch strings.TrimSpace(status) {
	case "", models.SupervisorSunatSinRegistro:
		return models.SupervisorDeclPendiente
	case models.SupervisorSunatValidado:
		return models.SupervisorDetraccionVerificado
	default:
		return status
	}
}

// mapLegacyDetraccionesStatus convierte estados legacy F4/F4.1a al flujo simplificado.
func mapLegacyDetraccionesStatus(oldStatus string, attachmentCount int64) (string, int) {
	oldStatus = strings.TrimSpace(oldStatus)
	var newStatus string
	switch oldStatus {
	case models.SupervisorSunatValidado, models.SupervisorDetraccionVerificado:
		newStatus = models.SupervisorDetraccionVerificado
	case models.SupervisorDetraccionSinClave:
		newStatus = models.SupervisorDetraccionSinClave
	case models.SupervisorDetraccionNoCorresponde, models.SupervisorDetraccionSinOperaciones:
		newStatus = models.SupervisorDetraccionNoCorresponde
	case models.SupervisorDetraccionCargado, models.SupervisorDeclEnRevision:
		newStatus = models.SupervisorDetraccionCargado
	case models.SupervisorDeclPendiente:
		newStatus = models.SupervisorDeclPendiente
	default:
		if attachmentCount > 0 {
			newStatus = models.SupervisorDetraccionCargado
		} else {
			newStatus = models.SupervisorDeclPendiente
		}
	}
	return newStatus, detraccionesProgressFromStatus(newStatus)
}

// validateDetraccionesStatusTransition bloquea cambios genéricos PUT; usar endpoints dedicados.
func (s *SupervisorService) validateDetraccionesStatusTransition(d *models.SupervisorDeclaration, from, to, _ string) error {
	if from == to {
		return nil
	}
	return errors.New("use los endpoints de Detracciones para cambiar estado (carga PDF, verificar o estado supervisor)")
}

func countDeclarationAttachments(declarationID uint) (int64, error) {
	var n int64
	err := database.DB.Model(&models.SupervisorAttachment{}).
		Where("declaration_id = ?", declarationID).
		Count(&n).Error
	return n, err
}

// observeDetraccionesDeclaration legacy — ya no aplica al flujo simplificado.
func (s *SupervisorService) observeDetraccionesDeclaration(id uint, approverID uint, notes string) (*models.SupervisorDeclaration, error) {
	return nil, errors.New("las observaciones no aplican al flujo actual de Detracciones")
}

func validateDetraccionesVerifyPreconditions(d *models.SupervisorDeclaration) error {
	if d.Status != models.SupervisorDetraccionCargado {
		return errors.New("solo se puede verificar desde estado cargado")
	}
	n, err := countDeclarationAttachments(d.ID)
	if err != nil {
		return err
	}
	if n < 1 {
		return errors.New("cargue el PDF antes de verificar")
	}
	return nil
}

func validateDetraccionesSupervisorStatus(to string) error {
	switch to {
	case models.SupervisorDetraccionSinClave, models.SupervisorDetraccionNoCorresponde:
		return nil
	default:
		return fmt.Errorf("estado supervisor no permitido: %s", to)
	}
}

func validateDetraccionesSupervisorStatusTransition(from, to string) error {
	if err := validateDetraccionesSupervisorStatus(to); err != nil {
		return err
	}
	switch from {
	case models.SupervisorDeclPendiente, models.SupervisorDetraccionCargado:
		return nil
	default:
		return fmt.Errorf("no se puede cambiar a %s desde %s", to, from)
	}
}

func validateDetraccionesPDFFile(fileName string, data []byte) error {
	ext := strings.ToLower(filepath.Ext(strings.TrimSpace(fileName)))
	if ext != ".pdf" {
		return errors.New("solo se permiten archivos PDF")
	}
	if len(data) < 5 || string(data[:5]) != "%PDF-" {
		return errors.New("el archivo no es un PDF válido")
	}
	return nil
}

// validateDetraccionesPreconditions alias para verificación supervisor.
func validateDetraccionesPreconditions(d *models.SupervisorDeclaration) error {
	return validateDetraccionesVerifyPreconditions(d)
}
