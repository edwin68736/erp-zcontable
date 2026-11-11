package services

import (
	"strings"
	"time"

	"miappfiber/models"
)

// El PDT 621 tiene DOS tareas por empresa y mes, de dos responsables distintos, medidas contra la MISMA actividad del
// calendario interno (la de su dígito de RUC, en el calendario del mes siguiente al periodo):
//
//	Archivador  (asistente)   lo recepciona el supervisor; se mide la recepción con FECHA Y HORA (regla de la actividad).
//	Declaración (supervisor)  la fecha en que el supervisor declara; se mide solo por FECHA.
//
// Normalmente son el mismo día, pero pueden diferir: el asistente puede cumplir su parte hoy y el supervisor declarar
// mañana; entonces el asistente cumplió y el supervisor quedó fuera de fecha. La fecha oficial de SUNAT (cronograma por
// dígito de RUC) deja de usarse para medir el cumplimiento y queda solo como dato informativo.

// pdt621ArchivadorTimeliness cumplimiento de la tarea del asistente (el archivador).
//   - Suspendida: no aplica.
//   - Observado: la tarea sigue abierta; se evalúa como si no hubiera entrega (pendiente, o vencida si ya pasó el plazo).
//   - Con segunda entrega (se entregó de nuevo tras una observación): siempre fuera de fecha u hora, aunque la primera
//     hubiera sido a tiempo.
//   - En otro caso: la primera recepción contra el día y la hora límite de la actividad.
func pdt621ArchivadorTimeliness(periodYM string, act *models.FinanceCalendarActivity, rec *Pdt621RecordDTO, status string, exempt bool) UploadTimelinessDTO {
	if status == models.SupervisorDeclObservado {
		return ComputeCalendarActivityTimeliness(periodYM, act, nil, exempt)
	}
	var primera *time.Time
	if rec != nil {
		primera = pdt621PrimeraEntregaAt(rec.PrimeraEntregaFecha, rec.PrimeraEntregaHora)
	}
	res := ComputeCalendarActivityTimeliness(periodYM, act, primera, exempt)
	if !exempt && res.Timeliness == TimelinessOnTime && pdt621TieneSegundaEntrega(rec) {
		res.Timeliness = TimelinessLate
	}
	return res
}

func pdt621TieneSegundaEntrega(rec *Pdt621RecordDTO) bool {
	return rec != nil && rec.SegundaEntregaFecha != nil && strings.TrimSpace(*rec.SegundaEntregaFecha) != ""
}

// pdt621DeclarationTimeliness cumplimiento de la tarea del supervisor (la declaración): la fecha de declaración contra
// el día de la actividad del calendario, sin hora. Sin actividad en el calendario no hay contra qué medir.
func pdt621DeclarationTimeliness(periodYM string, act *models.FinanceCalendarActivity, rec *Pdt621RecordDTO, exempt bool) string {
	if act == nil {
		if exempt {
			return TimelinessExempt
		}
		return TimelinessNoRule
	}
	due, err := activityDueDate(periodYM, act)
	if err != nil {
		if exempt {
			return TimelinessExempt
		}
		return TimelinessNoRule
	}
	var declaredAt *time.Time
	if rec != nil && rec.FechaDeclaracion != nil {
		declaredAt = pdt601ParseDate(*rec.FechaDeclaracion)
	}
	deadline := time.Date(due.Year(), due.Month(), due.Day(), 23, 59, 59, 0, time.Local)
	return EvaluateUploadTimeliness(time.Now(), declaredAt, deadline, true, exempt, models.ActivityRuleCompareDate)
}

// pdt621ArchivadorTardio true si el archivador llegó fuera de plazo o aún no llega pasado el plazo: sirve para marcar
// que una declaración tardía del supervisor puede deberse al retraso del archivador y no solo a él.
func pdt621ArchivadorTardio(archivador string) bool {
	return archivador == TimelinessLate || archivador == TimelinessMissing
}
