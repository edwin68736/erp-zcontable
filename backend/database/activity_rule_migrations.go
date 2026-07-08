package database

import (
	"errors"
	"fmt"
	"strings"

	"miappfiber/models"

	"gorm.io/gorm"
)

const (
	migActivityRulesFromParams              = "activity_rules_v1_migrate_from_params"
	migBackfillCalendarRuleFromTemplate     = "activity_rules_v1_backfill_calendar_from_template"
	migBackfillCalendarRuleFromTemplateV2   = "activity_rules_v2_backfill_calendar_rule_snapshot"
)

// RunActivityRuleMigrations migraciones idempotentes de reglas de cumplimiento.
func RunActivityRuleMigrations(db *gorm.DB) error {
	if err := db.AutoMigrate(&models.SchemaMigration{}); err != nil {
		return err
	}
	steps := []struct {
		name string
		fn   func(*gorm.DB) error
	}{
		{migActivityRulesFromParams, migrateActivityParamsToRules},
		{migBackfillCalendarRuleFromTemplate, backfillCalendarActivityRuleFromTemplate},
		{migBackfillCalendarRuleFromTemplateV2, backfillCalendarActivityRuleFromTemplate},
	}
	for _, step := range steps {
		if err := applyMigrationOnce(db, step.name, step.fn); err != nil {
			return fmt.Errorf("%s: %w", step.name, err)
		}
	}
	return nil
}

func ruleNameFromActivityType(activityType string) string {
	switch strings.TrimSpace(activityType) {
	case models.SupervisorDeclDetracciones:
		return "Fecha Simple"
	case "sunat_inbox":
		return "Buzón 10:30"
	default:
		return "Regla " + strings.TrimSpace(activityType)
	}
}

func findOrCreateRuleFromParam(db *gorm.DB, p models.ActivityParam) (uint, error) {
	name := ruleNameFromActivityType(p.ActivityType)
	var rule models.ActivityRule
	err := db.Where("name = ?", name).First(&rule).Error
	if err == nil {
		return rule.ID, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return 0, err
	}
	mode := strings.TrimSpace(p.CompareMode)
	if mode == "" {
		mode = models.ActivityRuleCompareDate
	}
	rule = models.ActivityRule{
		Name:          name,
		Description:   "Migrado desde activity_params",
		CompareMode:   mode,
		MaxUploadTime: strings.TrimSpace(p.MaxUploadTime),
		GraceDays:     p.GraceDays,
		Active:        p.Active,
	}
	if err := db.Create(&rule).Error; err != nil {
		return 0, err
	}
	return rule.ID, nil
}

func migrateActivityParamsToRules(db *gorm.DB) error {
	if !db.Migrator().HasTable("activity_params") {
		return ensureDefaultActivityRule(db)
	}

	var params []models.ActivityParam
	if err := db.Find(&params).Error; err != nil {
		return err
	}

	if len(params) == 0 {
		return ensureDefaultActivityRule(db)
	}

	for _, p := range params {
		ruleID, err := findOrCreateRuleFromParam(db, p)
		if err != nil {
			return err
		}
		activityType := strings.TrimSpace(p.ActivityType)
		if activityType == "" {
			continue
		}
		if err := db.Model(&models.ActivityTemplate{}).
			Where("activity_type = ? AND (activity_rule_id IS NULL OR activity_rule_id = 0)", activityType).
			Update("activity_rule_id", ruleID).Error; err != nil {
			return err
		}
		if err := db.Model(&models.FinanceCalendarActivity{}).
			Where("activity_type_snapshot = ? AND (activity_rule_id IS NULL OR activity_rule_id = 0)", activityType).
			Update("activity_rule_id", ruleID).Error; err != nil {
			return err
		}
	}
	return nil
}

func ensureDefaultActivityRule(db *gorm.DB) error {
	var n int64
	if err := db.Model(&models.ActivityRule{}).Where("name = ?", "Fecha Simple").Count(&n).Error; err != nil {
		return err
	}
	if n > 0 {
		return nil
	}
	return db.Create(&models.ActivityRule{
		Name:        "Fecha Simple",
		Description: "Comparación por fecha de calendario (mismo día = a tiempo)",
		CompareMode: models.ActivityRuleCompareDate,
		GraceDays:   0,
		Active:      true,
	}).Error
}

// BackfillCalendarActivityRuleFromTemplate copia activity_rule_id de plantilla a instancias sin snapshot.
func BackfillCalendarActivityRuleFromTemplate(db *gorm.DB) error {
	return backfillCalendarActivityRuleFromTemplate(db)
}

func backfillCalendarActivityRuleFromTemplate(db *gorm.DB) error {
	return db.Exec(`
		UPDATE finance_calendar_activities AS a
		INNER JOIN activity_templates AS t ON t.id = a.activity_template_id AND t.deleted_at IS NULL
		SET a.activity_rule_id = t.activity_rule_id
		WHERE (a.activity_rule_id IS NULL OR a.activity_rule_id = 0)
		  AND t.activity_rule_id IS NOT NULL
		  AND a.deleted_at IS NULL
	`).Error
}
