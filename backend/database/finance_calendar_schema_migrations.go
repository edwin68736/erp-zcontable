package database

import (
	"fmt"
	"strings"

	"gorm.io/gorm"
)

const migEnforceCalendarActivityNotNull = "finance_calendar_activities_v9_enforce_not_null"

type calendarColumnSpec struct {
	Name         string
	AlterSQL     string
	NullableData string // UPDATE ... WHERE col IS NULL (optional)
}

var calendarActivityNotNullSpecs = []calendarColumnSpec{
	{
		Name:     "activity_template_id",
		AlterSQL: "ALTER TABLE finance_calendar_activities MODIFY COLUMN activity_template_id bigint(20) unsigned NOT NULL",
	},
	{
		Name:     "name_snapshot",
		AlterSQL: "ALTER TABLE finance_calendar_activities MODIFY COLUMN name_snapshot varchar(200) NOT NULL",
	},
	{
		Name:     "activity_type_snapshot",
		AlterSQL: "ALTER TABLE finance_calendar_activities MODIFY COLUMN activity_type_snapshot varchar(30) NOT NULL",
		NullableData: `UPDATE finance_calendar_activities SET activity_type_snapshot = 'other'
			WHERE activity_type_snapshot IS NULL OR TRIM(activity_type_snapshot) = ''`,
	},
	{
		Name:     "priority_snapshot",
		AlterSQL: "ALTER TABLE finance_calendar_activities MODIFY COLUMN priority_snapshot varchar(20) NOT NULL",
		NullableData: `UPDATE finance_calendar_activities SET priority_snapshot = 'media'
			WHERE priority_snapshot IS NULL OR TRIM(priority_snapshot) = ''`,
	},
	{
		Name:     "text_color_snapshot",
		AlterSQL: "ALTER TABLE finance_calendar_activities MODIFY COLUMN text_color_snapshot varchar(7) NOT NULL",
		NullableData: `UPDATE finance_calendar_activities SET text_color_snapshot = '#1d4ed8'
			WHERE text_color_snapshot IS NULL OR TRIM(text_color_snapshot) = ''`,
	},
}

// CalendarActivitySchemaColumn estado NULLability de una columna en MySQL.
type CalendarActivitySchemaColumn struct {
	Column       string `json:"column"`
	Nullable     bool   `json:"nullable"`
	ModelNotNull bool   `json:"model_not_null"`
	Matches      bool   `json:"matches"`
}

// CalendarActivitySchemaAudit comparación esquema físico vs modelo Go.
type CalendarActivitySchemaAudit struct {
	TableExists        bool                           `json:"table_exists"`
	Columns            []CalendarActivitySchemaColumn `json:"columns"`
	SchemaMatchesModel bool                           `json:"schema_matches_model"`
	Issues             []string                       `json:"issues,omitempty"`
}

// AuditFinanceCalendarActivitySchema verifica NULLability de columnas alineadas al modelo.
func AuditFinanceCalendarActivitySchema(db *gorm.DB) (*CalendarActivitySchemaAudit, error) {
	out := &CalendarActivitySchemaAudit{
		Columns: make([]CalendarActivitySchemaColumn, 0, len(calendarActivityNotNullSpecs)),
	}
	if !db.Migrator().HasTable("finance_calendar_activities") {
		out.Issues = append(out.Issues, "tabla finance_calendar_activities no existe")
		return out, nil
	}
	out.TableExists = true

	for _, spec := range calendarActivityNotNullSpecs {
		nullable, err := columnIsNullable(db, "finance_calendar_activities", spec.Name)
		if err != nil {
			return nil, fmt.Errorf("columna %s: %w", spec.Name, err)
		}
		matches := !nullable
		out.Columns = append(out.Columns, CalendarActivitySchemaColumn{
			Column:       spec.Name,
			Nullable:     nullable,
			ModelNotNull: true,
			Matches:      matches,
		})
		if !matches {
			out.Issues = append(out.Issues, fmt.Sprintf("%s permite NULL en BD pero el modelo exige NOT NULL", spec.Name))
		}
	}
	out.SchemaMatchesModel = out.TableExists && len(out.Issues) == 0
	return out, nil
}

func columnIsNullable(db *gorm.DB, table, column string) (bool, error) {
	var nullable string
	err := db.Raw(`
		SELECT IS_NULLABLE FROM information_schema.COLUMNS
		WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
		LIMIT 1
	`, table, column).Scan(&nullable).Error
	if err != nil {
		return false, err
	}
	if strings.TrimSpace(nullable) == "" {
		return false, fmt.Errorf("columna no encontrada en information_schema")
	}
	return strings.EqualFold(nullable, "YES"), nil
}

func enforceFinanceCalendarActivityNotNull(db *gorm.DB) error {
	if !db.Migrator().HasTable("finance_calendar_activities") {
		return nil
	}

	var nullTemplateID int64
	if err := db.Table("finance_calendar_activities").Where("activity_template_id IS NULL").Count(&nullTemplateID).Error; err != nil {
		return err
	}
	if nullTemplateID > 0 {
		return fmt.Errorf("no se puede aplicar NOT NULL: %d filas con activity_template_id NULL", nullTemplateID)
	}

	var nullName int64
	if err := db.Table("finance_calendar_activities").Where("name_snapshot IS NULL OR TRIM(name_snapshot) = ''").Count(&nullName).Error; err != nil {
		return err
	}
	if nullName > 0 {
		return fmt.Errorf("no se puede aplicar NOT NULL: %d filas con name_snapshot vacío o NULL", nullName)
	}

	for _, spec := range calendarActivityNotNullSpecs {
		nullable, err := columnIsNullable(db, "finance_calendar_activities", spec.Name)
		if err != nil {
			return err
		}
		if !nullable {
			continue
		}
		if spec.NullableData != "" {
			if err := db.Exec(spec.NullableData).Error; err != nil {
				return fmt.Errorf("backfill %s: %w", spec.Name, err)
			}
		}
		if err := db.Exec(spec.AlterSQL).Error; err != nil {
			return fmt.Errorf("alter %s: %w", spec.Name, err)
		}
	}
	return nil
}

// PendingCalendarActivityNotNullAlters devuelve ALTER pendientes (columnas aún nullable).
func PendingCalendarActivityNotNullAlters(db *gorm.DB) ([]string, error) {
	if !db.Migrator().HasTable("finance_calendar_activities") {
		return nil, nil
	}
	var pending []string
	for _, spec := range calendarActivityNotNullSpecs {
		nullable, err := columnIsNullable(db, "finance_calendar_activities", spec.Name)
		if err != nil {
			return nil, err
		}
		if nullable {
			pending = append(pending, spec.AlterSQL)
		}
	}
	return pending, nil
}
