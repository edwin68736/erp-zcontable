package database

import (
	"fmt"

	"miappfiber/models"

	"gorm.io/gorm"
)

const migCompaniesClientTypeEstudio = "companies_v1_backfill_client_type_estudio"
const migCompaniesDropInternalCodeUniqueIndex = "companies_v2_drop_internal_code_unique_index"

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
		{migCompaniesDropInternalCodeUniqueIndex, migrateCompaniesDropInternalCodeUniqueIndex},
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

// migrateCompaniesDropInternalCodeUniqueIndex elimina el índice único global sobre
// `internal_code` (creado por una versión anterior del modelo, con el tag `uniqueIndex`). El
// código de empresa ahora solo debe ser único entre empresas ACTIVAS — esa regla se valida en
// código (services/company_service.go), no con un constraint de BD, así que el índice único
// global debe desaparecer para permitir reasignar el código de una empresa inactiva a otra.
func migrateCompaniesDropInternalCodeUniqueIndex(db *gorm.DB) error {
	var exists int64
	if err := db.Raw(
		`SELECT count(*) FROM information_schema.statistics
		 WHERE table_schema = DATABASE() AND table_name = 'companies' AND index_name = 'idx_companies_internal_code'`,
	).Scan(&exists).Error; err != nil {
		return err
	}
	if exists == 0 {
		return nil
	}
	return db.Exec("ALTER TABLE companies DROP INDEX idx_companies_internal_code").Error
}
