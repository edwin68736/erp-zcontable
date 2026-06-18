package database

import (
	"errors"
	"fmt"
	"strings"

	"miappfiber/models"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const migActivityCodeSequenceSeed = "activity_templates_v1_seed_code_sequence"
const migDropCalendarActivityLegacyCols = "finance_calendar_activities_v9_drop_legacy_columns"
const migRepairCalendarTemplateFK = "finance_calendar_activities_v10_repair_template_fk"

// PrepareActivityTemplateSchema repara datos huérfanos antes de AutoMigrate (FK activity_template_id).
func PrepareActivityTemplateSchema(db *gorm.DB) error {
	if !db.Migrator().HasTable("finance_calendar_activities") {
		return nil
	}
	if err := db.AutoMigrate(&models.ActivityTemplate{}, &models.ActivityCodeSequence{}); err != nil {
		return fmt.Errorf("activity_templates pre-migrate: %w", err)
	}
	if err := seedActivityCodeSequence(db); err != nil {
		return err
	}
	return repairCalendarActivityTemplateFK(db)
}

// RunActivityTemplateMigrations migraciones idempotentes del catálogo de actividades.
func RunActivityTemplateMigrations(db *gorm.DB) error {
	if err := db.AutoMigrate(&models.SchemaMigration{}); err != nil {
		return err
	}
	steps := []struct {
		name string
		fn   func(*gorm.DB) error
	}{
		{migActivityCodeSequenceSeed, seedActivityCodeSequence},
		{migDropCalendarActivityLegacyCols, dropFinanceCalendarActivityLegacyColumns},
		{migRepairCalendarTemplateFK, repairCalendarActivityTemplateFK},
		{migEnforceCalendarActivityNotNull, enforceFinanceCalendarActivityNotNull},
	}
	for _, step := range steps {
		if err := applyMigrationOnce(db, step.name, step.fn); err != nil {
			return fmt.Errorf("%s: %w", step.name, err)
		}
	}
	return nil
}

func seedActivityCodeSequence(db *gorm.DB) error {
	var n int64
	if err := db.Model(&models.ActivityCodeSequence{}).
		Where("prefix = ?", models.ActivityCodePrefix).
		Count(&n).Error; err != nil {
		return err
	}
	if n > 0 {
		return nil
	}
	return db.Create(&models.ActivityCodeSequence{
		Prefix:     models.ActivityCodePrefix,
		LastNumber: 0,
	}).Error
}

func dropFinanceCalendarActivityLegacyColumns(db *gorm.DB) error {
	if !db.Migrator().HasTable("finance_calendar_activities") {
		return nil
	}
	legacyCols := []string{"name", "description", "activity_kind", "priority", "text_color"}
	for _, col := range legacyCols {
		if db.Migrator().HasColumn("finance_calendar_activities", col) {
			if err := db.Migrator().DropColumn("finance_calendar_activities", col); err != nil {
				return fmt.Errorf("drop column %s: %w", col, err)
			}
		}
	}
	return nil
}

type calendarActivityOrphanRow struct {
	ID           uint
	Name         string
	ActivityKind string
	Priority     string
	TextColor    string
	NameSnap     string
	TypeSnap     string
	PrioritySnap string
	ColorSnap    string
}

func repairCalendarActivityTemplateFK(db *gorm.DB) error {
	if !db.Migrator().HasTable("finance_calendar_activities") {
		return nil
	}
	if err := backfillCalendarActivitySnapshotsFromLegacy(db); err != nil {
		return err
	}
	orphans, err := loadCalendarActivityTemplateOrphans(db)
	if err != nil {
		return err
	}
	for _, row := range orphans {
		if err := linkCalendarActivityToTemplate(db, row); err != nil {
			return fmt.Errorf("actividad calendario %d: %w", row.ID, err)
		}
	}
	return nil
}

func backfillCalendarActivitySnapshotsFromLegacy(db *gorm.DB) error {
	if !db.Migrator().HasColumn("finance_calendar_activities", "name") {
		return nil
	}
	return db.Exec(`
		UPDATE finance_calendar_activities SET
			name_snapshot = COALESCE(NULLIF(TRIM(name_snapshot), ''), NULLIF(TRIM(name), ''), 'Actividad'),
			activity_type_snapshot = COALESCE(NULLIF(TRIM(activity_type_snapshot), ''), NULLIF(TRIM(activity_kind), ''), 'other'),
			priority_snapshot = COALESCE(NULLIF(TRIM(priority_snapshot), ''), NULLIF(TRIM(priority), ''), 'media'),
			text_color_snapshot = COALESCE(NULLIF(TRIM(text_color_snapshot), ''), NULLIF(TRIM(text_color), ''), '#1d4ed8')
	`).Error
}

func loadCalendarActivityTemplateOrphans(db *gorm.DB) ([]calendarActivityOrphanRow, error) {
	var rows []calendarActivityOrphanRow
	q := db.Unscoped().Table("finance_calendar_activities AS a").
		Joins("LEFT JOIN activity_templates t ON t.id = a.activity_template_id AND t.deleted_at IS NULL").
		Where("a.activity_template_id = 0 OR a.activity_template_id IS NULL OR t.id IS NULL")
	if db.Migrator().HasColumn("finance_calendar_activities", "name") {
		q = q.Select(`
			a.id,
			COALESCE(NULLIF(TRIM(a.name_snapshot), ''), NULLIF(TRIM(a.name), ''), '') AS name_snap,
			COALESCE(NULLIF(TRIM(a.activity_type_snapshot), ''), NULLIF(TRIM(a.activity_kind), ''), '') AS type_snap,
			COALESCE(NULLIF(TRIM(a.priority_snapshot), ''), NULLIF(TRIM(a.priority), ''), '') AS priority_snap,
			COALESCE(NULLIF(TRIM(a.text_color_snapshot), ''), NULLIF(TRIM(a.text_color), ''), '') AS color_snap,
			COALESCE(a.name, '') AS name,
			COALESCE(a.activity_kind, '') AS activity_kind,
			COALESCE(a.priority, '') AS priority,
			COALESCE(a.text_color, '') AS text_color`)
	} else {
		q = q.Select(`
			a.id,
			COALESCE(a.name_snapshot, '') AS name_snap,
			COALESCE(a.activity_type_snapshot, '') AS type_snap,
			COALESCE(a.priority_snapshot, '') AS priority_snap,
			COALESCE(a.text_color_snapshot, '') AS color_snap`)
	}
	if err := q.Scan(&rows).Error; err != nil {
		return nil, err
	}
	return rows, nil
}

func linkCalendarActivityToTemplate(db *gorm.DB, row calendarActivityOrphanRow) error {
	name := firstNonEmptyString(row.NameSnap, row.Name, "Actividad")
	activityType := firstNonEmptyString(row.TypeSnap, row.ActivityKind, models.CalendarActivityOther)
	priority := firstNonEmptyString(row.PrioritySnap, row.Priority, "media")
	textColor := normalizeCalendarTextColor(firstNonEmptyString(row.ColorSnap, row.TextColor, "#1d4ed8"))

	return db.Transaction(func(tx *gorm.DB) error {
		tpl, err := findOrCreateActivityTemplateForCalendar(tx, name, activityType, priority, textColor)
		if err != nil {
			return err
		}
		return tx.Unscoped().Model(&models.FinanceCalendarActivity{}).Where("id = ?", row.ID).Updates(map[string]interface{}{
			"activity_template_id":   tpl.ID,
			"name_snapshot":          name,
			"activity_type_snapshot": activityType,
			"priority_snapshot":      priority,
			"text_color_snapshot":    textColor,
		}).Error
	})
}

func findOrCreateActivityTemplateForCalendar(tx *gorm.DB, name, activityType, priority, textColor string) (*models.ActivityTemplate, error) {
	var tpl models.ActivityTemplate
	err := tx.Where("name = ? AND activity_type = ?", name, activityType).First(&tpl).Error
	if err == nil {
		return &tpl, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	code, err := reserveNextActivityTemplateCode(tx)
	if err != nil {
		return nil, err
	}
	tpl = models.ActivityTemplate{
		Code:         code,
		Name:         name,
		ActivityType: activityType,
		Priority:     priority,
		TextColor:    textColor,
		Active:       true,
	}
	if err := tx.Create(&tpl).Error; err != nil {
		return nil, err
	}
	return &tpl, nil
}

func reserveNextActivityTemplateCode(tx *gorm.DB) (string, error) {
	var seq models.ActivityCodeSequence
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("prefix = ?", models.ActivityCodePrefix).
		First(&seq).Error
	if err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return "", err
		}
		seq = models.ActivityCodeSequence{Prefix: models.ActivityCodePrefix, LastNumber: 0}
		if err := tx.Create(&seq).Error; err != nil {
			return "", err
		}
	}
	seq.LastNumber++
	if err := tx.Save(&seq).Error; err != nil {
		return "", err
	}
	return fmt.Sprintf("%s%d", models.ActivityCodePrefix, seq.LastNumber), nil
}

func firstNonEmptyString(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

func normalizeCalendarTextColor(c string) string {
	c = strings.ToLower(strings.TrimSpace(c))
	if len(c) == 7 && strings.HasPrefix(c, "#") {
		return c
	}
	return "#1d4ed8"
}
