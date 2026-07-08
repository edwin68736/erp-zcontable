package services

import (
	"time"

	"miappfiber/database"
	"miappfiber/models"
)

// UploadTimelinessDTO resultado de cumplimiento visual vs calendario.
type UploadTimelinessDTO struct {
	Timeliness string     `json:"timeliness"`
	DueAt      *time.Time `json:"due_at,omitempty"`
	UploadedAt *time.Time `json:"uploaded_at,omitempty"`
}

// DetraccionesTimelinessDTO alias retrocompatible en API detracciones.
type DetraccionesTimelinessDTO = UploadTimelinessDTO

// FindCalendarActivityByType busca instancia mensual por activity_type_snapshot.
func FindCalendarActivityByType(periodYM, activityType string) (*models.FinanceCalendarActivity, error) {
	var act models.FinanceCalendarActivity
	err := database.DB.Table("finance_calendar_activities AS a").
		Select("a.*").
		Joins("INNER JOIN finance_calendars c ON c.id = a.calendar_id AND c.deleted_at IS NULL").
		Where("c.period_ym = ? AND a.activity_type_snapshot = ? AND a.deleted_at IS NULL", periodYM, activityType).
		Order("a.due_day ASC, a.id ASC").
		First(&act).Error
	if err != nil {
		return nil, err
	}
	return &act, nil
}

// ComputeCalendarActivityTimeliness evalúa cumplimiento usando snapshot activity_rule_id de la instancia.
//
// Limitación (ver docs/activity-rules-snapshot.md): el snapshot congela solo el ID de regla.
// compare_mode, max_upload_time y grace_days se resuelven en runtime desde activity_rules.
// ComputeActivityRuleTimeliness evalúa cumplimiento para una fecha de vencimiento y regla snapshot.
func ComputeActivityRuleTimeliness(
	dueDate time.Time,
	activityRuleID *uint,
	uploadedAt *time.Time,
	exempt bool,
) UploadTimelinessDTO {
	result := UploadTimelinessDTO{UploadedAt: uploadedAt}

	rule, err := LoadActiveActivityRule(activityRuleID)
	hasRule := err == nil && rule != nil

	var deadline time.Time
	if hasRule {
		deadline = BuildUploadDeadline(dueDate, rule)
		d := deadline
		result.DueAt = &d
	}

	compareMode := models.ActivityRuleCompareDate
	if rule != nil {
		compareMode = rule.CompareMode
	}

	result.Timeliness = EvaluateUploadTimeliness(
		time.Now(),
		uploadedAt,
		deadline,
		hasRule,
		exempt,
		compareMode,
	)
	return result
}

func ComputeCalendarActivityTimeliness(
	periodYM string,
	calendarActivity *models.FinanceCalendarActivity,
	uploadedAt *time.Time,
	exempt bool,
) UploadTimelinessDTO {
	if calendarActivity == nil {
		result := UploadTimelinessDTO{UploadedAt: uploadedAt}
		result.Timeliness = EvaluateUploadTimeliness(time.Now(), uploadedAt, time.Time{}, false, exempt, models.ActivityRuleCompareDate)
		return result
	}

	dueDate, err := dueDateForActivity(periodYM, calendarActivity.DueDay)
	if err != nil {
		result := UploadTimelinessDTO{UploadedAt: uploadedAt}
		result.Timeliness = EvaluateUploadTimeliness(time.Now(), uploadedAt, time.Time{}, false, exempt, models.ActivityRuleCompareDate)
		return result
	}

	return ComputeActivityRuleTimeliness(dueDate, calendarActivity.ActivityRuleID, uploadedAt, exempt)
}
