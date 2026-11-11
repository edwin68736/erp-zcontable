package services

import (
	"fmt"
	"time"

	"miappfiber/models"
)

// Mes del calendario que fija la fecha límite de una actividad.
//
// El «periodo» de un control es el mes del que trata el trabajo (octubre). Pero no toda actividad se entrega dentro de
// ese mes: unas se hacen y se entregan en el propio mes (Preliminar de ventas, revisión del Buzón SOL) y otras se
// entregan al cerrar el mes, es decir, en el mes siguiente (el PDT de octubre se presenta en noviembre). Para estas
// últimas la fecha límite está en el calendario del mes siguiente al periodo.
//
// Comprobado con los registros reales (agosto a octubre de 2026): el 96 a 100 % de las entregas del PDT 621 cumple
// contra el calendario del mes siguiente, y 0 % contra el del mismo mes.

// CalendarMonthOffset cuántos meses después del periodo cae la fecha límite de este tipo de actividad (0 = el mismo mes).
func CalendarMonthOffset(activityType string) int {
	switch activityType {
	case models.CalendarActivityPDT601,
		models.CalendarActivityPDT621,
		models.CalendarActivityDetracciones, // «Estado cta. detracciones»
		models.CalendarActivityInformeDetracciones,
		models.CalendarActivitySiscontBalances:
		return 1
	default:
		return 0
	}
}

// shiftPeriodYM suma (o resta) meses a un periodo «AAAA-MM». Si el texto no es un periodo válido lo devuelve igual.
func shiftPeriodYM(periodYM string, months int) string {
	var y, m int
	if _, err := fmt.Sscanf(periodYM, "%d-%d", &y, &m); err != nil || m < 1 || m > 12 {
		return periodYM
	}
	t := time.Date(y, time.Month(m)+time.Month(months), 1, 0, 0, 0, 0, time.UTC)
	return fmt.Sprintf("%04d-%02d", t.Year(), int(t.Month()))
}

// CalendarPeriodFor el calendario (mes) donde está la fecha límite de una actividad de este tipo para el periodo dado.
func CalendarPeriodFor(activityType, periodYM string) string {
	return shiftPeriodYM(periodYM, CalendarMonthOffset(activityType))
}

// activityDueDate fecha límite (día del mes, sin hora) de una actividad del calendario para un periodo, según el mes
// que le corresponde a su tipo. Con las actividades del mismo mes equivale a dueDateForActivity(periodYM, act.DueDay).
func activityDueDate(periodYM string, act *models.FinanceCalendarActivity) (time.Time, error) {
	return dueDateForActivity(CalendarPeriodFor(act.ActivityTypeSnapshot, periodYM), act.DueDay)
}
