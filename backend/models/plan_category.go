package models

import (
	"time"

	"gorm.io/gorm"
)

// PlanCategory agrupa planes comerciales (ej. clientes legacy vs nuevos).
type PlanCategory struct {
	ID          uint           `gorm:"primaryKey" json:"id"`
	Code        string         `gorm:"size:50;not null;uniqueIndex" json:"code"`
	Name        string         `gorm:"size:255;not null" json:"name"`
	Description string         `gorm:"type:text" json:"description"`
	SortOrder   int            `gorm:"not null;default:0" json:"sort_order"`
	Active      bool           `gorm:"not null;default:true" json:"active"`
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
	DeletedAt   gorm.DeletedAt `gorm:"index" json:"-"`

	Plans []SubscriptionPlan `gorm:"foreignKey:PlanCategoryID" json:"plans,omitempty"`
}

func (PlanCategory) TableName() string {
	return "plan_categories"
}
