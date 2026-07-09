package models

import "time"

const (
	ActivityParamAuditCreate = "create"
	ActivityParamAuditUpdate = "update"
	ActivityParamAuditDelete = "delete"
)

// ActivityParamAudit historial de cambios en parametrización de actividades.
type ActivityParamAudit struct {
	ID              uint      `gorm:"primaryKey" json:"id"`
	ActivityParamID uint      `gorm:"not null;index" json:"activity_param_id"`
	UserID          uint      `gorm:"not null;index" json:"user_id"`
	Action          string    `gorm:"size:20;not null" json:"action"`
	BeforeJSON      string    `gorm:"type:text" json:"before_json,omitempty"`
	AfterJSON       string    `gorm:"type:text" json:"after_json,omitempty"`
	CreatedAt       time.Time `json:"created_at"`
}

func (ActivityParamAudit) TableName() string { return "activity_param_audits" }
