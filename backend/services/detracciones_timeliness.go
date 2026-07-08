package services

import (
	"time"

	"miappfiber/models"
)

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

func computeDetraccionesTimeliness(
	periodYM string,
	status string,
	uploadedAt *time.Time,
	calendarActivity *models.FinanceCalendarActivity,
) UploadTimelinessDTO {
	exempt := detraccionesIsExemptStatus(status)
	act := calendarActivity
	if act == nil {
		act = findDetraccionesCalendarActivity(periodYM)
	}
	return ComputeCalendarActivityTimeliness(periodYM, act, uploadedAt, exempt)
}

func enrichDetraccionesListRow(
	periodYM, status string,
	uploadedAt *time.Time,
	calendarActivity *models.FinanceCalendarActivity,
) UploadTimelinessDTO {
	return computeDetraccionesTimeliness(periodYM, status, uploadedAt, calendarActivity)
}

func enrichDetraccionesDetail(detail *DetraccionesDetail, uploadedAt *time.Time) {
	if detail == nil {
		return
	}
	detail.Timeliness = computeDetraccionesTimeliness(detail.PeriodYM, detail.Declaration.Status, uploadedAt, nil)
}
