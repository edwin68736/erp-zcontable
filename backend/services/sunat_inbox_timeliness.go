package services

import (
	"time"

	"miappfiber/database"
	"miappfiber/models"
)

type mailboxTimelinessCtx struct {
	periodYM     string
	weekStart    time.Time
	slotsPerWeek int
	calendarAct  *models.FinanceCalendarActivity
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

func mailboxTimelinessCtxFor(periodYM string, weekStart time.Time, slotsPerWeek int) mailboxTimelinessCtx {
	return mailboxTimelinessCtx{
		periodYM:     periodYM,
		weekStart:    weekStart,
		slotsPerWeek: slotsPerWeek,
		calendarAct:  FindSunatInboxCalendarActivity(periodYM),
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

// dueDateForMailboxSlot día calendario del plazo para una captura semanal concreta.
func dueDateForMailboxSlot(periodYM string, weekStart time.Time, slotIndex, slotsPerWeek int, cal *models.FinanceCalendarActivity) time.Time {
	weekEnd := weekStart.AddDate(0, 0, 6)
	if cal != nil {
		days := mailboxDueDaysInWeek(periodYM, weekStart, weekEnd, cal.StartDay, cal.EndDay, cal.DueDay)
		if len(days) > 0 {
			idx := slotIndex - 1
			if idx >= len(days) {
				idx = len(days) - 1
			}
			return days[idx]
		}
	}
	return mailboxSlotDefaultDueDay(weekStart, slotIndex, slotsPerWeek)
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
	if ctx.calendarAct != nil {
		ruleID = ctx.calendarAct.ActivityRuleID
	}
	dueDate := dueDateForMailboxSlot(ctx.periodYM, ctx.weekStart, slotIndex, ctx.slotsPerWeek, ctx.calendarAct)
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
