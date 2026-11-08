package models

import "time"

// ExchangeRate tipo de cambio de un día (compra y venta) tal como lo publica SUNAT, guardado en nuestra base para no
// volver a consultarlo. El valor de una fecha es el cierre de la SBS del día hábil anterior (SunatDate).
// Se trae día por día de ApiPeru.dev (que reproduce lo que SUNAT muestra en su calendario).
type ExchangeRate struct {
	ID        uint      `gorm:"primaryKey" json:"-"`
	Currency  string    `gorm:"size:3;not null;uniqueIndex:ux_exchange_rate,priority:1" json:"currency"` // USD | EUR
	Date      string    `gorm:"size:10;not null;uniqueIndex:ux_exchange_rate,priority:2" json:"date"`    // AAAA-MM-DD
	Buy       float64   `gorm:"type:decimal(10,4);not null" json:"compra"`
	Sell      float64   `gorm:"type:decimal(10,4);not null" json:"venta"`
	SunatDate string    `gorm:"size:10" json:"fecha_sunat"` // día hábil cuyo cierre rige en Date
	Source    string    `gorm:"size:20;not null;default:'apiperu'" json:"-"`
	FetchedAt time.Time `json:"fetched_at"`
}

func (ExchangeRate) TableName() string { return "exchange_rates" }
