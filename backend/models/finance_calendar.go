package models

import (
	"time"

	"gorm.io/gorm"
)

// Tipos de marca en el calendario global.
const (
	CalendarMarkHoliday    = "feriado"
	CalendarMarkFestivity  = "festividad"
	CalendarMarkImportant  = "importante"
)

// Tipos de actividad contable global (vinculan cumplimiento con supervisor_*).
const (
	CalendarActivityNPS        = "nps"
	CalendarActivityPDT601     = "pdt_601"
	CalendarActivityPDT621     = "pdt_621"
	CalendarActivitySIRE       = "sire"
	CalendarActivityPayment    = "payment"
	CalendarActivityLiquidation = "liquidation"
	CalendarActivityReport     = "report"
	CalendarActivityClosing    = "closing"
	CalendarActivityOther      = "other"
)

// FinanceCalendar calendario mensual global de obligaciones contables (no por empresa).
type FinanceCalendar struct {
	ID        uint           `gorm:"primaryKey" json:"id"`
	PeriodYM  string         `gorm:"size:7;not null;uniqueIndex" json:"period_ym"`
	Notes     string         `gorm:"type:text" json:"notes,omitempty"`
	IsClosed  bool           `gorm:"not null;default:false" json:"is_closed"`
	ClosedAt  *time.Time     `json:"closed_at,omitempty"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`

	Marks      []FinanceCalendarMark      `gorm:"foreignKey:CalendarID" json:"marks,omitempty"`
	Activities []FinanceCalendarActivity  `gorm:"foreignKey:CalendarID" json:"activities,omitempty"`
}

func (FinanceCalendar) TableName() string { return "finance_calendars" }

// FinanceCalendarMark feriado, festividad o fecha importante en un día del mes.
type FinanceCalendarMark struct {
	ID         uint           `gorm:"primaryKey" json:"id"`
	CalendarID uint           `gorm:"not null;index" json:"calendar_id"`
	MarkDate   time.Time      `gorm:"type:date;not null;index" json:"mark_date"`
	Kind       string         `gorm:"size:20;not null;default:'importante'" json:"kind"`
	Label      string         `gorm:"size:200;not null" json:"label"`
	CreatedAt  time.Time      `json:"created_at"`
	UpdatedAt  time.Time      `json:"updated_at"`
	DeletedAt  gorm.DeletedAt `gorm:"index" json:"-"`
}

func (FinanceCalendarMark) TableName() string { return "finance_calendar_marks" }

// Estados iniciales de actividad en calendario global.
const (
	CalendarActivityStatusPending    = "pendiente"
	CalendarActivityStatusInProgress = "en_progreso"
	CalendarActivityStatusDone       = "completada"
)

// FinanceCalendarActivity actividad operativa global con rango de días en el mes.
type FinanceCalendarActivity struct {
	ID           uint           `gorm:"primaryKey" json:"id"`
	CalendarID   uint           `gorm:"not null;index" json:"calendar_id"`
	Name         string         `gorm:"size:200;not null" json:"name"`
	Description  string         `gorm:"type:text" json:"description,omitempty"`
	StartDay     int            `gorm:"not null" json:"start_day"`
	EndDay       int            `gorm:"not null" json:"end_day"`
	DueDay       int            `gorm:"not null" json:"due_day"`
	ActivityKind string         `gorm:"size:30;not null;default:'other'" json:"activity_kind"`
	Priority     string         `gorm:"size:20;not null;default:'media'" json:"priority"`
	Status       string         `gorm:"size:20;not null;default:'pendiente'" json:"status"`
	CreatedAt    time.Time      `json:"created_at"`
	UpdatedAt    time.Time      `json:"updated_at"`
	DeletedAt    gorm.DeletedAt `gorm:"index" json:"-"`
}

func (FinanceCalendarActivity) TableName() string { return "finance_calendar_activities" }
