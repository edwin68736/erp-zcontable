package models

import (
	"time"

	"gorm.io/gorm"
)

// FiscalDocumentSeries controla serie y correlativo local por tipo de comprobante (SUNAT).
type FiscalDocumentSeries struct {
	ID            uint           `gorm:"primaryKey" json:"id"`
	Name          string         `gorm:"size:120;not null" json:"name"`
	SunatCode     string         `gorm:"size:2;not null;uniqueIndex:idx_fiscal_series_sunat_series,priority:1" json:"sunat_code"`
	Series        string         `gorm:"size:20;not null;uniqueIndex:idx_fiscal_series_sunat_series,priority:2" json:"series"`
	CurrentNumber int            `gorm:"not null;default:0" json:"current_number"`
	Active        bool           `gorm:"not null;default:true" json:"active"`
	Description   string         `gorm:"size:500" json:"description,omitempty"`
	CreatedAt     time.Time      `json:"created_at"`
	UpdatedAt     time.Time      `json:"updated_at"`
	DeletedAt     gorm.DeletedAt `gorm:"index" json:"-"`
}

func (FiscalDocumentSeries) TableName() string {
	return "fiscal_document_series"
}
