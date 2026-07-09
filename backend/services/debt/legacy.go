package debt

import (
	"miappfiber/models"

	"gorm.io/gorm"
)

const (
	LegacyStatusActive   = ""
	LegacyStatusMerged   = "legacy_merged"
	LegacyStatusArchived = "archived"
	// LegacyStatusPromoted: DEU-LIQ-* promovido a deuda canónica (sin par canónico previo).
	LegacyStatusPromoted = "legacy_promoted"
)

// legacyExcludedStatuses estados excluidos de pendientes legacy / clones activos.
var legacyExcludedStatuses = []string{LegacyStatusMerged, LegacyStatusArchived, LegacyStatusPromoted}

// ScopeActiveDocuments excluye deudas fusionadas/archivadas del dominio operativo.
func ScopeActiveDocuments(db *gorm.DB) *gorm.DB {
	return db.Where(`(documents.legacy_status IS NULL OR documents.legacy_status = '' OR documents.legacy_status NOT IN (?, ?))`,
		LegacyStatusMerged, LegacyStatusArchived)
}

// IsActiveDebt indica si el documento participa en operaciones (pagos, listados, liquidaciones).
func IsActiveDebt(d *models.Document) bool {
	if d == nil {
		return false
	}
	switch d.LegacyStatus {
	case LegacyStatusMerged, LegacyStatusArchived:
		return false
	default:
		return true
	}
}

// IsLegacyDEULIQPending indica DEU-LIQ aún no consolidado (ni fusionado ni promovido).
func IsLegacyDEULIQPending(d *models.Document) bool {
	if d == nil || d.DeletedAt.Valid {
		return false
	}
	if !IsLegacySettlementClone(d) {
		return false
	}
	switch d.LegacyStatus {
	case LegacyStatusMerged, LegacyStatusArchived, LegacyStatusPromoted:
		return false
	default:
		return true
	}
}
