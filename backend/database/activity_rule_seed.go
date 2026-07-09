package database

import (
	"miappfiber/models"

	"gorm.io/gorm"
)

// SeedActivityRules inserta reglas por defecto y asigna Detracciones si aplica.
func SeedActivityRules(db *gorm.DB) error {
	if db == nil {
		db = DB
	}
	var count int64
	if err := db.Model(&models.ActivityRule{}).Where("name = ?", "Fecha Simple").Count(&count).Error; err != nil {
		return err
	}
	if count == 0 {
		if err := db.Create(&models.ActivityRule{
			Name:        "Fecha Simple",
			Description: "Comparación por fecha de calendario (mismo día = a tiempo)",
			CompareMode: models.ActivityRuleCompareDate,
			GraceDays:   0,
			Active:      true,
		}).Error; err != nil {
			return err
		}
	}

	var rule models.ActivityRule
	if err := db.Where("name = ?", "Fecha Simple").First(&rule).Error; err != nil {
		return err
	}
	return db.Model(&models.ActivityTemplate{}).
		Where("activity_type = ? AND (activity_rule_id IS NULL OR activity_rule_id = 0)", models.CalendarActivityDetracciones).
		Update("activity_rule_id", rule.ID).Error
}
