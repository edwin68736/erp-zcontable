package services

import (
	"time"

	"miappfiber/database"
	"miappfiber/models"

	"gorm.io/gorm"
)

// UploadTimelinessDTO resultado de cumplimiento visual vs calendario.
type UploadTimelinessDTO struct {
	Timeliness string     `json:"timeliness"`
	DueAt      *time.Time `json:"due_at,omitempty"`
	UploadedAt *time.Time `json:"uploaded_at,omitempty"`
}

// DetraccionesTimelinessDTO alias retrocompatible en API detracciones.
type DetraccionesTimelinessDTO = UploadTimelinessDTO

// FindCalendarActivityByType busca instancia mensual por activity_type_snapshot — sin distinguir por
// dígito de RUC (retrocompatible: equivale a `FindCalendarActivityByTypeAndDigit(periodYM, activityType, nil)`).
// Los tipos que hoy no agrupan sus plantillas por RUC (Detracciones, Buzón SOL) siguen usando esta
// función tal cual; el mecanismo por dígito ya funciona para ellos automáticamente si en el futuro se
// les asignan rangos (ver docs/diseno-limpieza-control-detail-2026-09-16.md §2.7b).
func FindCalendarActivityByType(periodYM, activityType string) (*models.FinanceCalendarActivity, error) {
	return FindCalendarActivityByTypeAndDigit(periodYM, activityType, nil)
}

// FindCalendarActivityByTypeAndDigit busca, entre TODAS las instancias mensuales de un tipo, la que
// corresponde al dígito de RUC de una empresa. Con `rucDigit == nil`, ignora el agrupamiento y
// devuelve la primera (mismo comportamiento que antes de §2.7b). Con dígito:
//  1. Prioriza la actividad cuyo rango [RucDigitStartSnapshot, RucDigitEndSnapshot] contiene el dígito.
//  2. Si ninguna calza, usa la que no tiene rango definido (aplica a todas) como comodín.
//  3. Si tampoco hay comodín, no encuentra nada — mismo criterio de "sin configurar" que ya existía.
func FindCalendarActivityByTypeAndDigit(periodYM, activityType string, rucDigit *int) (*models.FinanceCalendarActivity, error) {
	if rucDigit == nil {
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

	candidates, err := CalendarActivitiesForType(periodYM, activityType)
	if err != nil {
		return nil, err
	}
	if act := PickCalendarActivityByDigit(candidates, rucDigit); act != nil {
		return act, nil
	}
	return nil, gorm.ErrRecordNotFound
}

// CalendarActivitiesForType trae TODAS las instancias mensuales de un tipo en un período — una sola
// consulta, para que un caller que itera muchas empresas (listados, exports) no repita la consulta
// por cada una; usar junto con `PickCalendarActivityByDigit`.
func CalendarActivitiesForType(periodYM, activityType string) ([]models.FinanceCalendarActivity, error) {
	var candidates []models.FinanceCalendarActivity
	err := database.DB.Table("finance_calendar_activities AS a").
		Select("a.*").
		Joins("INNER JOIN finance_calendars c ON c.id = a.calendar_id AND c.deleted_at IS NULL").
		Where("c.period_ym = ? AND a.activity_type_snapshot = ? AND a.deleted_at IS NULL", periodYM, activityType).
		Order("a.due_day ASC, a.id ASC").
		Find(&candidates).Error
	if err != nil {
		return nil, err
	}
	return candidates, nil
}

// PickCalendarActivityByDigit elige, entre varias actividades candidatas del mismo tipo/período, la
// que le corresponde a `rucDigit` (docs/diseno-limpieza-control-detail-2026-09-16.md §2.7b):
// 1. La que tiene rango [Start,End] y lo contiene. 2. Si ninguna calza, la que no tiene rango (aplica
// a todas), como comodín. 3. nil si no hay match ni comodín, o `rucDigit` es nil y no hay comodín (en
// ese caso se usa la primera de la lista, ya viene ordenada por due_day/id).
func PickCalendarActivityByDigit(candidates []models.FinanceCalendarActivity, rucDigit *int) *models.FinanceCalendarActivity {
	if len(candidates) == 0 {
		return nil
	}
	var wildcard *models.FinanceCalendarActivity
	for i := range candidates {
		cand := &candidates[i]
		if cand.RucDigitStartSnapshot == nil || cand.RucDigitEndSnapshot == nil {
			if wildcard == nil {
				wildcard = cand
			}
			continue
		}
		if rucDigit != nil && *rucDigit >= *cand.RucDigitStartSnapshot && *rucDigit <= *cand.RucDigitEndSnapshot {
			return cand
		}
	}
	if wildcard != nil {
		return wildcard
	}
	if rucDigit == nil {
		return &candidates[0]
	}
	return nil
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
