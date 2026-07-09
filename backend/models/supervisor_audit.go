package models

import (
	"time"

	"gorm.io/gorm"
)

// SupervisorChangeLog historial de cambios en entidades del módulo.
type SupervisorChangeLog struct {
	ID         uint           `gorm:"primaryKey" json:"id"`
	EntityType string         `gorm:"size:30;not null;index:idx_sup_chlog_ent" json:"entity_type"`
	EntityID   uint           `gorm:"not null;index:idx_sup_chlog_ent" json:"entity_id"`
	FieldName  string         `gorm:"size:80;not null" json:"field_name"`
	OldValue   string         `gorm:"type:text" json:"old_value,omitempty"`
	NewValue   string         `gorm:"type:text" json:"new_value,omitempty"`
	UserID     uint           `gorm:"not null;index" json:"user_id"`
	CreatedAt  time.Time      `json:"created_at"`
	DeletedAt  gorm.DeletedAt `gorm:"index" json:"-"`

	User *User `gorm:"foreignKey:UserID" json:"user,omitempty"`
}

func (SupervisorChangeLog) TableName() string { return "supervisor_change_logs" }

// SupervisorObservation observación sobre control o declaración.
type SupervisorObservation struct {
	ID               uint           `gorm:"primaryKey" json:"id"`
	MonthlyControlID *uint          `gorm:"index" json:"monthly_control_id,omitempty"`
	DeclarationID    *uint          `gorm:"index" json:"declaration_id,omitempty"`
	UserID           uint           `gorm:"not null;index" json:"user_id"`
	Body             string         `gorm:"type:text;not null" json:"body"`
	CreatedAt        time.Time      `json:"created_at"`
	DeletedAt        gorm.DeletedAt `gorm:"index" json:"-"`

	User *User `gorm:"foreignKey:UserID" json:"user,omitempty"`
}

func (SupervisorObservation) TableName() string { return "supervisor_observations" }

// SupervisorAttachment archivo adjunto a control o declaración.
type SupervisorAttachment struct {
	ID               uint           `gorm:"primaryKey" json:"id"`
	MonthlyControlID *uint          `gorm:"index" json:"monthly_control_id,omitempty"`
	DeclarationID    *uint          `gorm:"index" json:"declaration_id,omitempty"`
	FileName         string         `gorm:"size:255;not null" json:"file_name"`
	FileURL          string         `gorm:"size:500;not null" json:"file_url"`
	UploadedByUserID uint           `gorm:"not null;index" json:"uploaded_by_user_id"`
	CreatedAt        time.Time      `json:"created_at"`
	DeletedAt        gorm.DeletedAt `gorm:"index" json:"-"`

	UploadedBy *User `gorm:"foreignKey:UploadedByUserID" json:"uploaded_by,omitempty"`
}

func (SupervisorAttachment) TableName() string { return "supervisor_attachments" }

// SupervisorNotification alerta in-app para usuarios del módulo.
type SupervisorNotification struct {
	ID               uint           `gorm:"primaryKey" json:"id"`
	UserID           uint           `gorm:"not null;index:idx_sup_notif_user_read" json:"user_id"`
	Kind             string         `gorm:"size:40;not null" json:"kind"`
	Title            string         `gorm:"size:200;not null" json:"title"`
	Message          string         `gorm:"type:text;not null" json:"message"`
	PeriodYM         string         `gorm:"size:7;index" json:"period_ym,omitempty"`
	MonthlyControlID *uint          `gorm:"index" json:"monthly_control_id,omitempty"`
	ReadAt           *time.Time     `gorm:"index:idx_sup_notif_user_read" json:"read_at,omitempty"`
	CreatedAt        time.Time      `json:"created_at"`
	DeletedAt        gorm.DeletedAt `gorm:"index" json:"-"`
}

func (SupervisorNotification) TableName() string { return "supervisor_notifications" }
