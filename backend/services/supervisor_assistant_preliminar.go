package services

import (
	"time"

	"miappfiber/database"
	"miappfiber/models"
)

// Preliminar de ventas dentro del panel del asistente. El estudio lo envía dos veces por mes (entrega
// 1 y 2, cada una con su fecha del calendario), así que aporta una obligación por empresa y por
// entrega. Igual que Buzón SOL, solo cuentan las entregas que tienen una actividad de calendario
// detrás: un período sin calendario de Preliminar no aporta nada (ni a favor ni en contra).

// preliminarSlotWork una entrega (empresa × entrega del mes) evaluada contra su fecha del calendario.
type preliminarSlotWork struct {
	Company    models.Company
	SlotIndex  int
	Status     string // pendiente | registrado | enviado
	Suspendida bool
	Timeliness UploadTimelinessDTO
}

// preliminarVentasSlotActivities las actividades de calendario de las 2 entregas del período, en orden
// (la más temprana es la entrega 1). Vacío si el período no tiene calendario de Preliminar.
func preliminarVentasSlotActivities(periodYM string) []models.FinanceCalendarActivity {
	acts, err := CalendarActivitiesForType(periodYM, models.CalendarActivityPreliminarVentas)
	if err != nil || len(acts) == 0 {
		return nil
	}
	if len(acts) > 2 {
		acts = acts[:2]
	}
	return acts
}

// preliminarSlotTimeliness puntualidad de UNA entrega: con regla de plazo se evalúa como cualquier
// actividad del calendario; sin regla, la fecha de la entrega es el plazo. La entrega cuenta como
// ENTREGADA desde que se registran sus datos (no desde que se marca enviada al cliente): `registradoAt`
// es el momento del primer guardado (CreatedAt del registro — el registro solo se crea al guardar).
// Registrar después de la fecha es "entregado fuera de plazo", aunque ya estuviera vencida.
func preliminarSlotTimeliness(due time.Time, ruleID *uint, status string, registradoAt *time.Time, suspendida bool, now time.Time) UploadTimelinessDTO {
	var uploaded *time.Time
	if status == models.PreliminarVentasRegistrado || status == models.PreliminarVentasEnviado {
		uploaded = registradoAt
	}
	tl := ComputeActivityRuleTimeliness(due, ruleID, uploaded, suspendida)
	if tl.Timeliness == TimelinessNoRule {
		tl = preliminarDateTimeliness(due, uploaded, now)
	}
	return tl
}

// preliminarVentasSlotWork evalúa las entregas 1 y 2 de cada empresa en el período.
func (s *SupervisorService) preliminarVentasSlotWork(companies []models.Company, periodYM string) []preliminarSlotWork {
	if len(companies) == 0 {
		return nil
	}
	acts := preliminarVentasSlotActivities(periodYM)
	if len(acts) == 0 {
		return nil
	}
	ids := make([]uint, 0, len(companies))
	for _, c := range companies {
		ids = append(ids, c.ID)
	}

	type ctrlRow struct {
		ID         uint
		CompanyID  uint
		Suspendida bool
	}
	var ctrls []ctrlRow
	_ = database.DB.Table("supervisor_monthly_controls").Select("id, company_id, suspendida").
		Where("company_id IN ? AND period_ym = ? AND deleted_at IS NULL", ids, periodYM).Scan(&ctrls).Error
	ctrlByCompany := make(map[uint]ctrlRow, len(ctrls))
	ctrlIDs := make([]uint, 0, len(ctrls))
	for _, c := range ctrls {
		ctrlByCompany[c.CompanyID] = c
		ctrlIDs = append(ctrlIDs, c.ID)
	}

	type recKey struct {
		control uint
		slot    int
	}
	var recs []models.SupervisorPreliminarVentasRecord
	if len(ctrlIDs) > 0 {
		_ = database.DB.Select("monthly_control_id", "slot_index", "status", "sent_at", "created_at").
			Where("monthly_control_id IN ?", ctrlIDs).Find(&recs).Error
	}
	recByKey := make(map[recKey]models.SupervisorPreliminarVentasRecord, len(recs))
	for _, r := range recs {
		recByKey[recKey{r.MonthlyControlID, r.SlotIndex}] = r
	}

	out := make([]preliminarSlotWork, 0, len(companies)*len(acts))
	for _, co := range companies {
		ctrl := ctrlByCompany[co.ID]
		for i, act := range acts {
			slot := i + 1
			due, err := dueDateForActivity(periodYM, act.DueDay)
			if err != nil {
				continue
			}
			w := preliminarSlotWork{Company: co, SlotIndex: slot, Status: models.PreliminarVentasPendiente, Suspendida: ctrl.Suspendida}
			var registradoAt *time.Time
			if r, ok := recByKey[recKey{ctrl.ID, slot}]; ok {
				w.Status = r.Status
				at := r.CreatedAt
				registradoAt = &at
			}
			w.Timeliness = preliminarSlotTimeliness(due, act.ActivityRuleID, w.Status, registradoAt, ctrl.Suspendida, time.Now())
			out = append(out, w)
		}
	}
	return out
}

// preliminarDateTimeliness puntualidad cuando la actividad del calendario no tiene regla de plazo: la
// fecha de la entrega es el plazo (por día calendario). A diferencia de Informe/Siscont, el Preliminar
// siempre tiene una fecha concreta de envío al cliente, así que sin regla igual se considera vencido
// lo no enviado después de esa fecha.
func preliminarDateTimeliness(due time.Time, sentAt *time.Time, now time.Time) UploadTimelinessDTO {
	day := func(t time.Time) time.Time { return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.Local) }
	d := day(due)
	out := UploadTimelinessDTO{DueAt: &d, UploadedAt: sentAt}
	switch {
	case sentAt != nil && !day(*sentAt).After(d):
		out.Timeliness = TimelinessOnTime
	case sentAt != nil:
		out.Timeliness = TimelinessLate
	case day(now).After(d):
		out.Timeliness = TimelinessMissing
	default:
		out.Timeliness = TimelinessPending
	}
	return out
}

// moduleRowPreliminarVentas fila "Mis módulos" del Preliminar de ventas (una unidad por empresa y entrega).
func moduleRowPreliminarVentas(slots []preliminarSlotWork) DashboardModuleRow {
	out := DashboardModuleRow{Key: models.SupervisorDeclPreliminarVentas, Label: "Preliminar de ventas"}
	for _, w := range slots {
		if w.Suspendida {
			continue
		}
		out.Total++
		// Entregada = registrada (o ya enviada): ver preliminarSlotTimeliness.
		entregada := w.Status == models.PreliminarVentasRegistrado || w.Status == models.PreliminarVentasEnviado
		switch {
		case entregada && w.Timeliness.Timeliness == TimelinessLate:
			out.FueraFecha++
		case entregada:
			out.ATiempo++
		case w.Timeliness.Timeliness == TimelinessMissing:
			out.Vencido++
		default:
			out.Pendiente++
		}
	}
	out.SinCompleta = out.Pendiente + out.Observado + out.Vencido
	return out
}
