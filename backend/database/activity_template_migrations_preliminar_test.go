package database

import (
	"testing"

	"miappfiber/models"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func TestRetypeLegacyPreliminarVentas(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("sqlite: %v", err)
	}
	if err := db.AutoMigrate(&models.SchemaMigration{}, &models.ActivityTemplate{}, &models.FinanceCalendar{}, &models.FinanceCalendarActivity{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	mkTpl := func(code, name, typ string) models.ActivityTemplate {
		tpl := models.ActivityTemplate{Code: code, Name: name, ActivityType: typ, Active: true}
		if err := db.Create(&tpl).Error; err != nil {
			t.Fatalf("template: %v", err)
		}
		return tpl
	}
	legacy := mkTpl("AC25", "PRELIMINAR DE VENTAS", "nps")
	other := mkTpl("AC30", "BALANCES POR RUC", "nps")
	cal := models.FinanceCalendar{PeriodYM: "2026-10"}
	if err := db.Create(&cal).Error; err != nil {
		t.Fatalf("calendar: %v", err)
	}
	mkAct := func(tpl models.ActivityTemplate, day int, snap string) models.FinanceCalendarActivity {
		a := models.FinanceCalendarActivity{CalendarID: cal.ID, ActivityTemplateID: tpl.ID, NameSnapshot: tpl.Name,
			ActivityTypeSnapshot: snap, PrioritySnapshot: "media", TextColorSnapshot: "#000", StartDay: day, EndDay: day, DueDay: day}
		if err := db.Create(&a).Error; err != nil {
			t.Fatalf("activity: %v", err)
		}
		return a
	}
	a1, a2 := mkAct(legacy, 19, "nps"), mkAct(legacy, 26, "nps")
	b1 := mkAct(other, 10, "nps")

	for i := 0; i < 2; i++ { // idempotente
		if err := applyMigrationOnce(db, migRetypeLegacyPreliminarVentas, retypeLegacyPreliminarVentas); err != nil {
			t.Fatalf("migración: %v", err)
		}
	}

	var tpl models.ActivityTemplate
	db.First(&tpl, legacy.ID)
	if tpl.ActivityType != models.CalendarActivityPreliminarVentas {
		t.Fatalf("plantilla = %q, want preliminar_ventas", tpl.ActivityType)
	}
	for _, id := range []uint{a1.ID, a2.ID} {
		var a models.FinanceCalendarActivity
		db.First(&a, id)
		if a.ActivityTypeSnapshot != models.CalendarActivityPreliminarVentas {
			t.Fatalf("actividad %d = %q, want preliminar_ventas", id, a.ActivityTypeSnapshot)
		}
	}
	var o models.ActivityTemplate
	db.First(&o, other.ID)
	var ob models.FinanceCalendarActivity
	db.First(&ob, b1.ID)
	if o.ActivityType != "nps" || ob.ActivityTypeSnapshot != "nps" {
		t.Fatalf("otra plantilla/actividad no debía cambiar: %q / %q", o.ActivityType, ob.ActivityTypeSnapshot)
	}
}
