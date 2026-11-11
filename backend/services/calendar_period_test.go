package services

import (
	"testing"

	"miappfiber/models"
)

// Mes del calendario que fija la fecha límite de cada actividad (calendar_period.go).

func TestCalendarMonthOffset_PorTipoDeActividad(t *testing.T) {
	siguiente := []string{
		models.CalendarActivityPDT601, models.CalendarActivityPDT621, models.CalendarActivityDetracciones,
		models.CalendarActivityInformeDetracciones, models.CalendarActivitySiscontBalances,
	}
	for _, typ := range siguiente {
		if got := CalendarMonthOffset(typ); got != 1 {
			t.Errorf("%s: offset=%d, want 1 (se entrega al cerrar el mes)", typ, got)
		}
	}
	mismoMes := []string{models.CalendarActivityPreliminarVentas, models.CalendarActivitySunatInbox, models.CalendarActivityOther, "nps", ""}
	for _, typ := range mismoMes {
		if got := CalendarMonthOffset(typ); got != 0 {
			t.Errorf("%q: offset=%d, want 0 (se entrega dentro del propio mes)", typ, got)
		}
	}
}

func TestShiftPeriodYM_CambioDeAnio(t *testing.T) {
	cases := []struct {
		in     string
		months int
		want   string
	}{
		{"2026-10", 1, "2026-11"},
		{"2026-12", 1, "2027-01"},
		{"2026-01", -1, "2025-12"},
		{"2026-03", 0, "2026-03"},
		{"no-es-periodo", 1, "no-es-periodo"},
	}
	for _, c := range cases {
		if got := shiftPeriodYM(c.in, c.months); got != c.want {
			t.Errorf("shiftPeriodYM(%q, %d) = %q, want %q", c.in, c.months, got, c.want)
		}
	}
	if got := CalendarPeriodFor(models.CalendarActivityPDT621, "2026-12"); got != "2027-01" {
		t.Errorf("CalendarPeriodFor(pdt_621, 2026-12) = %q, want 2027-01", got)
	}
	if got := CalendarPeriodFor(models.CalendarActivityPreliminarVentas, "2026-12"); got != "2026-12" {
		t.Errorf("CalendarPeriodFor(preliminar_ventas, 2026-12) = %q, want 2026-12", got)
	}
}

// Caso real: el periodo octubre se entrega en noviembre. Con el calendario de NOVIEMBRE (día 12) una recepción del 10 de
// noviembre es a tiempo y una del 13 es tarde; el calendario de octubre no interviene.
func TestPdt621_ElPeriodoSeMideContraElCalendarioDelMesSiguiente(t *testing.T) {
	db := setupPdt621TestDBWithCalendar(t)
	svc := NewSupervisorService()
	periodYM := "2026-10"
	if _, err := svc.CreatePeriod(periodYM, "test"); err != nil {
		t.Fatalf("CreatePeriod: %v", err)
	}
	seedPdt621CalendarRuleConHora(t, db, periodYM, 12, models.ActivityRuleCompareDate, "")

	// La actividad quedó en el calendario de noviembre, no en el de octubre.
	var n int64
	db.Table("finance_calendar_activities AS a").
		Joins("JOIN finance_calendars c ON c.id = a.calendar_id").
		Where("c.period_ym = ? AND a.activity_type_snapshot = ?", "2026-11", models.CalendarActivityPDT621).Count(&n)
	if n != 1 {
		t.Fatalf("actividades PDT 621 en el calendario 2026-11 = %d, want 1", n)
	}

	aTiempo := seedEstudioCompany(t, db, "N001")
	tarde := seedEstudioCompany(t, db, "N002")
	recepcionarPdt621EnMomento(t, svc, aTiempo.ID, periodYM, "2026-11-10 09:00")
	recepcionarPdt621EnMomento(t, svc, tarde.ID, periodYM, "2026-11-13 09:00")

	got, err := svc.EnsurePdt621(aTiempo.ID, periodYM)
	if err != nil {
		t.Fatalf("EnsurePdt621 a tiempo: %v", err)
	}
	if got.AssistantTimeliness != TimelinessOnTime {
		t.Fatalf("recepción el 10 de nov (límite 12 de nov): %s, want on_time", got.AssistantTimeliness)
	}
	if got.CalendarDueDate == nil || got.CalendarDueDate.Format("2006-01-02") != "2026-11-12" {
		t.Fatalf("fecha límite = %v, want 2026-11-12", got.CalendarDueDate)
	}
	got, err = svc.EnsurePdt621(tarde.ID, periodYM)
	if err != nil {
		t.Fatalf("EnsurePdt621 tarde: %v", err)
	}
	if got.AssistantTimeliness != TimelinessLate {
		t.Fatalf("recepción el 13 de nov (límite 12 de nov): %s, want late", got.AssistantTimeliness)
	}
}

// La pantalla del calendario evalúa una actividad del calendario de noviembre sobre el trabajo del periodo anterior.
func TestActivityCompliance_UsaElPeriodoAnteriorParaActividadesDeMesSiguiente(t *testing.T) {
	db := setupPdt621TestDBWithCalendar(t)
	svc := NewSupervisorService()
	if _, err := svc.CreatePeriod("2026-10", "test"); err != nil {
		t.Fatalf("CreatePeriod: %v", err)
	}
	seedPdt621CalendarRuleConHora(t, db, "2026-10", 12, models.ActivityRuleCompareDate, "")
	co := seedEstudioCompany(t, db, "N010")
	recepcionarPdt621EnMomento(t, svc, co.ID, "2026-10", "2026-11-10 09:00")

	var act models.FinanceCalendarActivity
	if err := db.Where("activity_type_snapshot = ?", models.CalendarActivityPDT621).First(&act).Error; err != nil {
		t.Fatalf("actividad: %v", err)
	}
	sum, err := NewFinanceCalendarService().ActivityCompliance(act.ID, "", []uint{co.ID})
	if err != nil {
		t.Fatalf("ActivityCompliance: %v", err)
	}
	if sum.DueDate != "2026-11-12" {
		t.Fatalf("fecha límite = %s, want 2026-11-12", sum.DueDate)
	}
	if len(sum.Companies) != 1 || sum.Companies[0].Status == "sin_control" {
		t.Fatalf("debía encontrar el control del periodo 2026-10, got %+v", sum.Companies)
	}
}
