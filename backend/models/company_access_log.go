package models

import "time"

// CompanyAccessLog bitácora de accesos a portales externos (SUNAT, etc.) generados desde ZContable con
// las credenciales guardadas de una empresa. Nunca guarda claves ni enlaces — solo quién, a qué empresa,
// a qué portal y si salió bien.
type CompanyAccessLog struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	CompanyID uint      `gorm:"not null;index" json:"company_id"`
	UserID    uint      `gorm:"not null;index" json:"user_id"`
	Target    string    `gorm:"size:20;not null" json:"target"` // sunat
	Status    string    `gorm:"size:10;not null" json:"status"` // ok | error
	ErrorCode string    `gorm:"size:40" json:"error_code,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

func (CompanyAccessLog) TableName() string { return "company_access_logs" }
