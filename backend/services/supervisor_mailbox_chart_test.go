package services

import (
	"testing"
	"time"

	"miappfiber/models"
)

// El gráfico «Revisión de buzones» y la tarjeta Buzón SOL cuentan lo mismo: una captura observada por el supervisor deja de ser una
// entrega y pasa a pendiente en ambos.
func TestDashboardProgress_BuzonesCuadranConElModuloAunConObservadas(t *testing.T) {
	db := setupSunatInboxSummaryTestDB(t)
	svc := NewSupervisorService()
	periodYM := "2026-09"
	seedSunatInboxCalendarActivities(t, db, periodYM, []int{10})
	co := seedEstudioCompany(t, db, "M030")

	dueDate := time.Date(2026, time.September, 10, 0, 0, 0, 0, time.Local)
	ctrl := models.SupervisorMonthlyControl{CompanyID: co.ID, PeriodYM: periodYM, GeneralStatus: models.SupervisorControlPendiente, RiskLevel: models.SupervisorRiskBajo}
	if err := db.Create(&ctrl).Error; err != nil {
		t.Fatalf("control: %v", err)
	}
	uploadedAt := time.Date(2026, time.September, 10, 9, 0, 0, 0, time.Local)
	slot := models.SupervisorMailboxCaptureSlot{
		MonthlyControlID: ctrl.ID, WeekStart: mondayOfWeekContaining(dueDate), SlotIndex: 1, SlotsPerWeek: 1,
		SunatStatus: models.SupervisorMailboxStatusObservado, SunatUploadedAt: &uploadedAt, // subida a tiempo y luego observada
		SunafilStatus: models.SupervisorMailboxStatusCargado, SunafilUploadedAt: &uploadedAt,
	}
	if err := db.Create(&slot).Error; err != nil {
		t.Fatalf("slot: %v", err)
	}

	rows := svc.indicatorMailboxes(periodYM, []models.Company{co})
	if len(rows) != 1 {
		t.Fatalf("filas: %+v", rows)
	}
	r := rows[0]
	if r.SunatOk != 0 || r.SunatPending != 1 || r.SunatLate != 0 || r.SunafilOk != 1 || r.SunafilPending != 0 {
		t.Fatalf("SUNAT observada debe figurar pendiente y SUNAFIL a tiempo: %+v", r)
	}
	if len(r.Companies) != 1 || r.Companies[0].SunatPending != 1 || r.Companies[0].SunafilPending != 0 {
		t.Fatalf("lista de empresas: %+v", r.Companies)
	}
}
