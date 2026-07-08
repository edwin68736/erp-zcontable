package database

import (
	"fmt"

	"miappfiber/models"

	"gorm.io/gorm"
)

const (
	migDeclarationTypeDetracciones = "supervisor_v1_declaration_type_detracciones"
	migDetraccionesStatusF41a      = "supervisor_v1_detracciones_status_f41a"
	migDetraccionesStatusSimplified = "supervisor_v2_detracciones_status_simplified"
)

// RunSupervisorMigrations ejecuta migraciones de datos del módulo supervisores (una sola vez).
func RunSupervisorMigrations(db *gorm.DB) error {
	if err := db.AutoMigrate(&models.SchemaMigration{}); err != nil {
		return err
	}
	steps := []struct {
		name string
		fn   func(*gorm.DB) error
	}{
		{migDeclarationTypeDetracciones, migrateDeclarationTypeDistractionsToDetracciones},
		{migDetraccionesStatusF41a, migrateDetraccionesStatusF41a},
		{migDetraccionesStatusSimplified, migrateDetraccionesStatusSimplified},
	}
	for _, step := range steps {
		if err := applyMigrationOnce(db, step.name, step.fn); err != nil {
			return fmt.Errorf("%s: %w", step.name, err)
		}
	}
	return nil
}

// migrateDeclarationTypeDistractionsToDetracciones renombra declaration_type legacy F4.
func migrateDeclarationTypeDistractionsToDetracciones(db *gorm.DB) error {
	return db.Model(&models.SupervisorDeclaration{}).
		Where("declaration_type = ?", models.SupervisorDeclDistractionsLegacy).
		Update("declaration_type", models.SupervisorDeclDetracciones).Error
}

// migrateDetraccionesStatusF41a mapea estados legacy F4 a máquina F4.1a.
func migrateDetraccionesStatusF41a(db *gorm.DB) error {
	types := []string{models.SupervisorDeclDetracciones, models.SupervisorDeclDistractionsLegacy}
	var decls []models.SupervisorDeclaration
	if err := db.Where("declaration_type IN ?", types).Find(&decls).Error; err != nil {
		return err
	}
	for i := range decls {
		d := &decls[i]
		var attCount int64
		_ = db.Model(&models.SupervisorAttachment{}).Where("declaration_id = ?", d.ID).Count(&attCount).Error
		newStatus, pct := mapLegacyDetraccionesStatusForMigration(d.Status, attCount)
		if d.Status == newStatus && d.ProgressPct == pct && d.DeclarationType == models.SupervisorDeclDetracciones {
			continue
		}
		updates := map[string]interface{}{
			"status":           newStatus,
			"progress_pct":     pct,
			"declaration_type": models.SupervisorDeclDetracciones,
		}
		if d.Status == models.SupervisorDistractionEscalado && d.Priority == models.SupervisorPriorityMedia {
			updates["priority"] = models.SupervisorPriorityAlta
		}
		if err := db.Model(d).Updates(updates).Error; err != nil {
			return fmt.Errorf("declaración %d: %w", d.ID, err)
		}
	}
	return nil
}

// mapLegacyDetraccionesStatusForMigration duplica reglas de services para migración sin import cycle.
func mapLegacyDetraccionesStatusForMigration(oldStatus string, attachmentCount int64) (string, int) {
	var newStatus string
	switch oldStatus {
	case models.SupervisorDistractionAbierto:
		newStatus = models.SupervisorDeclPendiente
	case models.SupervisorDistractionEnProceso:
		newStatus = models.SupervisorDeclEnElaboracion
	case models.SupervisorDistractionResuelto:
		if attachmentCount >= 1 {
			newStatus = models.SupervisorDeclEnRevision
		} else {
			newStatus = models.SupervisorDetraccionDepositoRegistrado
		}
	case models.SupervisorDistractionEscalado:
		newStatus = models.SupervisorDeclObservado
	case models.SupervisorDeclObservado:
		newStatus = models.SupervisorDeclObservado
	case models.SupervisorSunatValidado:
		newStatus = models.SupervisorSunatValidado
	case models.SupervisorDeclPendiente, models.SupervisorDeclEnElaboracion,
		models.SupervisorDetraccionDepositoPendiente, models.SupervisorDetraccionDepositoRegistrado,
		models.SupervisorDetraccionSinOperaciones, models.SupervisorDeclEnRevision:
		newStatus = oldStatus
	default:
		newStatus = models.SupervisorDeclPendiente
	}
	return newStatus, detraccionesProgressPctForMigration(newStatus)
}

func detraccionesProgressPctForMigration(status string) int {
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
	case models.SupervisorDeclEnElaboracion:
		return 20
	case models.SupervisorDetraccionDepositoPendiente:
		return 40
	case models.SupervisorDetraccionDepositoRegistrado:
		return 55
	case models.SupervisorDetraccionSinOperaciones:
		return 60
	case models.SupervisorDeclEnRevision:
		return 75
	case models.SupervisorDeclObservado:
		return 40
	default:
		return 0
	}
}

// migrateDetraccionesStatusSimplified mapea estados F4.1a/legacy al flujo operativo simplificado.
func migrateDetraccionesStatusSimplified(db *gorm.DB) error {
	types := []string{models.SupervisorDeclDetracciones, models.SupervisorDeclDistractionsLegacy}
	var decls []models.SupervisorDeclaration
	if err := db.Where("declaration_type IN ?", types).Find(&decls).Error; err != nil {
		return err
	}
	for i := range decls {
		d := &decls[i]
		var attCount int64
		_ = db.Model(&models.SupervisorAttachment{}).Where("declaration_id = ?", d.ID).Count(&attCount).Error
		newStatus, pct := mapSimplifiedDetraccionesStatusForMigration(d.Status, attCount)
		if d.Status == newStatus && d.ProgressPct == pct {
			continue
		}
		if err := db.Model(d).Updates(map[string]interface{}{
			"status":       newStatus,
			"progress_pct": pct,
		}).Error; err != nil {
			return fmt.Errorf("declaración %d: %w", d.ID, err)
		}
	}
	return nil
}

func mapSimplifiedDetraccionesStatusForMigration(oldStatus string, attachmentCount int64) (string, int) {
	switch oldStatus {
	case models.SupervisorSunatValidado, models.SupervisorDetraccionVerificado:
		return models.SupervisorDetraccionVerificado, 100
	case models.SupervisorDetraccionSinClave:
		return models.SupervisorDetraccionSinClave, 100
	case models.SupervisorDetraccionNoCorresponde, models.SupervisorDetraccionSinOperaciones:
		return models.SupervisorDetraccionNoCorresponde, 100
	case models.SupervisorDetraccionCargado, models.SupervisorDeclEnRevision:
		return models.SupervisorDetraccionCargado, 50
	case models.SupervisorDeclPendiente:
		return models.SupervisorDeclPendiente, 0
	default:
		if attachmentCount > 0 {
			return models.SupervisorDetraccionCargado, 50
		}
		return models.SupervisorDeclPendiente, 0
	}
}
