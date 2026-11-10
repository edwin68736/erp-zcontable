package models

import "time"

// SunatOfficialDueDateRow fila del cronograma OFICIAL de vencimientos de SUNAT («Cronograma de Obligaciones Tributarias
// Mensuales»): para cada periodo (mes) la fecha límite según el último dígito del RUC (0-9).
//
// Es distinto del calendario del estudio (SunatDueDateCalendarRow), que son las fechas internas con las que trabaja el
// estudio (y con las que se evalúan, por ejemplo, las declaraciones PDT 621). Ambos tienen exactamente 12 filas fijas
// (Month 1-12) que solo se editan; el administrador edita las dos con el mismo permiso.
type SunatOfficialDueDateRow struct {
	ID        uint   `gorm:"primaryKey" json:"id"`
	Month     int    `gorm:"uniqueIndex;not null" json:"month"`
	DatesJSON string `gorm:"column:dates_json;type:text;not null" json:"-"`

	UpdatedByUserID *uint     `gorm:"index" json:"updated_by_user_id,omitempty"`
	UpdatedAt       time.Time `json:"updated_at"`

	UpdatedBy *User `gorm:"foreignKey:UpdatedByUserID" json:"updated_by,omitempty"`
}

func (SunatOfficialDueDateRow) TableName() string { return "sunat_official_due_date_rows" }
