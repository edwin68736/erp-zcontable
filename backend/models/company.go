package models

import (
	"time"

	"gorm.io/gorm"
)

// Company representa una empresa cliente del estudio
type Company struct {
	ID             uint           `gorm:"primaryKey" json:"id"`
	RUC            string         `gorm:"size:20;not null;index" json:"ruc"`
	BusinessName   string         `gorm:"size:255;not null" json:"business_name"`          // Razón social
	InternalCode   string         `gorm:"size:50;not null;uniqueIndex" json:"code"`        // Código interno del estudio
	Status         string         `gorm:"size:50;not null;default:'activo'" json:"status"` // Estado del cliente
	TradeName      string         `gorm:"size:255" json:"trade_name"`                      // Nombre comercial (opcional)
	Address        string         `gorm:"size:255" json:"address"`
	Phone          string         `gorm:"size:50" json:"phone"`
	Email          string         `gorm:"size:255" json:"email"`
	ServiceStartAt *time.Time     `json:"service_start_at"`
	CreatedAt      time.Time      `json:"created_at"`
	UpdatedAt      time.Time      `json:"updated_at"`
	DeletedAt      gorm.DeletedAt `gorm:"index" json:"-"`

	AccountantUserID *uint `gorm:"index" json:"accountant_user_id,omitempty"`
	SupervisorUserID *uint `gorm:"index" json:"supervisor_user_id,omitempty"`
	AssistantUserID  *uint `gorm:"index" json:"assistant_user_id,omitempty"`

	SubscriptionPlanID    *uint      `gorm:"index" json:"subscription_plan_id,omitempty"`
	BillingCycle          string     `gorm:"size:20" json:"billing_cycle"` // start_month | end_month
	SubscriptionStartedAt *time.Time `json:"subscription_started_at,omitempty"`
	SubscriptionEndedAt   *time.Time `json:"subscription_ended_at,omitempty"`
	SubscriptionActive    bool       `gorm:"not null;default:true" json:"subscription_active"`
	DeclaredBillingAmount *float64   `gorm:"type:decimal(15,2)" json:"declared_billing_amount,omitempty"`

	Accountant *User `gorm:"foreignKey:AccountantUserID" json:"accountant,omitempty"`
	Supervisor *User `gorm:"foreignKey:SupervisorUserID" json:"supervisor,omitempty"`
	Assistant  *User `gorm:"foreignKey:AssistantUserID" json:"assistant,omitempty"`

	Contacts         []Contact         `gorm:"foreignKey:CompanyID" json:"contacts,omitempty"`
	Documents        []Document        `gorm:"foreignKey:CompanyID" json:"documents,omitempty"`
	Payments         []Payment         `gorm:"foreignKey:CompanyID" json:"payments,omitempty"`
	SubscriptionPlan *SubscriptionPlan `gorm:"foreignKey:SubscriptionPlanID" json:"subscription_plan,omitempty"`
}

func (Company) TableName() string {
	return "companies"
}
