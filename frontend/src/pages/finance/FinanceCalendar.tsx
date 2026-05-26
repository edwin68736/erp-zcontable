import { useCallback, useEffect, useMemo, useState } from 'react';
import { saveAs } from 'file-saver';
import { buildFinanceCalendarPdf, financeCalendarPdfFilename } from '../../pdf/financeCalendarPdfBuild';
import {
  financeCalendarService,
  type CalendarComplianceSummary,
  type FinanceCalendarActivity,
  type FinanceCalendarDetail,
} from '../../services/financeCalendar';
import { auth } from '../../services/auth';
import { P } from '../../rbac/codes';
import ConfirmDialog from '../../components/ConfirmDialog';
import CalendarHeader from './calendar/CalendarHeader';
import CalendarGrid from './calendar/CalendarGrid';
import CalendarMetrics from './calendar/CalendarMetrics';
import DaySidePanel from './calendar/DaySidePanel';
import ActivityModal, { type ActivityFormData } from './calendar/ActivityModal';
import DuplicateMonthModal from './calendar/DuplicateMonthModal';
import CreateCalendarModal from './calendar/CreateCalendarModal';
import {
  activitiesForDay,
  applyActivityDatePatch,
  currentPeriodYM,
  type ActivityDatePatch,
  type CalendarCell,
} from './calendar/calendarUtils';

const emptyActivityForm = (day: number): ActivityFormData => ({
  name: '',
  description: '',
  activity_kind: 'nps',
  start_day: day,
  end_day: day,
  due_day: day,
  priority: 'media',
  status: 'pendiente',
});

