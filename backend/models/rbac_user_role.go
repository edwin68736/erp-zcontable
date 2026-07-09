package models

// UserRole asignación usuario ↔ rol (N:M).
type UserRole struct {
	UserID uint `gorm:"primaryKey" json:"user_id"`
	RoleID uint `gorm:"primaryKey" json:"role_id"`
}

func (UserRole) TableName() string { return "user_roles" }
