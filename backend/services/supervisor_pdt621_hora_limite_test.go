package services

// Regla de fecha Y hora para el PDT 621 (p. ej. "hasta las 15:00 del día programado"): la
// puntualidad usa la fecha + hora de la recepción del supervisor (hora del servidor), no solo el día.
// Cubre el cálculo en Go (lista/detalle/indicadores) y los filtros SQL a tiempo / fuera de plazo.

import (
	"testing"
	"time"

	"miappfiber/database"
	"miappfiber/models"

	"gorm.io/gorm"
)

func seedPdt621CalendarRuleConHora(t *testing.T, db *gorm.DB, periodYM string, dueDay int, compareMode, maxTime string) {
	t.Helper()
	rule := models.ActivityRule{Name: "PDT621 " + compareMode + " " + maxTime, CompareMode: compareMode, MaxUploadTime: maxTime, Active: true}
	if err := db.Create(&rule).Error; err != nil {
		t.Fatalf("seed rule: %v", err)
	}
	tmpl := models.ActivityTemplate{Code: "AC-TEST-PDT621-HORA", Name: "PDT 621", ActivityType: models.CalendarActivityPDT621, ActivityRuleID: &rule.ID, Active: true}
	if err := db.Create(&tmpl).Error; err != nil {
		t.Fatalf("seed template: %v", err)
	}
	cal := models.FinanceCalendar{PeriodYM: periodYM}
	if err := db.Create(&cal).Error; err != nil {
		t.Fatalf("seed calendar: %v", err)
	}
	act := models.FinanceCalendarActivity{
		CalendarID: cal.ID, ActivityTemplateID: tmpl.ID, NameSnapshot: tmpl.Name,
		ActivityTypeSnapshot: models.CalendarActivityPDT621, PrioritySnapshot: "media", DueDay: dueDay, ActivityRuleID: &rule.ID,
	}
	if err := db.Create(&act).Error; err != nil {
		t.Fatalf("seed activity: %v", err)
	}
}

// recepcionarPdt621EnMomento el supervisor asignado recepciona en `momento` ("AAAA-MM-DD HH:MM",
// hora de Lima) y luego se aprueba, para que quede "Entregado".
func recepcionarPdt621EnMomento(t *testing.T, svc *SupervisorService, companyID uint, periodYM, momento string) {
	t.Helper()
	at, err := time.ParseInLocation("2006-01-02 15:04", momento, limaLoc)
	if err != nil {
		t.Fatalf("momento inválido %q: %v", momento, err)
	}
	database.DB.Model(&models.Company{}).Where("id = ?", companyID).Update("supervisor_user_id", testPdt621SupervisorID)
	prev := pdt621Now
	pdt621Now = func() time.Time { return at }
	defer func() { pdt621Now = prev }()
	d, err := svc.RecepcionarPdt621(companyID, periodYM, testPdt621SupervisorID)
	if err != nil {
		t.Fatalf("recepcionar %s: %v", momento, err)
	}
	if _, err := svc.ApproveDeclaration(d.Declaration.ID, testPdt621SupervisorID); err != nil {
		t.Fatalf("approve %s: %v", momento, err)
	}
}

func TestPdt621ReglaHasta15_UsaLaHoraDeRecepcion(t *testing.T) {
	db := setupPdt621TestDBWithCalendar(t)
	svc := NewSupervisorService()
	periodYM := "2026-07"
	if _, err := svc.CreatePeriod(periodYM, "test"); err != nil {
		t.Fatalf("CreatePeriod: %v", err)
	}
	seedPdt621CalendarRuleConHora(t, db, periodYM, 15, models.ActivityRuleCompareDateTime, "15:00")

	cases := []struct {
		code, momento, want string
	}{
		{"H002", "2026-07-15 14:59", TimelinessOnTime},
		{"H003", "2026-07-15 15:00", TimelinessOnTime}, // el límite 15:00 entra
		{"H004", "2026-07-15 15:01", TimelinessLate},
		{"H005", "2026-07-16 09:00", TimelinessLate}, // día siguiente
	}
	ids := map[string]uint{}
	for _, c := range cases {
		co := seedEstudioCompany(t, db, c.code)
		ids[c.code] = co.ID
		recepcionarPdt621EnMomento(t, svc, co.ID, periodYM, c.momento)
	}

	res, err := svc.ListPdt621(Pdt621ListParams{PeriodYM: periodYM, Page: 1, PerPage: 50})
	if err != nil {
		t.Fatalf("ListPdt621: %v", err)
	}
	byCompany := map[uint]Pdt621ListRow{}
	for _, r := range res.Rows {
		byCompany[r.CompanyID] = r
	}
	for _, c := range cases {
		if got := byCompany[ids[c.code]].AssistantTimeliness; got != c.want {
			t.Errorf("%s recepcionado %s: timeliness=%s, want %s", c.code, c.momento, got, c.want)
		}
		d, err := svc.EnsurePdt621(ids[c.code], periodYM)
		if err != nil {
			t.Fatalf("EnsurePdt621: %v", err)
		}
		if d.AssistantTimeliness != c.want {
			t.Errorf("%s detalle: timeliness=%s, want %s", c.code, d.AssistantTimeliness, c.want)
		}
	}

	// Los filtros SQL deben coincidir con el cálculo en Go.
	filtro := func(status string) map[uint]bool {
		r, err := svc.ListPdt621(Pdt621ListParams{PeriodYM: periodYM, Status: status, Page: 1, PerPage: 50})
		if err != nil {
			t.Fatalf("ListPdt621 %s: %v", status, err)
		}
		out := map[uint]bool{}
		for _, row := range r.Rows {
			out[row.CompanyID] = true
		}
		return out
	}
	aTiempo, fuera := filtro(pdt621StatusFilterEntregadoATiempo), filtro(pdt621StatusFilterEntregadoFueraDeFecha)
	for _, c := range cases {
		id := ids[c.code]
		if (c.want == TimelinessOnTime) != aTiempo[id] || (c.want == TimelinessLate) != fuera[id] {
			t.Errorf("%s (%s): filtro a_tiempo=%v fuera=%v, want %s", c.code, c.momento, aTiempo[id], fuera[id], c.want)
		}
	}
}

