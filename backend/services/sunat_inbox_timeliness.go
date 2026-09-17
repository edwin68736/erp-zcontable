package services

import (
	"sort"
	"time"

	"miappfiber/database"
	"miappfiber/models"
)

// mailboxTimelinessCtx `calendarActs` reemplaza a la única actividad que se usaba antes — §5.9.6.5:
// Buzón SOL retipeado tiene hasta 8 actividades reales por mes (una por miércoles/sábado, cada una
// movible por feriado individualmente), no una sola con start_day/end_day genérico. Ver
// sunatInboxCalendarActivitiesForPeriod.
type mailboxTimelinessCtx struct {
	periodYM     string
	weekStart    time.Time
	slotsPerWeek int
	calendarActs []models.FinanceCalendarActivity
}

// FindSunatInboxCalendarActivity instancia mensual de buzón (tipo sunat_inbox o regla de hora legacy).
func FindSunatInboxCalendarActivity(periodYM string) *models.FinanceCalendarActivity {
	if act, err := FindCalendarActivityByType(periodYM, models.CalendarActivitySunatInbox); err == nil {
		return act
	}

	var act models.FinanceCalendarActivity
	err := database.DB.Table("finance_calendar_activities AS a").
		Select("a.*").
		Joins("INNER JOIN finance_calendars c ON c.id = a.calendar_id AND c.deleted_at IS NULL").
		Joins("INNER JOIN activity_templates t ON t.id = a.activity_template_id AND t.deleted_at IS NULL").
		Where("c.period_ym = ? AND t.activity_type = ? AND a.deleted_at IS NULL", periodYM, models.CalendarActivitySunatInbox).
		Order("a.due_day ASC, a.id ASC").
		First(&act).Error
	if err == nil {
		return &act
	}

	// Legacy: actividad de calendario con regla de hora límite (p. ej. plantilla aún tipo nps/other).
	err = database.DB.Table("finance_calendar_activities AS a").
		Select("a.*").
		Joins("INNER JOIN finance_calendars c ON c.id = a.calendar_id AND c.deleted_at IS NULL").
		Joins("INNER JOIN activity_rules r ON r.id = a.activity_rule_id AND r.deleted_at IS NULL").
		Where("c.period_ym = ? AND a.deleted_at IS NULL", periodYM).
		Where("a.activity_rule_id IS NOT NULL AND a.activity_rule_id > 0").
		Where("r.compare_mode = ? AND r.active = ?", models.ActivityRuleCompareDateTime, true).
		Order("a.due_day ASC, a.id ASC").
		First(&act).Error
	if err == nil {
		return &act
	}
	return nil
}

// sunatInboxCalendarActivitiesForPeriod TODAS las actividades de calendario tipo sunat_inbox del
// período (§5.9.6.5 — hasta 8, una por miércoles/sábado del mes). Si el calendario de ese período
// todavía no está retipeado (o simplemente no tiene ninguna instancia tipo sunat_inbox), cae al
// mismo mecanismo legacy de una sola actividad que ya resolvía FindSunatInboxCalendarActivity
// (plantilla nps con regla de hora, o sin ninguna actividad configurada) — envuelta en una lista de 1
// para reusar el mismo cálculo de fechas que las actividades reales.
func sunatInboxCalendarActivitiesForPeriod(periodYM string) []models.FinanceCalendarActivity {
	if acts, err := CalendarActivitiesForType(periodYM, models.CalendarActivitySunatInbox); err == nil && len(acts) > 0 {
		return acts
	}
	if act := FindSunatInboxCalendarActivity(periodYM); act != nil {
		return []models.FinanceCalendarActivity{*act}
	}
	return nil
}

func mailboxTimelinessCtxFor(periodYM string, weekStart time.Time, slotsPerWeek int) mailboxTimelinessCtx {
	return mailboxTimelinessCtx{
		periodYM:     periodYM,
		weekStart:    weekStart,
		slotsPerWeek: slotsPerWeek,
		calendarActs: sunatInboxCalendarActivitiesForPeriod(periodYM),
	}
}

