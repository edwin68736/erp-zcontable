package services

import (
	"strings"
	"time"

	"miappfiber/models"
)

const (
	TimelinessOnTime  = "on_time"
	TimelinessLate    = "late"
	TimelinessPending = "pending"
	TimelinessMissing = "missing"
	TimelinessNoRule  = "no_rule"
	TimelinessExempt  = "exempt"
)

// EvaluateUploadTimeliness evalúa cumplimiento de carga vs plazo (solo fechas, sin validación tributaria).
func EvaluateUploadTimeliness(
	now time.Time,
	uploadedAt *time.Time,
	deadline time.Time,
	hasRule bool,
	exempt bool,
	compareMode string,
) string {
	if exempt {
		return TimelinessExempt
	}
	if !hasRule {
		return TimelinessNoRule
	}

	mode := strings.TrimSpace(compareMode)
	if mode == "" {
		mode = models.ActivityRuleCompareDate
	}

	if uploadedAt == nil || uploadedAt.IsZero() {
		if timelinessNowAfterDeadline(now, deadline, mode) {
			return TimelinessMissing
		}
		return TimelinessPending
	}

	if mode == models.ActivityRuleCompareDateTime {
		if uploadedAt.After(deadline) {
			return TimelinessLate
		}
		return TimelinessOnTime
	}

	if sameCalendarDayOrBefore(*uploadedAt, deadline) {
		return TimelinessOnTime
	}
	return TimelinessLate
}

func timelinessNowAfterDeadline(now, deadline time.Time, compareMode string) bool {
	if compareMode == models.ActivityRuleCompareDateTime {
		return now.After(deadline)
	}
	return calendarDayAfter(now, deadline)
}

func calendarDayAfter(a, b time.Time) bool {
	ay, am, ad := a.In(time.Local).Date()
	by, bm, bd := b.In(time.Local).Date()
	if ay != by {
		return ay > by
	}
	if am != bm {
		return am > bm
	}
	return ad > bd
}

func sameCalendarDayOrBefore(a, b time.Time) bool {
	ay, am, ad := a.In(time.Local).Date()
	by, bm, bd := b.In(time.Local).Date()
	if ay != by {
		return ay < by
	}
	if am != bm {
		return am < bm
	}
	return ad <= bd
}

// BuildUploadDeadline combina due_day del calendario con regla de cumplimiento.
func BuildUploadDeadline(dueDate time.Time, rule *models.ActivityRule) time.Time {
	loc := time.Local
	y, m, d := dueDate.In(loc).Date()
	deadline := time.Date(y, m, d, 23, 59, 59, 0, loc)

	if rule == nil {
		return deadline
	}

	if strings.TrimSpace(rule.CompareMode) == models.ActivityRuleCompareDateTime {
		h, min := parseHHMM(rule.MaxUploadTime)
		deadline = time.Date(y, m, d, h, min, 59, 0, loc)
	}

	if rule.GraceDays > 0 {
		deadline = deadline.AddDate(0, 0, rule.GraceDays)
	}
	return deadline
}

func parseHHMM(value string) (hour, minute int) {
	value = strings.TrimSpace(value)
	if len(value) < 4 {
		return 23, 59
	}
	parts := strings.Split(value, ":")
	if len(parts) != 2 {
		return 23, 59
	}
	h, errH := parseTwoDigits(parts[0])
	m, errM := parseTwoDigits(parts[1])
	if errH != nil || errM != nil || h > 23 || m > 59 {
		return 23, 59
	}
	return h, m
}

func parseTwoDigits(s string) (int, error) {
	if len(s) != 2 {
		return 0, errInvalidTime
	}
	n := 0
	for _, c := range s {
		if c < '0' || c > '9' {
			return 0, errInvalidTime
		}
		n = n*10 + int(c-'0')
	}
	return n, nil
}

var errInvalidTime = &timelinessTimeError{}

type timelinessTimeError struct{}

func (e *timelinessTimeError) Error() string { return "hora inválida" }
