package models

import "time"

// SunatDueDateCalendarRow fila del cronograma de vencimientos SUNAT (referencia del estudio),
// según el "Cronograma de Obligaciones Tributarias Mensuales" que SUNAT publica cada año: para
// cada periodo (mes) define la fecha límite de declaración/pago según el último dígito del RUC
// del contribuyente (columnas 0-9).
//
// Existen EXACTAMENTE 12 filas fijas (una por mes calendario, Month 1=enero..12=diciembre).
// Nunca se crean ni eliminan filas — solo se editan sus fechas, normalmente una vez al año
// cuando SUNAT publica el cronograma del año siguiente. Ver services.SunatDueDateService.
type SunatDueDateCalendarRow struct {
	ID    uint `gorm:"primaryKey" json:"id"`
	Month int  `gorm:"uniqueIndex;not null" json:"month"` // 1-12

	// DatesJSON array de 10 fechas AAAA-MM-DD (o "" si no definida), índice = dígito del RUC 0-9.
	// Sin DEFAULT a nivel de BD: MySQL no permite valores por defecto en columnas TEXT/BLOB/JSON.
	// Siempre se completa desde el código al crear la fila (ver SunatDueDateService.EnsureSeeded).
	DatesJSON string `gorm:"column:dates_json;type:text;not null" json:"-"`

	UpdatedByUserID *uint     `gorm:"index" json:"updated_by_user_id,omitempty"`
	UpdatedAt       time.Time `json:"updated_at"`

	UpdatedBy *User `gorm:"foreignKey:UpdatedByUserID" json:"updated_by,omitempty"`
}

func (SunatDueDateCalendarRow) TableName() string { return "sunat_due_date_calendar_rows" }