func mailboxTimelinessCtxFromSlot(slot *models.SupervisorMailboxCaptureSlot, slotsPerWeek int) mailboxTimelinessCtx {
	periodYM := ""
	if slot != nil && slot.MonthlyControl != nil {
		periodYM = slot.MonthlyControl.PeriodYM
	}
	weekStart := time.Time{}
	if slot != nil {
		weekStart = slot.WeekStart
	}
	return mailboxTimelinessCtxFor(periodYM, weekStart, slotsPerWeek)
}

// dueDateForMailboxSlot día calendario del plazo para una captura semanal concreta. Con actividades
// reales configuradas (§5.9.6.5), `slotIndex` elige entre las fechas reales que caen en esta semana,
// en orden cronológico (slot 1 = la más temprana) — no por RUC ni por posición fija matemática. Sin
// ninguna fecha real en la semana (calendario sin retipear, o menos actividades de las esperadas),
// cae al reparto matemático de siempre.
func dueDateForMailboxSlot(periodYM string, weekStart time.Time, slotIndex, slotsPerWeek int, acts []models.FinanceCalendarActivity) time.Time {
	weekEnd := weekStart.AddDate(0, 0, 6)
	days := mailboxDueDatesInWeekFromActivities(acts, periodYM, weekStart, weekEnd)
	if len(days) > 0 {
		idx := slotIndex - 1
		if idx >= len(days) {
			idx = len(days) - 1
		}
		return days[idx]
	}
	return mailboxSlotDefaultDueDay(weekStart, slotIndex, slotsPerWeek)
}

// mailboxDueDatesInWeekFromActivities junta las fechas reales (una o más actividades, §5.9.6.5) que
// caen dentro de [weekStart, weekEnd], ordenadas ascendente — reusa mailboxDueDaysInWeek por cada
// actividad (mismo criterio de start_day/end_day/due_day que ya tenía una sola actividad).
func mailboxDueDatesInWeekFromActivities(acts []models.FinanceCalendarActivity, periodYM string, weekStart, weekEnd time.Time) []time.Time {
	var out []time.Time
	for _, act := range acts {
		out = append(out, mailboxDueDaysInWeek(periodYM, weekStart, weekEnd, act.StartDay, act.EndDay, act.DueDay)...)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Before(out[j]) })
	return out
}

func mailboxDueDaysInWeek(periodYM string, weekStart, weekEnd time.Time, startDay, endDay, dueDay int) []time.Time {
	var out []time.Time
	if startDay > 0 && endDay >= startDay {
		for d := startDay; d <= endDay; d++ {
			dt, err := dueDateForActivity(periodYM, d)
			if err != nil {
				continue
			}
			if !dt.Before(weekStart) && !dt.After(weekEnd) {
				out = append(out, dt)
			}
		}
	}
	if len(out) == 0 && dueDay > 0 {
		dt, err := dueDateForActivity(periodYM, dueDay)
		if err == nil && !dt.Before(weekStart) && !dt.After(weekEnd) {
			out = append(out, dt)
		}
	}
	return out
}

func mailboxSlotDefaultDueDay(weekStart time.Time, slotIndex, slotsPerWeek int) time.Time {
	if slotsPerWeek <= 1 {
		return weekStart
	}
	span := 6
	offset := (slotIndex - 1) * span / (slotsPerWeek - 1)
	if offset > span {
		offset = span
	}
	return weekStart.AddDate(0, 0, offset)
}

func enrichSunatInboxMailboxSideTimeliness(ctx mailboxTimelinessCtx, slotIndex int, uploadedAt *time.Time) UploadTimelinessDTO {
	var ruleID *uint
	if len(ctx.calendarActs) > 0 {
		// Las 8 actividades reales de un mismo mes comparten la misma regla de hora ("CONTROL DE
		// HORA") — se toma la primera como representativa en vez de buscar la actividad exacta del
		// slot, para no complicar el cálculo con algo que en la práctica nunca varía entre ellas.
		ruleID = ctx.calendarActs[0].ActivityRuleID
	}
	dueDate := dueDateForMailboxSlot(ctx.periodYM, ctx.weekStart, slotIndex, ctx.slotsPerWeek, ctx.calendarActs)
	return ComputeActivityRuleTimeliness(dueDate, ruleID, uploadedAt, false)
}

