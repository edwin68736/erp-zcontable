package models

import "time"

// SchemaMigration registra migraciones de datos aplicadas una sola vez (idempotencia).
type SchemaMigration struct {
	Name      string    `gorm:"primaryKey;size:128" json:"name"`
	AppliedAt time.Time `json:"applied_at"`
}

func (SchemaMigration) TableName() string { return "schema_migrations" }
