package database

import (
	"fmt"

	"miappfiber/models"

	"gorm.io/gorm"
)

const migCompaniesClientTypeEstudio = "companies_v1_backfill_client_type_estudio"

// RunCompanyMigrations migraciones de datos de empresas (idempotentes).
func RunCompanyMigrations(db *gorm.DB) error {
	if err := db.AutoMigrate(&models.SchemaMigration{}); err != nil {
		return err
	}
	steps := []struct {
		name string
		fn   func(*gorm.DB) error
	}{
		{migCompaniesClientTypeEstudio, migrateCompaniesClientTypeEstudio},
	}
	for _, step := range steps {
		if err := applyMigrationOnce(db, step.name, step.fn); err != nil {
			return fmt.Errorf("%s: %w", step.name, err)
		}
	}
	return nil
}

func migrateCompaniesClientTypeEstudio(db *gorm.DB) error {
	return db.Model(&models.Company{}).
		Where("client_type = '' OR client_type IS NULL").
		Update("client_type", models.CompanyClientTypeEstudio).Error
}
