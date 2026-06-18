package models

import "time"

const (
	ActivityRuleAuditCreate = "create"
	ActivityRuleAuditUpdate = "update"
	ActivityRuleAuditDelete = "delete"
)

// ActivityRuleAudit historial de cambios en reglas de cumplimiento.
type ActivityRuleAudit struct {
	ID             uint      `gorm:"primaryKey" json:"id"`
	ActivityRuleID uint      `gorm:"not null;index" json:"activity_rule_id"`
	UserID         uint      `gorm:"not null;index" json:"user_id"`
	Action         string    `gorm:"size:20;not null" json:"action"`
	BeforeJSON     string    `gorm:"type:text" json:"before_json,omitempty"`
	AfterJSON      string    `gorm:"type:text" json:"after_json,omitempty"`
	CreatedAt      time.Time `json:"created_at"`
}

func (ActivityRuleAudit) TableName() string { return "activity_rule_audits" }
