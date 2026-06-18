package models

import (
	"time"

	"gorm.io/gorm"
)

const (
	ActivityParamCompareDate     = "date"
	ActivityParamCompareDateTime = "datetime"
)

// ActivityParam reglas globales de plazo por tipo de actividad de calendario.
type ActivityParam struct {
	ID             uint           `gorm:"primaryKey" json:"id"`
	ActivityType   string         `gorm:"size:30;not null;uniqueIndex:uniq_activity_params_type" json:"activity_type"`
	CompareMode    string         `gorm:"size:10;not null;default:'date'" json:"compare_mode"`
	MaxUploadTime  string         `gorm:"size:5" json:"max_upload_time,omitempty"`
	GraceDays      int            `gorm:"not null;default:0" json:"grace_days"`
	Active         bool           `gorm:"not null;default:true" json:"active"`
	CreatedAt      time.Time      `json:"created_at"`
	UpdatedAt      time.Time      `json:"updated_at"`
	DeletedAt      gorm.DeletedAt `gorm:"index" json:"-"`
}

func (ActivityParam) TableName() string { return "activity_params" }