func enrichSunatInboxCaptureSlotTimeliness(slot SunatInboxCaptureSlot, ctx mailboxTimelinessCtx) SunatInboxCaptureSlot {
	slot.Sunat.Timeliness = enrichSunatInboxMailboxSideTimeliness(ctx, slot.SlotIndex, slot.Sunat.UploadedAt)
	slot.Sunafil.Timeliness = enrichSunatInboxMailboxSideTimeliness(ctx, slot.SlotIndex, slot.Sunafil.UploadedAt)
	return slot
}

func buildSunatInboxSlots(dbSlots map[int]*models.SupervisorMailboxCaptureSlot, n int, ctx mailboxTimelinessCtx) []SunatInboxCaptureSlot {
	out := make([]SunatInboxCaptureSlot, 0, n)
	for i := 1; i <= n; i++ {
		dto := captureSlotDTO(dbSlots[i], i)
		dto = enrichSunatInboxCaptureSlotTimeliness(dto, ctx)
		out = append(out, dto)
	}
	return out
}

// sunatInboxRealSlot un slot real del período (§5.9.6.5) — a diferencia de la grilla en pantalla
// (que siempre muestra `slotsPerWeek` columnas por semana, reales o no), esto es SOLO lo que tiene
// una actividad de calendario real detrás, para no inflar el conteo de cumplimiento con slots
// matemáticos que no representan ninguna obligación real (§5.9.6.3).
type sunatInboxRealSlot struct {
	weekStart time.Time
	slotIndex int
	dueDate   time.Time
	ruleID    *uint
}

// sunatInboxRealSlotsForPeriod agrupa las actividades de calendario tipo sunat_inbox de un período
// (§5.9.6.5 — hasta 8, una por miércoles/sábado) en semanas (lunes de cada una) y les asigna
// slotIndex por orden cronológico dentro de cada semana — mismo criterio de agrupación que
// mailboxDueDatesInWeekFromActivities/dueDateForMailboxSlot usan para UNA semana ya conocida, pero
// acá para TODO el período de una sola vez (usado por el agregado de cumplimiento, no por la grilla
// en pantalla). Sin ninguna actividad real configurada, devuelve una lista vacía — un período sin
// calendario no aporta nada al agregado (ni a favor ni en contra), no hay reparto matemático acá.
//
// A propósito usa CalendarActivitiesForType directo (activity_type_snapshot = 'sunat_inbox'), NO
// sunatInboxCalendarActivitiesForPeriod/FindSunatInboxCalendarActivity — esas funciones existen para
// la GRILLA en pantalla, donde mostrar una fecha aproximada (vía sus 2 mecanismos de fallback legacy)
// es mejor que no mostrar nada. Para el AGREGADO de cumplimiento eso es activamente incorrecto:
// confirmado con datos reales que el fallback "por plantilla" de FindSunatInboxCalendarActivity
// puede enganchar una actividad de OTRO mes que nunca se retipeó (su activity_type_snapshot sigue en
// nps, pero su activity_template_id apunta a una plantilla que HOY es sunat_inbox) y sin regla
// propia — eso inflaba "Exento o no aplica" en cientos de unidades que no correspondían a ninguna
// obligación real. Un período sin actividades sunat_inbox correctamente tipadas debe aportar 0, no
// una aproximación.
func sunatInboxRealSlotsForPeriod(periodYM string) []sunatInboxRealSlot {
	acts, err := CalendarActivitiesForType(periodYM, models.CalendarActivitySunatInbox)
	if err != nil {
		acts = nil
	}
	type dated struct {
		date time.Time
		act  models.FinanceCalendarActivity
	}
	dd := make([]dated, 0, len(acts))
	for _, act := range acts {
		d, err := dueDateForActivity(periodYM, act.DueDay)
		if err != nil {
			continue
		}
		dd = append(dd, dated{date: d, act: act})
	}
	sort.Slice(dd, func(i, j int) bool { return dd[i].date.Before(dd[j].date) })

	slotSeq := map[string]int{}
	out := make([]sunatInboxRealSlot, 0, len(dd))
	for _, d := range dd {
		wk := mondayOfWeekContaining(d.date)
		wkKey := formatWeekStart(wk)
		slotSeq[wkKey]++
		out = append(out, sunatInboxRealSlot{
			weekStart: wk,
			slotIndex: slotSeq[wkKey],
			dueDate:   d.date,
			ruleID:    d.act.ActivityRuleID,
		})
	}
	return out
}
