package models

import "time"

type CompanyAssignment struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	UserID    uint      `gorm:"not null;index;uniqueIndex:ux_user_company" json:"user_id"`
	CompanyID uint      `gorm:"not null;index;uniqueIndex:ux_user_company" json:"company_id"`
	CreatedAt time.Time `json:"created_at"`
}

func (CompanyAssignment) TableName() string {
	return "company_assignments"
}
