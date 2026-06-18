package models

import (
	"time"

	"gorm.io/gorm"
)

// Prefijo correlativo del catálogo de actividades (AC001, AC002, …).
const ActivityCodePrefix = "AC"

// ActivityTemplate catálogo maestro reutilizable de obligaciones contables.
type ActivityTemplate struct {
	ID            uint           `gorm:"primaryKey" json:"id"`
	Code          string         `gorm:"size:20;not null;uniqueIndex:uniq_activity_templates_code" json:"code"`
	Name          string         `gorm:"size:200;not null;index:idx_activity_templates_sort_name,priority:2" json:"name"`
	Description   string         `gorm:"type:text" json:"description,omitempty"`
	ActivityType  string         `gorm:"size:30;not null;default:'other';index:idx_activity_templates_activity_type" json:"activity_type"`
	Priority      string         `gorm:"size:20;not null;default:'media'" json:"priority"`
	TextColor     string         `gorm:"size:7;not null;default:'#1d4ed8'" json:"text_color"`
	Icon          string         `gorm:"size:80" json:"icon,omitempty"`
	SortOrder     int            `gorm:"not null;default:0;index:idx_activity_templates_sort_name,priority:1" json:"sort_order"`
	IsValidatable bool           `gorm:"not null;default:false" json:"is_validatable"`
	Active        bool           `gorm:"not null;default:true;index:idx_activity_templates_active_deleted,priority:1" json:"active"`
	ActivityRuleID *uint         `gorm:"index" json:"activity_rule_id,omitempty"`
	ActivityRule   *ActivityRule  `gorm:"foreignKey:ActivityRuleID;constraint:OnUpdate:RESTRICT,OnDelete:SET NULL" json:"-"`
	CreatedAt     time.Time      `json:"created_at"`
	UpdatedAt     time.Time      `json:"updated_at"`
	DeletedAt     gorm.DeletedAt `gorm:"index:idx_activity_templates_active_deleted,priority:2" json:"-"`

	CalendarActivities []FinanceCalendarActivity `gorm:"foreignKey:ActivityTemplateID" json:"-"`
}

func (ActivityTemplate) TableName() string { return "activity_templates" }

// ActivityCodeSequence correlativo atómico por prefijo (generación de code ACnnn).
type ActivityCodeSequence struct {
	ID         uint   `gorm:"primaryKey" json:"id"`
	Prefix     string `gorm:"size:10;not null;uniqueIndex" json:"prefix"`
	LastNumber uint   `gorm:"not null;default:0" json:"last_number"`
}

func (ActivityCodeSequence) TableName() string { return "activity_code_sequences" }