func TestPdt621ReglaSoloFecha_IgnoraLaHora(t *testing.T) {
	db := setupPdt621TestDBWithCalendar(t)
	svc := NewSupervisorService()
	periodYM := "2026-07"
	if _, err := svc.CreatePeriod(periodYM, "test"); err != nil {
		t.Fatalf("CreatePeriod: %v", err)
	}
	seedPdt621CalendarRuleConHora(t, db, periodYM, 15, models.ActivityRuleCompareDate, "")
	co := seedEstudioCompany(t, db, "F001")
	recepcionarPdt621EnMomento(t, svc, co.ID, periodYM, "2026-07-15 23:30")

	d, err := svc.EnsurePdt621(co.ID, periodYM)
	if err != nil {
		t.Fatalf("EnsurePdt621: %v", err)
	}
	if d.AssistantTimeliness != TimelinessOnTime {
		t.Fatalf("regla solo-fecha, recepción el mismo día a las 23:30: %s, want on_time", d.AssistantTimeliness)
	}
	r, err := svc.ListPdt621(Pdt621ListParams{PeriodYM: periodYM, Status: pdt621StatusFilterEntregadoATiempo, Page: 1, PerPage: 20})
	if err != nil {
		t.Fatalf("ListPdt621: %v", err)
	}
	if len(r.Rows) != 1 {
		t.Fatalf("filtro a_tiempo con regla solo-fecha debía traer la empresa, trajo %d", len(r.Rows))
	}
}

// La pantalla oculta Recepcionar hasta el día programado (campo Disponible); el backend NO lo
// bloquea, a propósito, para poder permitir entregas anticipadas más adelante.
func TestPdt621Recepcion_DisponibleDesdeElDiaProgramado(t *testing.T) {
	db := setupPdt621TestDBWithCalendar(t)
	svc := NewSupervisorService()
	periodYM := "2026-07"
	if _, err := svc.CreatePeriod(periodYM, "test"); err != nil {
		t.Fatalf("CreatePeriod: %v", err)
	}
	seedPdt621CalendarRuleConHora(t, db, periodYM, 15, models.ActivityRuleCompareDateTime, "15:00")
	co := seedEstudioCompany(t, db, "B001")
	database.DB.Model(&models.Company{}).Where("id = ?", co.ID).Update("supervisor_user_id", testPdt621SupervisorID)

	prev := pdt621Now
	defer func() { pdt621Now = prev }()
	enLima := func(s string) func() time.Time {
		at, _ := time.ParseInLocation("2006-01-02 15:04", s, limaLoc)
		return func() time.Time { return at }
	}

	// Un día antes (a última hora, hora de Lima): no disponible.
	pdt621Now = enLima("2026-07-14 23:59")
	res, err := svc.ListPdt621(Pdt621ListParams{PeriodYM: periodYM, Page: 1, PerPage: 20})
	if err != nil || len(res.Rows) != 1 {
		t.Fatalf("ListPdt621: %v", err)
	}
	if res.Rows[0].Disponible || res.Rows[0].CalendarDueDate == nil {
		t.Fatalf("antes del día: disponible=%v due=%v, want false y fecha", res.Rows[0].Disponible, res.Rows[0].CalendarDueDate)
	}
	if d, err := svc.EnsurePdt621(co.ID, periodYM); err != nil || d.Disponible {
		t.Fatalf("detalle antes del día: disponible debía ser false (err=%v)", err)
	}

	// El día programado: disponible.
	pdt621Now = enLima("2026-07-15 08:00")
	if d, err := svc.EnsurePdt621(co.ID, periodYM); err != nil || !d.Disponible {
		t.Fatalf("el día programado debía estar disponible (err=%v)", err)
	}

	// El backend no bloquea por fecha: una recepción anticipada (vía API) se acepta.
	pdt621Now = enLima("2026-07-10 09:00")
	if _, err := svc.RecepcionarPdt621(co.ID, periodYM, testPdt621SupervisorID); err != nil {
		t.Fatalf("el backend no debía rechazar una recepción anticipada: %v", err)
	}
}
