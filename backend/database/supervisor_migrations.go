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
	migPdt601Pdt621StatusEnum      = "supervisor_v1_pdt601_pdt621_status_enum"
	migDropNPSTable                = "supervisor_v1_drop_nps_table"
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
		{migPdt601Pdt621StatusEnum, migratePdt601Pdt621StatusEnum},
		{migDropNPSTable, migrateDropNPSTable},
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

// pdt601Pdt621NewStatusEnum valores válidos del enum reducido de 4 estados
// (docs/diseno-estados-pdt601-pdt621-2026-09-16.md) — cualquier declaración pdt_601/pdt_621 con un
// valor fuera de este set quedó con un valor legacy de antes del rediseño y necesita migrarse.
var pdt601Pdt621NewStatusEnum = map[string]bool{
	models.SupervisorDeclPendiente:  true,
	models.SupervisorDeclPorRevisar: true,
	models.SupervisorDeclObservado:  true,
	models.SupervisorDeclEntregado:  true,
}

// migratePdt601Pdt621StatusEnum reescribe los valores legacy (en_elaboracion, en_revision,
// aprobado, presentado, cerrado) de declaraciones pdt_601/pdt_621 al enum reducido de 4 valores
// (docs/diseno-estados-pdt601-pdt621-2026-09-16.md §3). El rediseño del 2026-09-16 (commit c4b7f02)
// dejó esto pendiente como "no bloqueante" asumiendo que era solo deuda técnica — resultó ser un bug
// visible en producción: el listado mostraba el status crudo sin traducir (p. ej. "aprobado") más un
// badge de puntualidad duplicado, porque el frontend ya no reconoce esos valores.
//
// Mapeo (por fila, según el dato real ya guardado, no por nombre de estado viejo — para no adivinar):
//   - aprobado/presentado/cerrado (el supervisor ya había aprobado) → entregado.
//   - cualquier otro valor legacy (en_elaboracion, en_revision, etc.) → por_revisar si la planilla/
//     registro ya tiene fecha de entrega cargada (mismo criterio que el "entregar automático" de
//     SavePdt601Planilla/SavePdt621Record), si no, pendiente.
func migratePdt601Pdt621StatusEnum(db *gorm.DB) error {
	types := []string{models.SupervisorDeclPDT601, models.SupervisorDeclPDT621}
	var decls []models.SupervisorDeclaration
	if err := db.Where("declaration_type IN ?", types).Find(&decls).Error; err != nil {
		return err
	}
	for i := range decls {
		d := &decls[i]
		if pdt601Pdt621NewStatusEnum[d.Status] {
			continue
		}
		newStatus := models.SupervisorDeclPendiente
		switch d.Status {
		case models.SupervisorDeclAprobado, models.SupervisorDeclPresentado, models.SupervisorDeclCerrado:
			newStatus = models.SupervisorDeclEntregado
		default:
			if pdt601Pdt621WasDelivered(db, d) {
				newStatus = models.SupervisorDeclPorRevisar
			}
		}
		if err := db.Model(d).Updates(map[string]interface{}{
			"status":       newStatus,
			"progress_pct": declarationProgressFromStatusForMigration(newStatus),
		}).Error; err != nil {
			return fmt.Errorf("declaración %d: %w", d.ID, err)
		}
	}
	return nil
}

// pdt601Pdt621WasDelivered true si el asistente ya cargó la fecha de entrega/primera entrega en la
// planilla (pdt_601) o el registro (pdt_621) asociado — mismo campo/criterio que usa el "entregar
// automático" en services/supervisor_pdt601_service.go y supervisor_pdt621_service.go.
func pdt601Pdt621WasDelivered(db *gorm.DB, d *models.SupervisorDeclaration) bool {
	switch d.DeclarationType {
	case models.SupervisorDeclPDT601:
		var pl models.SupervisorPdt601Planilla
		if err := db.Where("monthly_control_id = ?", d.MonthlyControlID).First(&pl).Error; err != nil {
			return false
		}
		return pl.FechaEntrega != nil
	case models.SupervisorDeclPDT621:
		var rec models.SupervisorPdt621Record
		if err := db.Where("monthly_control_id = ?", d.MonthlyControlID).First(&rec).Error; err != nil {
			return false
		}
		return rec.PrimeraEntregaFecha != nil
	default:
		return false
	}
}

// declarationProgressFromStatusForMigration duplica services.declarationProgressFromStatus para el
// subconjunto de 4 valores relevante acá, sin import cycle (mismo patrón que
// mapLegacyDetraccionesStatusForMigration arriba).
func declarationProgressFromStatusForMigration(status string) int {
	switch status {
	case models.SupervisorDeclPorRevisar:
		return 65
	case models.SupervisorDeclObservado:
		return 40
	case models.SupervisorDeclEntregado:
		return 100
	default:
		return 0
	}
}

// migrateDropNPSTable elimina la tabla supervisor_nps — feature "Nota de Pago SUNAT" sin uso real
// (0 filas en dev y producción, confirmado dos veces contra datos reales; ver
// docs/diseno-limpieza-control-detail-2026-09-16.md §1). No solo se dejó de referenciar en código:
// se decidió DROP explícito en vez de dejarla huérfana.
func migrateDropNPSTable(db *gorm.DB) error {
	if !db.Migrator().HasTable("supervisor_nps") {
		return nil
	}
	return db.Migrator().DropTable("supervisor_nps")
}
