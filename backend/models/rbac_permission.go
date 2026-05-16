package models

import "time"

// Permission código único global module.action (ej. companies.view).
type Permission struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	ModuleID    uint      `gorm:"not null;index" json:"module_id"`
	Code        string    `gorm:"size:120;not null;uniqueIndex" json:"code"`
	Action      string    `gorm:"size:50;not null" json:"action"`
	Name        string    `gorm:"size:160;not null" json:"name"`
	Description string    `gorm:"type:text" json:"description,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`

	Module *Module `gorm:"foreignKey:ModuleID" json:"module,omitempty"`
}

func (Permission) TableName() string { return "permissions" }
