package models

import "time"

// Role rol del sistema o personalizado.
type Role struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	Code        string    `gorm:"size:80;not null;uniqueIndex" json:"code"`
	Name        string    `gorm:"size:160;not null" json:"name"`
	Description string    `gorm:"type:text" json:"description,omitempty"`
	IsSystem    bool      `gorm:"not null;default:false" json:"is_system"`
	IsDefault   bool      `gorm:"not null;default:false;index" json:"is_default"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`

	// Contadores solo en listados (no persistidos).
	UserCount       int64 `gorm:"-" json:"user_count"`
	PermissionCount int64 `gorm:"-" json:"permission_count"`

	Permissions []Permission `gorm:"many2many:role_permissions;" json:"permissions,omitempty"`
}

func (Role) TableName() string { return "roles" }
