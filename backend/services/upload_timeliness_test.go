package services

import (
	"testing"
	"time"

	"miappfiber/models"
)

func TestEvaluateUploadTimeliness(t *testing.T) {
	loc := time.Local
	deadline := time.Date(2026, 6, 15, 23, 59, 59, 0, loc)

	t.Run("no_rule", func(t *testing.T) {
		got := EvaluateUploadTimeliness(time.Now(), nil, deadline, false, false, models.ActivityRuleCompareDate)
		if got != TimelinessNoRule {
			t.Fatalf("got %s", got)
		}
	})

	t.Run("exempt", func(t *testing.T) {
		got := EvaluateUploadTimeliness(time.Now(), nil, deadline, true, true, models.ActivityRuleCompareDate)
		if got != TimelinessExempt {
			t.Fatalf("got %s", got)
		}
	})

	t.Run("pending", func(t *testing.T) {
		now := time.Date(2026, 6, 10, 12, 0, 0, 0, loc)
		got := EvaluateUploadTimeliness(now, nil, deadline, true, false, models.ActivityRuleCompareDate)
		if got != TimelinessPending {
			t.Fatalf("got %s", got)
		}
	})

	t.Run("missing", func(t *testing.T) {
		now := time.Date(2026, 6, 16, 12, 0, 0, 0, loc)
		got := EvaluateUploadTimeliness(now, nil, deadline, true, false, models.ActivityRuleCompareDate)
		if got != TimelinessMissing {
			t.Fatalf("got %s", got)
		}
	})

	t.Run("on_time_same_day", func(t *testing.T) {
		upload := time.Date(2026, 6, 15, 18, 0, 0, 0, loc)
		now := time.Date(2026, 6, 20, 12, 0, 0, 0, loc)
		got := EvaluateUploadTimeliness(now, &upload, deadline, true, false, models.ActivityRuleCompareDate)
		if got != TimelinessOnTime {
			t.Fatalf("got %s", got)
		}
	})

	t.Run("late", func(t *testing.T) {
		upload := time.Date(2026, 6, 16, 9, 0, 0, 0, loc)
		now := time.Date(2026, 6, 20, 12, 0, 0, 0, loc)
		got := EvaluateUploadTimeliness(now, &upload, deadline, true, false, models.ActivityRuleCompareDate)
		if got != TimelinessLate {
			t.Fatalf("got %s", got)
		}
	})
}

func TestBuildUploadDeadlineGraceDays(t *testing.T) {
	due := time.Date(2026, 6, 15, 0, 0, 0, 0, time.Local)
	rule := &models.ActivityRule{CompareMode: models.ActivityRuleCompareDate, GraceDays: 2}
	got := BuildUploadDeadline(due, rule)
	want := time.Date(2026, 6, 17, 23, 59, 59, 0, time.Local)
	if !got.Equal(want) {
		t.Fatalf("got %v want %v", got, want)
	}
}
