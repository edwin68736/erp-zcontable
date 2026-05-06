package models

import (
	"time"
)

// DocumentItem es una línea de detalle de una deuda (documento manual); permite enlazar un producto del catálogo.
type DocumentItem struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	DocumentID  uint      `gorm:"not null;index" json:"document_id"`
	ProductID   *uint     `gorm:"index" json:"product_id,omitempty"`
	Description string    `gorm:"type:text;not null" json:"description"`
	Quantity    float64   `gorm:"type:decimal(15,4);not null;default:1" json:"quantity"`
	UnitPrice   float64   `gorm:"type:decimal(15,2);not null;default:0" json:"unit_price"`
	Amount      float64   `gorm:"type:decimal(15,2);not null" json:"amount"`
	SortOrder   int       `gorm:"not null;default:0" json:"sort_order"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`

	Product *Product `gorm:"foreignKey:ProductID" json:"product,omitempty"`
}

func (DocumentItem) TableName() string {
	return "document_items"
}
