package services

import (
	"testing"

	"miappfiber/database"
	"miappfiber/models"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func setupActivityTemplateTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("sqlite: %v", err)
	}
	if err := db.AutoMigrate(
		&models.ActivityTemplate{},
		&models.ActivityCodeSequence{},
		&models.FinanceCalendar{},
		&models.FinanceCalendarActivity{},
	); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	if err := db.Create(&models.ActivityCodeSequence{
		Prefix:     models.ActivityCodePrefix,
		LastNumber: 0,
	}).Error; err != nil {
		t.Fatalf("seed sequence: %v", err)
	}
	database.DB = db
	return db
}

func TestFormatActivityCode(t *testing.T) {
	tests := []struct {
		n    uint
		want string
	}{
		{1, "AC001"},
		{42, "AC042"},
		{999, "AC999"},
		{1000, "AC1000"},
	}
	for _, tc := range tests {
		if got := FormatActivityCode(tc.n); got != tc.want {
			t.Errorf("FormatActivityCode(%d) = %q, want %q", tc.n, got, tc.want)
		}
	}
}

func TestGenerateNextCode_Sequential(t *testing.T) {
	setupActivityTemplateTestDB(t)
	svc := NewActivityTemplateService()

	c1, err := svc.GenerateNextCode()
	if err != nil {
		t.Fatalf("first: %v", err)
	}
	if c1 != "AC001" {
		t.Fatalf("first code = %q want AC001", c1)
	}

	c2, err := svc.GenerateNextCode()
	if err != nil {
		t.Fatalf("second: %v", err)
	}
	if c2 != "AC002" {
		t.Fatalf("second code = %q want AC002", c2)
	}

	var seq models.ActivityCodeSequence
	if err := database.DB.Where("prefix = ?", models.ActivityCodePrefix).First(&seq).Error; err != nil {
		t.Fatalf("load seq: %v", err)
	}
	if seq.LastNumber != 2 {
		t.Fatalf("last_number = %d want 2", seq.LastNumber)
	}
}

func TestCreate_AssignsSequentialCodes(t *testing.T) {
	setupActivityTemplateTestDB(t)
	svc := NewActivityTemplateService()

	t1, err := svc.Create(ActivityTemplateInput{
		Name:         "NPS",
		ActivityType: models.CalendarActivityNPS,
	})
	if err != nil {
		t.Fatalf("create 1: %v", err)
	}
	if t1.Code != "AC001" {
		t.Fatalf("code 1 = %q", t1.Code)
	}

	t2, err := svc.Create(ActivityTemplateInput{
		Name:         "PDT 601",
		ActivityType: models.CalendarActivityPDT601,
	})
	if err != nil {
		t.Fatalf("create 2: %v", err)
	}
	if t2.Code != "AC002" {
		t.Fatalf("code 2 = %q", t2.Code)
	}
}

func TestDeleteTemplate_WithReferencesRejected(t *testing.T) {
	db := setupActivityTemplateTestDB(t)
	svc := NewActivityTemplateService()

	tpl, err := svc.Create(ActivityTemplateInput{
		Name:         "Referenciada",
		ActivityType: models.CalendarActivityOther,
	})
	if err != nil {
		t.Fatalf("create template: %v", err)
	}

	cal := models.FinanceCalendar{PeriodYM: "2026-06"}
	if err := db.Create(&cal).Error; err != nil {
		t.Fatalf("calendar: %v", err)
	}
	tid := tpl.ID
	act := models.FinanceCalendarActivity{
		CalendarID:           cal.ID,
		ActivityTemplateID:   tid,
		NameSnapshot:         tpl.Name,
		ActivityTypeSnapshot: tpl.ActivityType,
		PrioritySnapshot:     tpl.Priority,
		TextColorSnapshot:    tpl.TextColor,
		StartDay:             1,
		EndDay:               1,
		DueDay:               1,
		Status:               models.CalendarActivityStatusPending,
	}
	if err := db.Create(&act).Error; err != nil {
		t.Fatalf("activity: %v", err)
	}

	if err := svc.Delete(tpl.ID); err == nil {
		t.Fatal("expected delete error when references exist")
	}

	deactivated, err := svc.SetActive(tpl.ID, false)
	if err != nil {
		t.Fatalf("SetActive: %v", err)
	}
	if deactivated.Active {
		t.Fatal("expected active=false")
	}

	var stillThere models.ActivityTemplate
	if err := db.First(&stillThere, tpl.ID).Error; err != nil {
		t.Fatalf("template should still exist: %v", err)
	}
}

func TestDeleteTemplate_WithoutReferences(t *testing.T) {
	setupActivityTemplateTestDB(t)
	svc := NewActivityTemplateService()

	tpl, err := svc.Create(ActivityTemplateInput{
		Name:         "Sin referencias",
		ActivityType: models.CalendarActivityReport,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if err := svc.Delete(tpl.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}

	var n int64
	database.DB.Model(&models.ActivityTemplate{}).Where("id = ?", tpl.ID).Count(&n)
	if n != 0 {
		t.Fatalf("template should be soft-deleted, count=%d", n)
	}
}

func TestCreate_ValidationErrors(t *testing.T) {
	setupActivityTemplateTestDB(t)
	svc := NewActivityTemplateService()

	_, err := svc.Create(ActivityTemplateInput{Name: "", ActivityType: models.CalendarActivityNPS})
	if err == nil {
		t.Fatal("expected error for empty name")
	}

	_, err = svc.Create(ActivityTemplateInput{Name: "X", ActivityType: "invalid_type"})
	if err == nil {
		t.Fatal("expected error for invalid activity_type")
	}

	_, err = svc.Create(ActivityTemplateInput{
		Name:         "X",
		ActivityType: models.CalendarActivityNPS,
		Priority:     "invalid",
	})
	if err == nil {
		t.Fatal("expected error for invalid priority")
	}
}
