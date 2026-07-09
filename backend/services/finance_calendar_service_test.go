package services

import (
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"

	"miappfiber/database"
	"miappfiber/models"
)

func setupFinanceCalendarTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("sqlite: %v", err)
	}
	if err := db.AutoMigrate(
		&models.FinanceCalendar{},
		&models.FinanceCalendarActivity{},
		&models.ActivityTemplate{},
		&models.ActivityRule{},
	); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	database.DB = db
	return db
}

func TestCreateActivity_FromTemplateSnapshots(t *testing.T) {
	db := setupFinanceCalendarTestDB(t)
	svc := NewFinanceCalendarService()

	tpl := models.ActivityTemplate{
		Code: "AC010", Name: "Generación NPS", ActivityType: models.CalendarActivityNPS,
		Priority: models.SupervisorPriorityAlta, TextColor: "#047857", Icon: "fas fa-file-invoice",
		Active: true,
	}
	if err := db.Create(&tpl).Error; err != nil {
		t.Fatal(err)
	}
	cal := models.FinanceCalendar{PeriodYM: "2026-07"}
	if err := db.Create(&cal).Error; err != nil {
		t.Fatal(err)
	}

	dto, err := svc.CreateActivity(cal.ID, CalendarActivityCreateInput{
		ActivityTemplateID: tpl.ID,
		StartDay:           5, EndDay: 8, DueDay: 10,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if dto.Name != "Generación NPS" {
		t.Fatalf("name=%q", dto.Name)
	}
	if dto.ActivityKind != "nps" {
		t.Fatalf("kind=%q", dto.ActivityKind)
	}
	if dto.Priority != "alta" {
		t.Fatalf("priority=%q", dto.Priority)
	}
	if dto.TextColor != "#047857" {
		t.Fatalf("color=%q", dto.TextColor)
	}
	if dto.Icon != "fas fa-file-invoice" {
		t.Fatalf("icon=%q", dto.Icon)
	}
	if dto.ActivityTemplateID != tpl.ID {
		t.Fatalf("template_id=%d want %d", dto.ActivityTemplateID, tpl.ID)
	}
	if dto.TemplateCode != "AC010" {
		t.Fatalf("template_code=%q", dto.TemplateCode)
	}

	var stored models.FinanceCalendarActivity
	if err := db.First(&stored, dto.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.NameSnapshot != "Generación NPS" || stored.ActivityTypeSnapshot != "nps" {
		t.Fatalf("snapshots not stored")
	}
}

func TestCreateActivity_CopiesActivityRuleIDFromTemplate(t *testing.T) {
	db := setupFinanceCalendarTestDB(t)
	svc := NewFinanceCalendarService()

	rule := models.ActivityRule{
		Name: "Fecha Simple", CompareMode: models.ActivityRuleCompareDate, Active: true,
	}
	if err := db.Create(&rule).Error; err != nil {
		t.Fatal(err)
	}
	ruleID := rule.ID

	tpl := models.ActivityTemplate{
		Code: "AC020", Name: "Detracciones", ActivityType: models.CalendarActivityDetracciones,
		Priority: models.SupervisorPriorityMedia, TextColor: "#1d4ed8", Active: true,
		ActivityRuleID: &ruleID,
	}
	if err := db.Create(&tpl).Error; err != nil {
		t.Fatal(err)
	}
	cal := models.FinanceCalendar{PeriodYM: "2026-08"}
	if err := db.Create(&cal).Error; err != nil {
		t.Fatal(err)
	}

	dto, err := svc.CreateActivity(cal.ID, CalendarActivityCreateInput{
		ActivityTemplateID: tpl.ID,
		StartDay:           1, EndDay: 1, DueDay: 15,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	var stored models.FinanceCalendarActivity
	if err := db.First(&stored, dto.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.ActivityRuleID == nil || *stored.ActivityRuleID != ruleID {
		t.Fatalf("activity_rule_id=%v want %d", stored.ActivityRuleID, ruleID)
	}
}

func TestSetActivityRule_DoesNotModifyExistingCalendarActivities(t *testing.T) {
	db := setupFinanceCalendarTestDB(t)
	tplSvc := NewActivityTemplateService()

	ruleA := models.ActivityRule{Name: "Regla A", CompareMode: models.ActivityRuleCompareDate, Active: true}
	ruleB := models.ActivityRule{Name: "Regla B", CompareMode: models.ActivityRuleCompareDate, GraceDays: 2, Active: true}
	if err := db.Create(&ruleA).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&ruleB).Error; err != nil {
		t.Fatal(err)
	}
	ruleAID := ruleA.ID

	tpl := models.ActivityTemplate{
		Code: "AC030", Name: "Detracciones", ActivityType: models.CalendarActivityDetracciones,
		Priority: models.SupervisorPriorityMedia, TextColor: "#1d4ed8", Active: true,
		ActivityRuleID: &ruleAID,
	}
	if err := db.Create(&tpl).Error; err != nil {
		t.Fatal(err)
	}

	cal := models.FinanceCalendar{PeriodYM: "2026-09"}
	if err := db.Create(&cal).Error; err != nil {
		t.Fatal(err)
	}
	existing := models.FinanceCalendarActivity{
		CalendarID: cal.ID, ActivityTemplateID: tpl.ID, ActivityRuleID: &ruleAID,
		NameSnapshot: "Detracciones", ActivityTypeSnapshot: models.CalendarActivityDetracciones,
		PrioritySnapshot: "media", TextColorSnapshot: "#1d4ed8",
		StartDay: 1, EndDay: 1, DueDay: 10, Status: models.CalendarActivityStatusPending,
	}
	if err := db.Create(&existing).Error; err != nil {
		t.Fatal(err)
	}

	ruleBID := ruleB.ID
	if _, err := tplSvc.SetActivityRule(tpl.ID, &ruleBID); err != nil {
		t.Fatalf("set activity rule: %v", err)
	}

	var storedAct models.FinanceCalendarActivity
	if err := db.First(&storedAct, existing.ID).Error; err != nil {
		t.Fatal(err)
	}
	if storedAct.ActivityRuleID == nil || *storedAct.ActivityRuleID != ruleAID {
		t.Fatalf("calendar activity_rule_id changed to %v, want %d", storedAct.ActivityRuleID, ruleAID)
	}

	var storedTpl models.ActivityTemplate
	if err := db.First(&storedTpl, tpl.ID).Error; err != nil {
		t.Fatal(err)
	}
	if storedTpl.ActivityRuleID == nil || *storedTpl.ActivityRuleID != ruleBID {
		t.Fatalf("template activity_rule_id=%v want %d", storedTpl.ActivityRuleID, ruleBID)
	}
}

func TestUpdateActivity_OnlyDaysAndStatus(t *testing.T) {
	db := setupFinanceCalendarTestDB(t)
	svc := NewFinanceCalendarService()

	tid := uint(1)
	act := models.FinanceCalendarActivity{
		CalendarID: 1, ActivityTemplateID: tid,
		NameSnapshot: "X", ActivityTypeSnapshot: "nps",
		PrioritySnapshot: "media", TextColorSnapshot: "#1d4ed8",
		StartDay: 1, EndDay: 1, DueDay: 1, Status: "pendiente",
	}
	cal := models.FinanceCalendar{PeriodYM: "2026-07"}
	db.Create(&cal)
	act.CalendarID = cal.ID
	db.Create(&act)

	dto, err := svc.UpdateActivity(act.ID, CalendarActivityUpdateInput{
		StartDay: 3, EndDay: 5, DueDay: 6, Status: "en_progreso",
	})
	if err != nil {
		t.Fatal(err)
	}
	if dto.StartDay != 3 || dto.DueDay != 6 || dto.Status != "en_progreso" {
		t.Fatalf("unexpected dto: %+v", dto)
	}
	if dto.Name != "X" || dto.ActivityKind != "nps" {
		t.Fatalf("snapshots changed in dto")
	}

	var stored models.FinanceCalendarActivity
	db.First(&stored, act.ID)
	if stored.NameSnapshot != "X" || stored.ActivityTypeSnapshot != "nps" {
		t.Fatalf("snapshots mutated in db")
	}
}

func TestActivityCompliance_UsesSnapshotType(t *testing.T) {
	setupFinanceCalendarTestDB(t)
	svc := NewFinanceCalendarService()

	act := models.FinanceCalendarActivity{
		CalendarID:           1,
		ActivityTemplateID:   1,
		NameSnapshot:         "Snap",
		ActivityTypeSnapshot: "other",
		PrioritySnapshot:     "media",
		TextColorSnapshot:    "#1d4ed8",
		StartDay:             1,
		EndDay:               1,
		DueDay:               15,
		Status:               "pendiente",
	}
	cal := models.FinanceCalendar{PeriodYM: "2026-07"}
	database.DB.Create(&cal)
	act.CalendarID = cal.ID
	database.DB.Create(&act)

	summary, err := svc.ActivityCompliance(act.ID, "", []uint{})
	if err != nil {
		t.Fatal(err)
	}
	if summary.ActivityName != "Snap" {
		t.Fatalf("name=%q want Snap", summary.ActivityName)
	}
}

func TestDuplicateCalendar_CopiesSnapshotsAndResetsStatus(t *testing.T) {
	db := setupFinanceCalendarTestDB(t)
	svc := NewFinanceCalendarService()

	tid := uint(2)
	srcCal := models.FinanceCalendar{PeriodYM: "2026-05"}
	db.Create(&srcCal)
	act := models.FinanceCalendarActivity{
		CalendarID: srcCal.ID, ActivityTemplateID: tid,
		NameSnapshot: "NPS", ActivityTypeSnapshot: "nps",
		PrioritySnapshot: "media", TextColorSnapshot: "#1d4ed8",
		StartDay: 4, EndDay: 6, DueDay: 7, Status: "completada",
	}
	db.Create(&act)

	created, err := svc.DuplicateCalendar("2026-05", "2026-08", DuplicateCalendarOptions{CopyActivities: true})
	if err != nil {
		t.Fatal(err)
	}

	var dup models.FinanceCalendarActivity
	if err := db.Where("calendar_id = ?", created.ID).First(&dup).Error; err != nil {
		t.Fatal(err)
	}
	if dup.Status != models.CalendarActivityStatusPending {
		t.Fatalf("status=%q", dup.Status)
	}
	if dup.ActivityTemplateID != tid {
		t.Fatalf("template_id not copied")
	}
	if dup.NameSnapshot != "NPS" || dup.StartDay != 4 {
		t.Fatalf("snapshots/days not copied: %+v", dup)
	}
}

func TestActivityDisplayFields_FromSnapshots(t *testing.T) {
	a := models.FinanceCalendarActivity{
		NameSnapshot: "Snap Name", ActivityTypeSnapshot: "report",
		PrioritySnapshot: "alta", TextColorSnapshot: "#b91c1c",
	}
	if activityDisplayName(&a) != "Snap Name" {
		t.Fatal("name")
	}
	if activityComplianceKind(&a) != "report" {
		t.Fatal("kind")
	}
}
