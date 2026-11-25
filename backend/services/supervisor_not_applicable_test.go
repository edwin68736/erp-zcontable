package services

import (
	"strings"
	"testing"
	"time"

	"miappfiber/models"

	"gorm.io/gorm"
)

const naPeriod, naPrev = "2026-10", "2026-09"

func setupNotApplicableTestDB(t *testing.T) (*gorm.DB, *SupervisorService) {
	t.Helper()
	db := setupDashboardOverviewTestDB(t)
	if err := db.AutoMigrate(&models.SupervisorMailboxCaptureSlot{}, &models.SupervisorNotApplicableReview{}, &models.FirmConfig{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	prevNow := notApplicableNow
	notApplicableNow = func() time.Time { return time.Date(2026, time.October, 15, 10, 0, 0, 0, time.Local) }
	t.Cleanup(func() { notApplicableNow = prevNow })
	svc := NewSupervisorService()
	for _, ym := range []string{naPrev, naPeriod} {
		if _, err := svc.CreatePeriod(ym, "test"); err != nil {
			t.Fatalf("CreatePeriod %s: %v", ym, err)
		}
	}
	return db, svc
}

func seedPreliminarCalendar(t *testing.T, db *gorm.DB, periodYM string) {
	t.Helper()
	tmpl := models.ActivityTemplate{Code: "AC-PRELIM-NA", Name: "PRELIMINAR DE VENTAS", ActivityType: models.CalendarActivityPreliminarVentas, Active: true}
	if err := db.Create(&tmpl).Error; err != nil {
		t.Fatalf("template: %v", err)
	}
	cal := models.FinanceCalendar{PeriodYM: periodYM}
	if err := db.Where("period_ym = ?", periodYM).FirstOrCreate(&cal).Error; err != nil {
		t.Fatalf("calendar: %v", err)
	}
	for _, d := range []int{5, 20} {
		act := models.FinanceCalendarActivity{CalendarID: cal.ID, ActivityTemplateID: tmpl.ID, NameSnapshot: tmpl.Name,
			ActivityTypeSnapshot: models.CalendarActivityPreliminarVentas, PrioritySnapshot: "media", TextColorSnapshot: "#000",
			StartDay: d, EndDay: d, DueDay: d}
		if err := db.Create(&act).Error; err != nil {
			t.Fatalf("activity: %v", err)
		}
	}
}

var naAllActivities = []string{
	models.SupervisorDeclPDT601, models.SupervisorDeclPDT621, models.SupervisorDeclDetracciones, models.SupervisorDeclSunatInbox,
	models.SupervisorDeclInformeDetracciones, models.SupervisorDeclSiscontBalances, models.SupervisorDeclPreliminarVentas,
}

// Marcar saca a la empresa de la evaluación en cada actividad (y solo a ella); quitar la marca la devuelve.
func TestNotApplicable_MarcaExcluyeYSeQuita(t *testing.T) {
	db, svc := setupNotApplicableTestDB(t)
	seedSunatInboxCalendarActivities(t, db, naPeriod, []int{6, 13})
	seedPreliminarCalendar(t, db, naPeriod)
	a, b := seedEstudioCompany(t, db, "NA01"), seedEstudioCompany(t, db, "NA02")

	build := func() *assistantBuild {
		out, err := svc.assistantBuild(naPeriod, []models.Company{a, b}, true, "", false)
		if err != nil {
			t.Fatalf("build: %v", err)
		}
		return out
	}
	tasks := func(p AssistantProgress) int64 { return p.Completed + p.InReview + p.Pending + p.Overdue + p.Observed }
	keys := append([]string{pdt621DeclarationKey}, naAllActivities...)
	before := build()

	for _, key := range naAllActivities {
		if err := svc.SetNotApplicable(key, a.ID, naPeriod, true, 1); err != nil {
			t.Fatalf("marcar %s: %v", key, err)
		}
	}
	marked := build()
	for _, key := range keys {
		pa, pb := marked.PerCompany[a.ID][key], marked.PerCompany[b.ID][key]
		if tasks(pa) != 0 || pa.NotApplicable == 0 {
			t.Errorf("%s: A debe quedar solo como «no aplica»: %+v", key, pa)
		}
		if tasks(pb) != tasks(before.PerCompany[b.ID][key]) || tasks(pb) == 0 {
			t.Errorf("%s: B no debe cambiar: antes %+v ahora %+v", key, before.PerCompany[b.ID][key], pb)
		}
	}

	// Bloqueos mientras está marcada.
	if _, err := svc.SavePdt621Record(a.ID, naPeriod, Pdt621RecordInput{}); err == nil {
		t.Error("PDT 621 marcado no debe permitir guardar")
	}
	if _, err := svc.SavePreliminarVentasSlotRecord(a.ID, naPeriod, 1, PreliminarVentasRecordInput{IgvAplicable18: true}); err == nil {
		t.Error("Preliminar marcado no debe permitir guardar")
	}
	detail, err := svc.EnsurePdfReport(PdfReportSiscontBalances, a.ID, naPeriod)
	if err != nil || CheckPdfReportSubmittable(detail) == nil {
		t.Errorf("Siscont marcado no debe permitir cargar (err=%v)", err)
	}

	for _, key := range naAllActivities {
		if err := svc.SetNotApplicable(key, a.ID, naPeriod, false, 1); err != nil {
			t.Fatalf("quitar %s: %v", key, err)
		}
	}
	after := build()
	for _, key := range keys {
		if got, want := tasks(after.PerCompany[a.ID][key]), tasks(before.PerCompany[a.ID][key]); got != want {
			t.Errorf("%s: al quitar la marca vuelve a evaluarse: %d, want %d", key, got, want)
		}
	}
}

// Lo ya entregado no se puede sacar de la evaluación.
func TestNotApplicable_NoSeMarcaLoYaEntregado(t *testing.T) {
	db, svc := setupNotApplicableTestDB(t)
	co := seedEstudioCompany(t, db, "NA03")
	pdfReportSubmit(t, svc, PdfReportInformeDetracciones, co.ID, naPeriod, "2026-10-02")

	err := svc.SetNotApplicable(models.SupervisorDeclInformeDetracciones, co.ID, naPeriod, true, 1)
	if err == nil || !strings.Contains(err.Error(), "ya tiene") {
		t.Fatalf("debe rechazar la marca con archivo entregado: %v", err)
	}
	if _, err := svc.SavePdt601Planilla(co.ID, naPeriod, Pdt601PlanillaInput{RegimenLaboral: models.Pdt601RegimenGeneral, TrabajadoresONP: 2}); err != nil {
		t.Fatalf("planilla: %v", err)
	}
	if err := svc.SetNotApplicable(models.SupervisorDeclPDT601, co.ID, naPeriod, true, 1); err == nil {
		t.Fatal("no se marca «sin planilla» sobre una planilla con trabajadores")
	}
}

// El periodo siguiente propone mantener la marca; lo revisado (se mantenga o no) no se vuelve a preguntar.
func TestNotApplicable_Arrastre(t *testing.T) {
	db, svc := setupNotApplicableTestDB(t)
	a, b, c := seedEstudioCompany(t, db, "NA11"), seedEstudioCompany(t, db, "NA12"), seedEstudioCompany(t, db, "NA13")
	for _, key := range []string{models.SupervisorDeclPDT621, models.SupervisorDeclPDT601} {
		if key == models.SupervisorDeclPDT601 {
			for _, co := range []models.Company{a, b, c} {
				if _, err := svc.SavePdt601Planilla(co.ID, naPrev, Pdt601PlanillaInput{RegimenLaboral: models.Pdt601RegimenRemype, SinPlanilla: true}); err != nil {
					t.Fatalf("sin planilla: %v", err)
				}
			}
		} else {
			for _, co := range []models.Company{a, b, c} {
				if err := svc.SetNotApplicable(key, co.ID, naPrev, true, 1); err != nil {
					t.Fatalf("marcar anterior: %v", err)
				}
			}
		}

		st, err := svc.GetNotApplicableCarryOver(key, naPeriod, nil)
		if err != nil || !st.Pending || len(st.Companies) != 3 || st.PreviousPeriodYM != naPrev {
			t.Fatalf("%s: candidatas: %+v err=%v", key, st, err)
		}
		// Alcance: quien solo ve a «a» no puede colar a «b».
		res, err := svc.ApplyNotApplicableCarryOver(key, naPeriod, []uint{a.ID, b.ID}, []uint{a.ID, b.ID}, []uint{a.ID}, 1)
		if err != nil || res.Applied != 1 {
			t.Fatalf("%s: aplicar con alcance: %+v err=%v", key, res, err)
		}
		st, _ = svc.GetNotApplicableCarryOver(key, naPeriod, nil)
		if len(st.Companies) != 2 {
			t.Fatalf("%s: deben quedar b y c por revisar: %+v", key, st.Companies)
		}
		res, err = svc.ApplyNotApplicableCarryOver(key, naPeriod, []uint{b.ID}, []uint{b.ID, c.ID}, nil, 1)
		if err != nil || res.Applied != 1 || len(res.Skipped) != 0 {
			t.Fatalf("%s: aplicar: %+v err=%v", key, res, err)
		}
		st, _ = svc.GetNotApplicableCarryOver(key, naPeriod, nil)
		if st.Pending {
			t.Fatalf("%s: no debe volver a preguntar: %+v", key, st.Companies)
		}
		got := notApplicableCompanies(naPeriod, key, nil)
		if !got[a.ID] || !got[b.ID] || got[c.ID] {
			t.Fatalf("%s: marcadas en el periodo: %+v", key, got)
		}
	}
	if r := previousRegimenLaboral(a.ID, "2026-11"); r != models.Pdt601RegimenRemype {
		t.Fatalf("el arrastre de planilla conserva el régimen: %q", r)
	}
	// Los periodos viejos no se preguntan.
	if st, _ := svc.GetNotApplicableCarryOver(models.SupervisorDeclPDT621, "2026-08", nil); st.Pending {
		t.Fatal("un periodo viejo no debe preguntar")
	}
}
