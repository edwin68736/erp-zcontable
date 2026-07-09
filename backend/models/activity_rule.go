package models

import (
	"time"

	"gorm.io/gorm"
)

const (
	ActivityRuleCompareDate     = "date"
	ActivityRuleCompareDateTime = "datetime"
)

// ActivityRule regla reutilizable de cumplimiento (compare_mode, gracia, hora límite).
type ActivityRule struct {
	ID            uint           `gorm:"primaryKey" json:"id"`
	Name          string         `gorm:"size:100;not null" json:"name"`
	Description   string         `gorm:"type:text" json:"description,omitempty"`
	CompareMode   string         `gorm:"size:10;not null;default:'date'" json:"compare_mode"`
	MaxUploadTime string         `gorm:"size:5" json:"max_upload_time,omitempty"`
	GraceDays     int            `gorm:"not null;default:0" json:"grace_days"`
	Active        bool           `gorm:"not null;default:true" json:"active"`
	CreatedAt     time.Time      `json:"created_at"`
	UpdatedAt     time.Time      `json:"updated_at"`
	DeletedAt     gorm.DeletedAt `gorm:"index" json:"-"`
}

func (ActivityRule) TableName() string { return "activity_rules" }
