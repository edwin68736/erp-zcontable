package models

import (
	"time"

	"gorm.io/gorm"
)

// Estados por buzón (SUNAT / SUNAFIL) en capturas semanales.
const (
	SupervisorMailboxStatusPendiente  = "pendiente"
	SupervisorMailboxStatusCargado    = "cargado"
	SupervisorMailboxStatusVerificado = "verificado"
	SupervisorMailboxStatusParcial    = "parcial"
)

const (
	SupervisorMailboxTypeSunat  = "sunat"
	SupervisorMailboxTypeSunafil = "sunafil"
)

// SupervisorMailboxCaptureSlot carga semanal de capturas de buzón SUNAT y SUNAFIL por empresa.
type SupervisorMailboxCaptureSlot struct {
	ID               uint           `gorm:"primaryKey" json:"id"`
	MonthlyControlID uint           `gorm:"not null;uniqueIndex:idx_mailbox_slot_week,priority:1" json:"monthly_control_id"`
	WeekStart        time.Time      `gorm:"type:date;not null;uniqueIndex:idx_mailbox_slot_week,priority:2" json:"week_start"`
	SlotIndex        int            `gorm:"not null;uniqueIndex:idx_mailbox_slot_week,priority:3" json:"slot_index"`
	SlotsPerWeek     int            `gorm:"not null" json:"slots_per_week"`

	SunatStatus  string `gorm:"size:20;not null;default:'pendiente'" json:"sunat_status"`
	SunafilStatus string `gorm:"size:20;not null;default:'pendiente'" json:"sunafil_status"`

	SunatAttachmentID   *uint `gorm:"index" json:"sunat_attachment_id,omitempty"`
	SunafilAttachmentID *uint `gorm:"index" json:"sunafil_attachment_id,omitempty"`

	SunatUploadedByUserID   *uint      `gorm:"index" json:"sunat_uploaded_by_user_id,omitempty"`
	SunatUploadedAt         *time.Time `json:"sunat_uploaded_at,omitempty"`
	SunafilUploadedByUserID *uint      `gorm:"index" json:"sunafil_uploaded_by_user_id,omitempty"`
	SunafilUploadedAt       *time.Time `json:"sunafil_uploaded_at,omitempty"`

	SunatVerifiedByUserID   *uint      `gorm:"index" json:"sunat_verified_by_user_id,omitempty"`
	SunatVerifiedAt         *time.Time `json:"sunat_verified_at,omitempty"`
	SunafilVerifiedByUserID *uint      `gorm:"index" json:"sunafil_verified_by_user_id,omitempty"`
	SunafilVerifiedAt       *time.Time `json:"sunafil_verified_at,omitempty"`

	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`

	MonthlyControl    *SupervisorMonthlyControl `gorm:"foreignKey:MonthlyControlID" json:"-"`
	SunatAttachment   *SupervisorAttachment     `gorm:"foreignKey:SunatAttachmentID" json:"-"`
	SunafilAttachment *SupervisorAttachment     `gorm:"foreignKey:SunafilAttachmentID" json:"-"`
}

func (SupervisorMailboxCaptureSlot) TableName() string {
	return "supervisor_mailbox_capture_slots"
}
