package models

import (
	"time"

	"gorm.io/gorm"
)

// PlanTier tramo [MinBilling, MaxBilling] con precio mensual. MaxBilling nil = sin tope superior.
type PlanTier struct {
	ID                 uint           `gorm:"primaryKey" json:"id"`
	SubscriptionPlanID uint           `gorm:"not null;index" json:"subscription_plan_id"`
	MinBilling         float64        `gorm:"type:decimal(15,2);not null" json:"min_billing"`
	MaxBilling         *float64       `gorm:"type:decimal(15,2)" json:"max_billing,omitempty"`
	MonthlyPrice       float64        `gorm:"type:decimal(15,2);not null" json:"monthly_price"`
	SortOrder          int            `gorm:"not null;default:0" json:"sort_order"`
	CreatedAt          time.Time      `json:"created_at"`
	UpdatedAt          time.Time      `json:"updated_at"`
	DeletedAt          gorm.DeletedAt `gorm:"index" json:"-"`
}

func (PlanTier) TableName() string {
	return "plan_tiers"
}
