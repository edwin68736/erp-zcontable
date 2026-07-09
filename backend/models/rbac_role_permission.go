package models

// RolePermission tabla pivote rol ↔ permiso (many2many explícita para migraciones).
type RolePermission struct {
	RoleID       uint `gorm:"primaryKey" json:"role_id"`
	PermissionID uint `gorm:"primaryKey" json:"permission_id"`
}

func (RolePermission) TableName() string { return "role_permissions" }
