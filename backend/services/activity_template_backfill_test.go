package services

import (
	"testing"

	"miappfiber/models"
)

func TestNameSimilarityScore_NPSVariants(t *testing.T) {
	a := "generacion del nps"
	b := "GENERACION DE NPOS DEL MES DE MAYO DE MANERA URGENTE ANTES DE TEMRINAR EL MES"
	sc := NameSimilarityScore(a, b)
	if sc < backfillSimilarityMinScore {
		t.Fatalf("expected similarity >= %.2f, got %.2f", backfillSimilarityMinScore, sc)
	}
}

func TestNameSimilarityScore_Unrelated(t *testing.T) {
	sc := NameSimilarityScore("Reporte de vencimiento de factura", "generacion del nps")
	if sc >= backfillSimilarityMinScore {
		t.Fatalf("expected low similarity, got %.2f", sc)
	}
}

func TestNormBackfillColor(t *testing.T) {
	if got := NormBackfillColor(" #1D4ED8 "); got != "#1d4ed8" {
		t.Fatalf("color = %q", got)
	}
	if got := NormBackfillColor("invalid"); got != "#1d4ed8" {
		t.Fatalf("fallback = %q", got)
	}
}

func TestNormBackfillNameKey_PreservesCase(t *testing.T) {
	in := "  GENERACION NPS  "
	if got := NormBackfillNameKey(in); got != "GENERACION NPS" {
		t.Fatalf("key = %q want trimmed original case", got)
	}
}

func TestBuildSimilarityHints_SameMetaDifferentNames(t *testing.T) {
	groups := map[BackfillExactKey][]backfillActivityRow{
		{Name: "generacion del nps", ActivityKind: "nps", Priority: "media", TextColor: "#1d4ed8"}: {
			{ID: 1, Name: "generacion del nps", ActivityKind: "nps", Priority: "media", TextColor: "#1d4ed8"},
		},
		{Name: "GENERACION DE NPOS DEL MES", ActivityKind: "nps", Priority: "media", TextColor: "#1d4ed8"}: {
			{ID: 2, Name: "GENERACION DE NPOS DEL MES DE MAYO", ActivityKind: "nps", Priority: "media", TextColor: "#1d4ed8"},
		},
	}
	hints := buildSimilarityHints(groups)
	if len(hints) != 1 {
		t.Fatalf("expected 1 hint, got %d", len(hints))
	}
	if hints[0].MaxScore < backfillSimilarityMinScore {
		t.Fatalf("score %.2f too low", hints[0].MaxScore)
	}
}

func TestDryRunBackfill_NoMutation(t *testing.T) {
	db := setupActivityTemplateTestDB(t)
	svc := NewActivityTemplateService()
	tpl, err := svc.Create(ActivityTemplateInput{Name: "Test", ActivityType: models.CalendarActivityOther})
	if err != nil {
		t.Fatal(err)
	}
	cal := models.FinanceCalendar{PeriodYM: "2026-01"}
	if err := db.Create(&cal).Error; err != nil {
		t.Fatal(err)
	}
	tid := tpl.ID
	act := models.FinanceCalendarActivity{
		CalendarID: cal.ID, ActivityTemplateID: tid,
		NameSnapshot: "Legacy", ActivityTypeSnapshot: "other",
		PrioritySnapshot: "media", TextColorSnapshot: "#1d4ed8",
		StartDay: 1, EndDay: 1, DueDay: 1, Status: "pendiente",
	}
	if err := db.Create(&act).Error; err != nil {
		t.Fatal(err)
	}

	rep, err := DryRunBackfill(db)
	if err != nil {
		t.Fatal(err)
	}
	if rep.TotalActivities != 1 {
		t.Fatalf("total=%d", rep.TotalActivities)
	}
}
