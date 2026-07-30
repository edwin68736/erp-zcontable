package database

import (
	"time"

	"miappfiber/models"

	"gorm.io/gorm"
)

// applyMigrationOnce ejecuta `fn` una sola vez (registrada en schema_migrations por nombre).
// Helper compartido por las migraciones de datos de otros módulos (supervisores, actividades,
// empresas). El RBAC ya no usa migraciones puntuales: su matriz se reconcilia en cada arranque
// desde la fuente única (ver rbac/registry.go y database/rbac_seed.go).
func applyMigrationOnce(db *gorm.DB, name string, fn func(*gorm.DB) error) error {
	var n int64
	if err := db.Model(&models.SchemaMigration{}).Where("name = ?", name).Count(&n).Error; err != nil {
		return err
	}
	if n > 0 {
		return nil
	}
	if err := fn(db); err != nil {
		return err
	}
	return db.Create(&models.SchemaMigration{Name: name, AppliedAt: time.Now()}).Error
}
