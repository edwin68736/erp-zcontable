package models

import "time"

// Module agrupa permisos por dominio funcional (ERP modular).
type Module struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	Code      string    `gorm:"size:80;not null;uniqueIndex" json:"code"`
	Name      string    `gorm:"size:160;not null" json:"name"`
	Icon      string    `gorm:"size:80" json:"icon"`
	SortOrder int       `gorm:"not null;default:0" json:"sort_order"`
	Active    bool      `gorm:"not null;default:true" json:"active"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`

	Permissions []Permission `gorm:"foreignKey:ModuleID" json:"permissions,omitempty"`
}

func (Module) TableName() string { return "modules" }
