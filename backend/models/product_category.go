package models

import (
	"time"

	"gorm.io/gorm"
)

// ProductCategory agrupa productos/servicios a nivel local (no Tukifac).
type ProductCategory struct {
	ID        uint           `gorm:"primaryKey" json:"id"`
	Name      string         `gorm:"size:255;not null" json:"name"`
	SortOrder int            `gorm:"not null;default:0" json:"sort_order"`
	Active    bool           `gorm:"not null;default:true" json:"active"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}

func (ProductCategory) TableName() string {
	return "product_categories"
}
