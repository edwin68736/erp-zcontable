package services

import (
	"testing"
	"time"

	"miappfiber/models"

	"gorm.io/gorm"
)

// Los tests no usan la caché por defecto (cada caso arma su propia base con los mismos IDs); este archivo la apaga.
func init() {
	lookupCacheTTL = 0
	trendCacheTTL = 0
}

func withLookupCache(t *testing.T, ttl time.Duration) {
	t.Helper()
	old := lookupCacheTTL
	lookupCacheTTL = ttl
	ClearLookupCaches()
	t.Cleanup(func() { lookupCacheTTL = old; ClearLookupCaches() })
}

func TestLookupCache_ReglaDeActividadUnaConsultaYSeVaciaAlEditar(t *testing.T) {
	db := setupPdt621TestDBWithCalendar(t)
	if err := db.AutoMigrate(&models.ActivityRuleAudit{}); err != nil {
		t.Fatal(err)
	}
	withLookupCache(t, time.Minute)
	rule := models.ActivityRule{Name: "R", CompareMode: models.ActivityRuleCompareDate, Active: true}
	if err := db.Create(&rule).Error; err != nil {
		t.Fatal(err)
	}

	count := 0
	db.Callback().Query().Before("gorm:query").Register("test:count_rules", func(tx *gorm.DB) {
		if tx.Statement.Table == "activity_rules" {
			count++
		}
	})

	for i := 0; i < 50; i++ {
		r, err := LoadActiveActivityRule(&rule.ID)
		if err != nil || r == nil || r.ID != rule.ID {
			t.Fatalf("regla: %v %v", r, err)
		}
		r.Name = "cambiada por quien la recibe" // no debe afectar a la copia de la caché
	}
	if count != 1 {
		t.Fatalf("50 lecturas de la misma regla hicieron %d consultas, quiero 1", count)
	}
	if r, _ := LoadActiveActivityRule(&rule.ID); r.Name != "R" {
		t.Errorf("la caché entregó una regla alterada: %q", r.Name)
	}

	// Al editar por el servicio, la caché se vacía y se ve el cambio al instante.
	svc := NewActivityRuleService()
	if _, err := svc.Update(rule.ID, ActivityRuleInput{Name: "Nueva", CompareMode: models.ActivityRuleCompareDate, Active: true}, 1); err != nil {
		t.Fatalf("Update: %v", err)
	}
	if r, _ := LoadActiveActivityRule(&rule.ID); r == nil || r.Name != "Nueva" {
		t.Errorf("tras editar la regla debía verse el cambio: %+v", r)
	}
}

func TestLookupCache_SinTTLNoGuardaNada(t *testing.T) {
	db := setupPdt621TestDBWithCalendar(t)
	rule := models.ActivityRule{Name: "R", CompareMode: models.ActivityRuleCompareDate, Active: true}
	if err := db.Create(&rule).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := LoadActiveActivityRule(&rule.ID); err != nil {
		t.Fatal(err)
	}
	db.Model(&rule).Update("name", "otra")
	if r, _ := LoadActiveActivityRule(&rule.ID); r.Name != "otra" {
		t.Errorf("sin caché debe leerse siempre de la base: %q", r.Name)
	}
}

func TestLookupCache_ReglaInactivaSeRecuerdaComoInactiva(t *testing.T) {
	db := setupPdt621TestDBWithCalendar(t)
	withLookupCache(t, time.Minute)
	rule := models.ActivityRule{Name: "R", CompareMode: models.ActivityRuleCompareDate, Active: false}
	if err := db.Create(&rule).Error; err != nil {
		t.Fatal(err)
	}
	// «Active» tiene valor por defecto verdadero en el modelo: se fuerza a inactiva.
	db.Model(&rule).Update("active", false)
	for i := 0; i < 3; i++ {
		if r, err := LoadActiveActivityRule(&rule.ID); r != nil || err != nil {
			t.Fatalf("una regla inactiva no se devuelve: %v %v", r, err)
		}
	}
}