const FinanceCalendar = () => {
  const canView = useMemo(() => auth.hasPermission(P.financeCalendarView), []);
  const canManage = useMemo(() => auth.hasPermission(P.financeCalendarManage), []);

  const [periodYm, setPeriodYm] = useState(currentPeriodYM());
  const [detail, setDetail] = useState<FinanceCalendarDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [msgType, setMsgType] = useState<'info' | 'error' | 'success'>('info');

  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [sideOpen, setSideOpen] = useState(false);

  const [compliance, setCompliance] = useState<CalendarComplianceSummary | null>(null);
  const [complianceLoading, setComplianceLoading] = useState(false);
  const [selectedActivityId, setSelectedActivityId] = useState<number | null>(null);

  const [metricsLoading, setMetricsLoading] = useState(false);
  const [pendingCompanies, setPendingCompanies] = useState<number | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [activityModal, setActivityModal] = useState<{ open: boolean; edit?: FinanceCalendarActivity }>({ open: false });
  const [saving, setSaving] = useState(false);

  const [confirmDeleteCal, setConfirmDeleteCal] = useState(false);
  const [confirmDeleteAct, setConfirmDeleteAct] = useState<FinanceCalendarActivity | null>(null);
  const [confirmCloseCal, setConfirmCloseCal] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);

  const isClosed = !!detail?.is_closed;
  const canEdit = canManage && !isClosed;

  const lastDayOfMonth = useMemo(() => {
    const [y, m] = periodYm.split('-').map(Number);
    return new Date(y, m, 0).getDate();
  }, [periodYm]);

  const [activities, setActivities] = useState<FinanceCalendarActivity[]>([]);
  const marks = detail?.marks ?? [];

  useEffect(() => {
    setActivities(detail?.activities ?? []);
  }, [detail?.activities]);

  const loadDetail = useCallback(async () => {
    if (!periodYm) return;
    try {
      setLoading(true);
      setDetail(await financeCalendarService.get(periodYm));
      setMsg('');
    } catch {
      setDetail(null);
      setMsg('No hay calendario para este mes. Finanzas puede crear uno con «Nuevo calendario».');
      setMsgType('info');
    } finally {
      setLoading(false);
    }
  }, [periodYm]);

  useEffect(() => {
    if (canView) void loadDetail();
  }, [canView, loadDetail]);

  useEffect(() => {
    if (msgType !== 'success' || !msg) return;
    const t = window.setTimeout(() => setMsg(''), 4000);
    return () => window.clearTimeout(t);
  }, [msg, msgType]);

  const handleActivityDatesChange = useCallback(
    async (activityId: number, patch: ActivityDatePatch, _origin: ActivityDatePatch) => {
      const snapshot = activities;
      setActivities((prev) =>
        prev.map((a) => (a.id === activityId ? applyActivityDatePatch(a, patch, periodYm) : a)),
      );

      try {
        await financeCalendarService.updateActivity(activityId, patch);
        setDetail((d) =>
          d
            ? {
                ...d,
                activities: (d.activities ?? []).map((a) =>
                  a.id === activityId ? applyActivityDatePatch(a, patch, periodYm) : a,
                ),
              }
            : d,
        );
        setMsg('Actividad reprogramada correctamente');
        setMsgType('success');
      } catch {
        setActivities(snapshot);
        setMsg('No se pudo reprogramar. Se restauró la posición anterior.');
        setMsgType('error');
      }
    },
    [activities, periodYm],
  );

  const loadMetrics = useCallback(async () => {
    if (!detail?.activities?.length) {
      setPendingCompanies(0);
      return;
    }
    setMetricsLoading(true);
    try {
      let pending = 0;
      const results = await Promise.all(
        detail.activities.map((a) => financeCalendarService.compliance(a.id, periodYm).catch(() => null)),
      );
      for (const r of results) {
        if (r) pending += r.pending + r.overdue;
      }
      setPendingCompanies(pending);
    } catch {
      setPendingCompanies(null);
    } finally {
      setMetricsLoading(false);
    }
  }, [detail?.activities, periodYm]);

  useEffect(() => {
    if (detail?.activities?.length) void loadMetrics();
    else setPendingCompanies(0);
  }, [detail?.activities, loadMetrics]);

  const metrics = useMemo(() => {
    const acts = detail?.activities ?? [];
    return {
      total: acts.length,
      completed: acts.filter((a) => a.traffic_light === 'verde').length,
      upcoming: acts.filter((a) => a.traffic_light === 'amarillo').length,
      overdue: acts.filter((a) => a.traffic_light === 'rojo').length,
      pendingCompanies,
      loading: metricsLoading,
    };
  }, [detail?.activities, pendingCompanies, metricsLoading]);

  const openCompliance = async (activityId: number) => {
    try {
      setComplianceLoading(true);
      setSelectedActivityId(activityId);
      setCompliance(await financeCalendarService.compliance(activityId, periodYm));
    } catch {
      setMsg('No se pudo cargar el cumplimiento');
      setMsgType('error');
    } finally {
      setComplianceLoading(false);
    }
  };

  const isToday = (cell: CalendarCell) => {
    const t = new Date();
    return (
      cell.inMonth &&
      cell.date.getDate() === t.getDate() &&
      cell.date.getMonth() === t.getMonth() &&
      cell.date.getFullYear() === t.getFullYear()
    );
  };

  const handleDayClick = (dayNum: number, date: Date) => {
    setSelectedDay(dayNum);
    setSelectedDate(date);
    setSideOpen(true);
    setSelectedActivityId(null);
    setCompliance(null);
    if (canEdit) {
      setActivityModal({ open: true, edit: undefined });
    }
  };

  const handleActivityClick = (a: FinanceCalendarActivity, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedActivityId(a.id);
    setSideOpen(true);
    const { start } = a.start_day > 0 ? { start: a.start_day } : { start: a.due_day };
    setSelectedDay(start);
    const [y, m] = periodYm.split('-').map(Number);
    setSelectedDate(new Date(y, m - 1, start));
    void openCompliance(a.id);
  };

  const handleOverflow = (dayNum: number) => {
    const [y, m] = periodYm.split('-').map(Number);
    setSelectedDay(dayNum);
    setSelectedDate(new Date(y, m - 1, dayNum));
    setSideOpen(true);
  };

  const dayActivities = selectedDay != null ? activitiesForDay(activities, selectedDay) : [];

  const saveActivity = async (data: ActivityFormData) => {
    if (!detail) return;
    setSaving(true);
    try {
      if (activityModal.edit) {
        await financeCalendarService.updateActivity(activityModal.edit.id, data);
      } else {
        await financeCalendarService.addActivity(detail.id, data);
      }
      setActivityModal({ open: false });
      await loadDetail();
      setMsg(activityModal.edit ? 'Actividad actualizada' : 'Actividad creada');
      setMsgType('success');
    } catch {
      setMsg('No se pudo guardar la actividad');
      setMsgType('error');
    } finally {
      setSaving(false);
    }
  };

  const handleExportPdf = async () => {
    if (!detail) return;
    setPdfLoading(true);
    try {
      const bytes = await buildFinanceCalendarPdf(detail);
      const blob = new Blob([Uint8Array.from(bytes)], { type: 'application/pdf' });
      saveAs(blob, financeCalendarPdfFilename(detail.period_ym));
      setMsg('PDF generado correctamente');
      setMsgType('success');
    } catch {
      setMsg('No se pudo generar el PDF');
      setMsgType('error');
    } finally {
      setPdfLoading(false);
    }
  };

  const handleCloseCalendar = async () => {
    if (!detail) return;
    setSaving(true);
    try {
      await financeCalendarService.close(detail.id);
      setConfirmCloseCal(false);
      await loadDetail();
      setMsg('Calendario cerrado. Ya no se puede editar hasta abrirlo de nuevo.');
      setMsgType('success');
    } catch {
      setMsg('No se pudo cerrar el calendario');
      setMsgType('error');
    } finally {
      setSaving(false);
    }
  };

  const handleReopenCalendar = async () => {
    if (!detail) return;
    setSaving(true);
    try {
      await financeCalendarService.reopen(detail.id);
      await loadDetail();
      setMsg('Calendario abierto. Puede editarlo nuevamente.');
      setMsgType('success');
    } catch {
      setMsg('No se pudo abrir el calendario');
      setMsgType('error');
    } finally {
      setSaving(false);
    }
  };

  const handleEditNotes = async () => {
    if (!detail) return;
    const notes = window.prompt('Notas del calendario:', detail.notes ?? '');
    if (notes === null) return;
    try {
      await financeCalendarService.updateNotes(detail.id, notes);
      await loadDetail();
      setMsg('Notas actualizadas');
      setMsgType('success');
    } catch {
      setMsg('No se pudieron guardar las notas');
      setMsgType('error');
    }
  };

  if (!canView) {
    return (
      <div className="max-w-lg mx-auto p-12 text-center">
        <i className="fas fa-lock text-3xl text-slate-300 mb-4" aria-hidden />
        <p className="text-slate-600">Sin permiso para ver el calendario contable.</p>
      </div>
    );
  }

  const activityInitial: ActivityFormData = activityModal.edit
    ? {
        name: activityModal.edit.name,
        description: activityModal.edit.description ?? '',
        activity_kind: activityModal.edit.activity_kind,
        start_day: activityModal.edit.start_day || activityModal.edit.due_day,
        end_day: activityModal.edit.end_day || activityModal.edit.due_day,
        due_day: activityModal.edit.due_day,
        priority: activityModal.edit.priority,
        status: activityModal.edit.status || 'pendiente',
      }
    : emptyActivityForm(selectedDay ?? 1);

  return (
    <div className="max-w-7xl mx-auto space-y-5 pb-10 print:max-w-none">
      <CalendarHeader
        periodYm={periodYm}
        canManage={canManage}
        canEdit={canEdit}
        isClosed={isClosed}
        hasCalendar={!!detail}
        pdfLoading={pdfLoading}
        onPeriodChange={setPeriodYm}
        onNewCalendar={() => setCreateOpen(true)}
        onDuplicate={() => setDuplicateOpen(true)}
        onEditNotes={handleEditNotes}
        onDelete={() => setConfirmDeleteCal(true)}
        onExportPdf={() => void handleExportPdf()}
        onCloseCalendar={() => setConfirmCloseCal(true)}
        onReopenCalendar={() => void handleReopenCalendar()}
      />

      {msg ? (
        <p
          className={`text-sm rounded-xl px-4 py-2.5 border ${
            msgType === 'error'
              ? 'text-red-800 bg-red-50 border-red-200'
              : msgType === 'success'
                ? 'text-emerald-800 bg-emerald-50 border-emerald-200'
                : 'text-amber-800 bg-amber-50 border-amber-200'
          }`}
        >
          {msg}
        </p>
      ) : null}

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 animate-pulse space-y-4">
          <div className="h-6 bg-slate-200 rounded w-1/3" />
          <div className="grid grid-cols-7 gap-2">
            {Array.from({ length: 35 }).map((_, i) => (
              <div key={i} className="h-24 bg-slate-100 rounded-lg" />
            ))}
          </div>
        </div>
      ) : detail ? (
        <>
          {isClosed ? (
            <p className="text-sm text-slate-700 bg-slate-100 border border-slate-200 rounded-xl px-4 py-2.5 flex items-center gap-2">
              <i className="fas fa-lock text-slate-500" aria-hidden />
              Este calendario está cerrado. Solo lectura y exportación PDF. Use «Abrir calendario» para modificarlo.
            </p>
          ) : null}
          <div className="flex flex-col xl:flex-row gap-4 xl:gap-5">
            <div className="flex-1 min-w-0">
              <CalendarGrid
                periodYm={periodYm}
                lastDayOfMonth={lastDayOfMonth}
                marks={marks}
                activities={activities}
                canInteract={canEdit}
                selectedDay={selectedDay}
                isToday={isToday}
                onDayClick={handleDayClick}
                onActivityClick={handleActivityClick}
                onOverflowClick={handleOverflow}
                onActivityDatesChange={handleActivityDatesChange}
              />
            </div>
          </div>

          <CalendarMetrics periodYm={periodYm} metrics={metrics} />

          {detail.notes ? (
            <p className="text-sm text-slate-600 bg-white rounded-xl border border-slate-200 px-4 py-3">
              <span className="font-medium text-slate-700">Notas: </span>
              {detail.notes}
            </p>
          ) : null}
        </>
      ) : (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/50 p-12 text-center">
          <i className="fas fa-calendar-plus text-4xl text-slate-300 mb-4" aria-hidden />
          <p className="text-slate-600 mb-4">Aún no existe calendario para este mes.</p>
          {canManage ? (
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="px-5 py-2.5 rounded-full bg-primary-600 text-white text-sm font-medium hover:bg-primary-700"
            >
              Crear calendario
            </button>
          ) : null}
        </div>
      )}

      <DaySidePanel
        open={sideOpen}
        date={selectedDate}
        dayNum={selectedDay}
        activities={dayActivities}
        canManage={canEdit}
        compliance={compliance}
        complianceLoading={complianceLoading}
        selectedActivityId={selectedActivityId}
        onClose={() => setSideOpen(false)}
        onSelectActivity={(a) => void openCompliance(a.id)}
        onEditActivity={(a) => setActivityModal({ open: true, edit: a })}
        onDeleteActivity={(a) => setConfirmDeleteAct(a)}
        onAddActivity={() => setActivityModal({ open: true, edit: undefined })}
      />

      {canEdit ? (
        <>
          <CreateCalendarModal
            open={createOpen}
            saving={saving}
            onClose={() => setCreateOpen(false)}
            onConfirm={async (ym, notes) => {
              setSaving(true);
              try {
                await financeCalendarService.create(ym, notes);
                setCreateOpen(false);
                setPeriodYm(ym);
                setMsg('Calendario creado');
                setMsgType('success');
              } catch (e: unknown) {
                setMsg(e instanceof Error ? e.message : 'No se pudo crear el calendario');
                setMsgType('error');
              } finally {
                setSaving(false);
              }
            }}
          />

          <DuplicateMonthModal
            open={duplicateOpen}
            fromPeriodYm={periodYm}
            saving={saving}
            onClose={() => setDuplicateOpen(false)}
            onConfirm={async (toYm, opts) => {
              setSaving(true);
              try {
                await financeCalendarService.duplicate(periodYm, toYm, opts);
                setDuplicateOpen(false);
                setPeriodYm(toYm);
                await loadDetail();
                setMsg('Calendario duplicado correctamente');
                setMsgType('success');
              } catch {
                setMsg('No se pudo duplicar el calendario');
                setMsgType('error');
              } finally {
                setSaving(false);
              }
            }}
          />

          <ActivityModal
            open={activityModal.open}
            title={activityModal.edit ? 'Editar actividad' : 'Nueva actividad'}
            initial={activityInitial}
            lastDayOfMonth={lastDayOfMonth}
            saving={saving}
            onClose={() => setActivityModal({ open: false })}
            onSubmit={saveActivity}
          />
        </>
      ) : null}

      <ConfirmDialog
        open={confirmCloseCal}
        title="Cerrar calendario"
        message={`¿Cerrar el calendario de ${periodYm}? No se podrá editar hasta que lo abra de nuevo. Podrá seguir viéndolo y exportarlo a PDF.`}
        confirmLabel="Cerrar calendario"
        loading={saving}
        onClose={() => setConfirmCloseCal(false)}
        onConfirm={() => void handleCloseCalendar()}
      />

      <ConfirmDialog
        open={confirmDeleteCal}
        title="Eliminar calendario"
        message={`¿Eliminar el calendario de ${periodYm}? Se borrarán actividades y fechas especiales.`}
        danger
        loading={saving}
        confirmLabel="Eliminar"
        onClose={() => setConfirmDeleteCal(false)}
        onConfirm={async () => {
          if (!detail) return;
          setSaving(true);
          try {
            await financeCalendarService.remove(detail.id);
            setConfirmDeleteCal(false);
            setDetail(null);
            setMsg('Calendario eliminado');
            setMsgType('success');
          } catch {
            setMsg('No se pudo eliminar');
            setMsgType('error');
          } finally {
            setSaving(false);
          }
        }}
      />

      <ConfirmDialog
        open={!!confirmDeleteAct}
        title="Eliminar actividad"
        message={confirmDeleteAct ? `¿Eliminar «${confirmDeleteAct.name}»?` : ''}
        danger
        loading={saving}
        confirmLabel="Eliminar"
        onClose={() => setConfirmDeleteAct(null)}
        onConfirm={async () => {
          if (!confirmDeleteAct) return;
          setSaving(true);
          try {
            await financeCalendarService.removeActivity(confirmDeleteAct.id);
            setConfirmDeleteAct(null);
            await loadDetail();
            setMsg('Actividad eliminada');
            setMsgType('success');
          } catch {
            setMsg('No se pudo eliminar la actividad');
            setMsgType('error');
          } finally {
            setSaving(false);
          }
        }}
      />
    </div>
  );
};

export default FinanceCalendar;
