package models

import (
	"time"

	"gorm.io/gorm"
)

// BillingBasis: manual = DeclaredBillingAmount empresa;
// documents_month_sum = suma documentos manuales emitidos en el mes de liquidación (proxy operativo).
const (
	BillingBasisManual              = "manual"
	BillingBasisDocumentsMonthSum   = "documents_month_sum"
)

// SubscriptionPlan plan de mensualidad con tramos por facturación.
type SubscriptionPlan struct {
	ID             uint           `gorm:"primaryKey" json:"id"`
	PlanCategoryID uint           `gorm:"not null;index" json:"plan_category_id"` // explícito para API JSON
	Name           string         `gorm:"size:255;not null" json:"name"`
	Description    string         `gorm:"type:text" json:"description"`
	BillingBasis   string         `gorm:"size:50;not null;default:'manual'" json:"billing_basis"`
	Active         bool           `gorm:"not null;default:true" json:"active"`
	CreatedAt      time.Time      `json:"created_at"`
	UpdatedAt      time.Time      `json:"updated_at"`
	DeletedAt      gorm.DeletedAt `gorm:"index" json:"-"`

	PlanCategory *PlanCategory `gorm:"foreignKey:PlanCategoryID" json:"plan_category,omitempty"`
	Tiers        []PlanTier    `gorm:"foreignKey:SubscriptionPlanID" json:"tiers,omitempty"`
}

func (SubscriptionPlan) TableName() string {
	return "subscription_plans"
}
