package models

import "time"

const ActivityTemplateBackfillMigrationName = "activity_templates_v1_backfill_calendar_activities"

// ActivityTemplateBackfillLog auditoría por instancia tocada en backfill (rollback).
type ActivityTemplateBackfillLog struct {
	ID             uint      `gorm:"primaryKey" json:"id"`
	ActivityID     uint      `gorm:"not null;index:idx_backfill_log_activity" json:"activity_id"`
	TemplateID     uint      `gorm:"not null;index:idx_backfill_log_template" json:"template_id"`
	TemplateCode   string    `gorm:"size:20;not null" json:"template_code"`
	Action         string    `gorm:"size:32;not null" json:"action"` // linked | snapshot_filled
	MigrationName  string    `gorm:"size:128;not null;index" json:"migration_name"`
	CreatedAt      time.Time `json:"created_at"`
}

func (ActivityTemplateBackfillLog) TableName() string {
	return "activity_template_backfill_log"
}
