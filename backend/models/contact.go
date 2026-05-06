package models

import (
	"time"

	"gorm.io/gorm"
)

// Contact representa un responsable dentro de una empresa
type Contact struct {
	ID         uint           `gorm:"primaryKey" json:"id"`
	CompanyID  uint           `gorm:"not null;index" json:"company_id"`
	FullName   string         `gorm:"size:255;not null" json:"full_name"`
	Position   string         `gorm:"size:255;not null" json:"position"` // Cargo en la empresa
	Phone      string         `gorm:"size:50;not null" json:"phone"`
	Email      string         `gorm:"size:255;not null" json:"email"`
	Notes      string         `gorm:"type:text" json:"notes"`
	Priority   string         `gorm:"size:50" json:"priority"` // Alta/Media/Baja, etc.
	CreatedAt  time.Time      `json:"created_at"`
	UpdatedAt  time.Time      `json:"updated_at"`
	DeletedAt  gorm.DeletedAt `gorm:"index" json:"-"`

	Company *Company `gorm:"foreignKey:CompanyID" json:"company,omitempty"`
}

func (Contact) TableName() string {
	return "contacts"
}

