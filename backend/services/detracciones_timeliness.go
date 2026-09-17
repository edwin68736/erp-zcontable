package services

import (
	"time"

	"miappfiber/models"
)

// detraccionesIsExemptStatus exención por el propio status de la declaración (sin_clave/
// no_corresponde) — no cubre "suspendida", que desde §5.9.7 es global por control, ver
// controlSuspendida en computeDetraccionesTimeliness.
func detraccionesIsExemptStatus(status string) bool {
	switch normalizeDetraccionesDisplayStatus(status) {
	case models.SupervisorDetraccionSinClave, models.SupervisorDetraccionNoCorresponde:
		return true
	default:
		return false
	}
}

func findDetraccionesCalendarActivity(periodYM string) *models.FinanceCalendarActivity {
	act, err := FindCalendarActivityByType(periodYM, models.CalendarActivityDetracciones)
	if err != nil {
		return nil
	}
	return act
}

// computeDetraccionesTimeliness `controlSuspendida` es SupervisorMonthlyControl.Suspendida
// (docs/diseno-limpieza-control-detail-2026-09-16.md §5.9.7) — global, se suma a la exención propia
// del status (sin_clave/no_corresponde).
func computeDetraccionesTimeliness(
	periodYM string,
	status string,
	controlSuspendida bool,
	uploadedAt *time.Time,
	calendarActivity *models.FinanceCalendarActivity,
) UploadTimelinessDTO {
	exempt := controlSuspendida || detraccionesIsExemptStatus(status)
	act := calendarActivity
	if act == nil {
		act = findDetraccionesCalendarActivity(periodYM)
	}
	return ComputeCalendarActivityTimeliness(periodYM, act, uploadedAt, exempt)
}

func enrichDetraccionesListRow(
	periodYM, status string,
	controlSuspendida bool,
	uploadedAt *time.Time,
	calendarActivity *models.FinanceCalendarActivity,
) UploadTimelinessDTO {
	return computeDetraccionesTimeliness(periodYM, status, controlSuspendida, uploadedAt, calendarActivity)
}

func enrichDetraccionesDetail(detail *DetraccionesDetail, uploadedAt *time.Time) {
	if detail == nil {
		return
	}
	detail.Timeliness = computeDetraccionesTimeliness(detail.PeriodYM, detail.Declaration.Status, detail.Suspendida, uploadedAt, nil)
}
