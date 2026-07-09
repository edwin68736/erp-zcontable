package models

import "time"

// DocumentConsolidationLog auditoría reversible de fusiones / promociones legacy.
type DocumentConsolidationLog struct {
	ID                 uint      `gorm:"primaryKey" json:"id"`
	MigrationName      string    `gorm:"size:80;not null;index" json:"migration_name"`
	Action             string    `gorm:"size:50;not null" json:"action"` // merge_legacy, promote_liq, migrate_allocation, backfill_receipt, fix_balance
	LegacyDocumentID   *uint     `gorm:"index" json:"legacy_document_id,omitempty"`
	CanonicalDocumentID *uint    `gorm:"index" json:"canonical_document_id,omitempty"`
	RelatedID          *uint     `json:"related_id,omitempty"` // payment_id, receipt_id, line_id, etc.
	DetailsJSON        string    `gorm:"type:text" json:"details_json,omitempty"`
	AppliedAt          time.Time `json:"applied_at"`
}

func (DocumentConsolidationLog) TableName() string {
	return "document_consolidation_logs"
}
