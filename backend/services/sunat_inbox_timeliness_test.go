package services

import (
	"testing"
	"time"

	"miappfiber/models"
)

func TestDueDateForMailboxSlot_usesCalendarDueDayInWeek(t *testing.T) {
	weekStart := time.Date(2026, 6, 15, 0, 0, 0, 0, time.Local)
	acts := []models.FinanceCalendarActivity{{
		StartDay: 15,
		EndDay:   18,
		DueDay:   16,
	}}
	got := dueDateForMailboxSlot("2026-06", weekStart, 1, 2, acts)
	want := time.Date(2026, 6, 15, 0, 0, 0, 0, time.Local)
	if !got.Equal(want) {
		t.Fatalf("slot1 due=%v want=%v", got, want)
	}
	got2 := dueDateForMailboxSlot("2026-06", weekStart, 2, 2, acts)
	want2 := time.Date(2026, 6, 16, 0, 0, 0, 0, time.Local)
	if !got2.Equal(want2) {
		t.Fatalf("slot2 due=%v want=%v", got2, want2)
	}
}

// TestDueDateForMailboxSlot_usesDiscreteRealActivities cubre el caso nuevo de §5.9.6.5: varias
// actividades reales independientes (una por miércoles/sábado), cada una con su propio due_day
// puntual (start_day=end_day=due_day) — no un único rango. El slot 1 debe ser la fecha real más
// temprana de la semana, el slot 2 la siguiente, en orden cronológico.
func TestDueDateForMailboxSlot_usesDiscreteRealActivities(t *testing.T) {
	weekStart := time.Date(2026, 6, 15, 0, 0, 0, 0, time.Local)
	acts := []models.FinanceCalendarActivity{
		{StartDay: 17, EndDay: 17, DueDay: 17}, // miércoles
		{StartDay: 20, EndDay: 20, DueDay: 20}, // sábado
	}
	got1 := dueDateForMailboxSlot("2026-06", weekStart, 1, 2, acts)
	want1 := time.Date(2026, 6, 17, 0, 0, 0, 0, time.Local)
	if !got1.Equal(want1) {
		t.Fatalf("slot1 due=%v want=%v", got1, want1)
	}
	got2 := dueDateForMailboxSlot("2026-06", weekStart, 2, 2, acts)
	want2 := time.Date(2026, 6, 20, 0, 0, 0, 0, time.Local)
	if !got2.Equal(want2) {
		t.Fatalf("slot2 due=%v want=%v", got2, want2)
	}
}

func TestDueDateForMailboxSlot_fallbackSpread(t *testing.T) {
	weekStart := time.Date(2026, 6, 15, 0, 0, 0, 0, time.Local)
	got := dueDateForMailboxSlot("2026-06", weekStart, 2, 2, nil)
	want := time.Date(2026, 6, 21, 0, 0, 0, 0, time.Local)
	if !got.Equal(want) {
		t.Fatalf("fallback due=%v want=%v", got, want)
	}
}

func TestEnrichSunatInboxMailboxSideTimeliness_datetimeRule(t *testing.T) {
	ruleID := uint(1)
	acts := []models.FinanceCalendarActivity{{
		DueDay:         16,
		ActivityRuleID: &ruleID,
	}}
	weekStart := time.Date(2026, 6, 15, 0, 0, 0, 0, time.Local)
	ctx := mailboxTimelinessCtx{
		periodYM:     "2026-06",
		weekStart:    weekStart,
		slotsPerWeek: 2,
		calendarActs: acts,
	}

	onTime := time.Date(2026, 6, 16, 10, 0, 0, 0, time.Local)
	late := time.Date(2026, 6, 16, 11, 0, 0, 0, time.Local)

	// Sin regla en BD el test devuelve no_rule; probamos la función de deadline vía ComputeActivityRuleTimeliness mock-free:
	dueDate := dueDateForMailboxSlot(ctx.periodYM, ctx.weekStart, 2, ctx.slotsPerWeek, acts)
	deadline := BuildUploadDeadline(dueDate, &models.ActivityRule{
		CompareMode:   models.ActivityRuleCompareDateTime,
		MaxUploadTime: "10:30",
	})
	if got := EvaluateUploadTimeliness(time.Now(), &onTime, deadline, true, false, models.ActivityRuleCompareDateTime); got != TimelinessOnTime {
		t.Fatalf("on time got %q", got)
	}
	if got := EvaluateUploadTimeliness(time.Now(), &late, deadline, true, false, models.ActivityRuleCompareDateTime); got != TimelinessLate {
		t.Fatalf("late got %q", got)
	}
}
