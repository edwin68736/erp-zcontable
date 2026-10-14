import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { MODULE_SLUG } from '../../navigation/moduleSlugs';
import { P } from '../../rbac/codes';
import { auth } from '../../services/auth';
import {
  supervisorsService,
  type AssistantOverview,
  type DashboardOverview,
  type SupervisorNotification,
} from '../../services/supervisors';
import { previousMonthPeriodYM } from '../../utils/supervisorLabels';

type Mode = 'review' | 'work' | 'none';

/** Una fila de "tareas": origen distinto según el rol, misma forma para pintarla. */
type TaskRow = { key: string; label: string; right: string; color: string; to: string };

type Kpi = { label: string; value: number; to: string; bg: string; glyph: string };

const GLYPH_DOC = 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M9 14l2 2 4-4';
const GLYPH_CAL = 'M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM16 2v4M8 2v4M3 10h18';
const GLYPH_EYE = 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6';
const GLYPH_ALERT = 'M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z';

const BG_GREEN = 'linear-gradient(160deg,#12a15e,#0b6b3f)';
const BG_AMBER = 'linear-gradient(160deg,#a8721a,#6f4609)';
const BG_BLUE = 'linear-gradient(160deg,#2f78e8,#1b4cae)';
const BG_PURPLE = 'linear-gradient(160deg,#8a58d1,#5a3399)';

const STATE_COLOR: Record<string, string> = {
  vencida: '#dc2626',
  observada: '#ea7b12',
  pendiente: '#2563eb',
  por_revisar: '#6366f1',
};

function greetingForHour(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Buenos días';
  if (h < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

function dateLabel(): string {
  const s = new Date().toLocaleDateString('es-PE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 1) return 'Ahora';
  if (mins < 60) return `Hace ${mins} min`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `Hace ${hrs} ${hrs === 1 ? 'hora' : 'horas'}`;
  const days = Math.round(hrs / 24);
  return `Hace ${days} ${days === 1 ? 'día' : 'días'}`;
}

function dueRight(state: string, daysLeft?: number): string {
  if (state === 'vencida') return 'Vencida';
  if (state === 'observada') return 'Observada';
  if (state === 'por_revisar') return 'En revisión';
  if (daysLeft === 0) return 'Hoy';
  if (daysLeft === 1) return 'Mañana';
  if (daysLeft !== undefined && daysLeft > 1) return `${daysLeft} días`;
  return 'Pendiente';
}

const Glyph = ({ d, size = 26 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
);

/** Panel derecho del Inicio: resumen del día con datos reales del usuario (según su rol). */
const HomeRail = () => {
  const mode: Mode = useMemo(() => {
    if (auth.hasPermission(P.supervisorsReportsView) && auth.hasPermission(P.supervisorsDashboardView)) return 'review';
    if (auth.hasPermission(P.supervisorsControlsView)) return 'work';
    return 'none';
  }, []);
  const canNotifications = useMemo(() => auth.hasPermission(P.supervisorsNotificationsView), []);
  const periodYm = useMemo(() => previousMonthPeriodYM(), []);

  const [review, setReview] = useState<DashboardOverview | null>(null);
  const [work, setWork] = useState<AssistantOverview | null>(null);
  const [notifs, setNotifs] = useState<SupervisorNotification[] | null>(null);
  const [loading, setLoading] = useState(mode !== 'none');

  useEffect(() => {
    let cancelled = false;
    if (mode === 'review') {
      supervisorsService
        .dashboardOverview({ period_ym: periodYm })
        .then((o) => !cancelled && setReview(o))
        .catch(() => undefined)
        .finally(() => !cancelled && setLoading(false));
    } else if (mode === 'work') {
      supervisorsService
        .assistantOverview({ period_ym: periodYm })
        .then((o) => !cancelled && setWork(o))
        .catch(() => undefined)
        .finally(() => !cancelled && setLoading(false));
    }
    if (canNotifications) {
      supervisorsService
        .listNotifications(false)
        .then((n) => !cancelled && setNotifs(n))
        .catch(() => !cancelled && setNotifs([]));
    }
    return () => {
      cancelled = true;
    };
  }, [mode, canNotifications, periodYm]);

  const base = mode === 'review' ? '/supervisors' : '/assistant';
  const actBase = `${base}/activities`;
  const q = `?period_ym=${encodeURIComponent(periodYm)}`;

  const kpis: Kpi[] = useMemo(() => {
    if (mode === 'review' && review) {
      return [
        { label: 'Por revisar', value: review.review.total, to: '/supervisors/dashboard', bg: BG_GREEN, glyph: GLYPH_DOC },
        { label: 'Vencimientos próximos', value: review.upcoming.length, to: '/supervisors/dashboard', bg: BG_AMBER, glyph: GLYPH_CAL },
        { label: 'Con más de 3 días', value: review.review.over_3_days, to: '/supervisors/dashboard', bg: BG_BLUE, glyph: GLYPH_EYE },
        { label: 'Observadas', value: review.review.observed, to: '/supervisors/dashboard', bg: BG_PURPLE, glyph: GLYPH_ALERT },
      ];
    }
    if (mode === 'work' && work) {
      return [
        { label: 'Por entregar', value: work.counts.to_deliver, to: '/assistant', bg: BG_GREEN, glyph: GLYPH_DOC },
        { label: 'Vencen esta semana', value: work.counts.due_this_week, to: '/assistant', bg: BG_AMBER, glyph: GLYPH_CAL },
        { label: 'En revisión', value: work.counts.in_review, to: '/assistant', bg: BG_BLUE, glyph: GLYPH_EYE },
        { label: 'Observadas', value: work.counts.observed, to: '/assistant', bg: BG_PURPLE, glyph: GLYPH_ALERT },
      ];
    }
    return [];
  }, [mode, review, work]);

  const tasks: TaskRow[] = useMemo(() => {
    if (mode === 'review' && review) {
      return review.review.items.slice(0, 5).map((r) => ({
        key: `${r.module_key}-${r.declaration_id}`,
        label: `${r.module_label} — ${r.company}`,
        right: r.age_days <= 0 ? 'Hoy' : `${r.age_days} d`,
        color: r.age_days > 3 ? '#dc2626' : '#16a34a',
        to: MODULE_SLUG[r.module_key] ? `${actBase}/${MODULE_SLUG[r.module_key]}/${r.company_id}${q}` : '/supervisors/dashboard',
      }));
    }
    if (mode === 'work' && work) {
      return work.work.slice(0, 5).map((w) => ({
        key: `${w.module_key}-${w.company_id}`,
        label: `${w.module_label} — ${w.company}`,
        right: dueRight(w.state, w.days_left),
        color: STATE_COLOR[w.state] ?? '#2563eb',
        to: MODULE_SLUG[w.module_key] ? `${actBase}/${MODULE_SLUG[w.module_key]}/${w.company_id}${q}` : '/assistant',
      }));
    }
    return [];
  }, [mode, review, work, actBase, q]);

  const tasksTitle = mode === 'review' ? 'Para revisar' : 'Mis tareas de hoy';
  const tasksAll = mode === 'review' ? '/supervisors/dashboard' : '/assistant';
  const notifAll = mode === 'review' ? '/supervisors/notifications' : '/assistant/notifications';

  return (
    <aside className="hm-rail" aria-label="Resumen del día">
      <section className="hm-glass" style={{ padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: kpis.length || loading ? 14 : 0 }}>
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <circle cx="12" cy="12" r="4.5" fill="#fbbf24" />
            <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" />
          </svg>
          <div>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#fff' }}>{dateLabel()}</h2>
            <p style={{ margin: '2px 0 0', fontSize: 12.5, color: '#d5f1e3' }}>{greetingForHour()}, que tengas un gran día</p>
          </div>
        </div>
        {loading ? (
          <p style={{ margin: 0, fontSize: 12.5, color: '#d5f1e3' }}>
            <i className="fas fa-spinner fa-spin" aria-hidden /> Cargando tu resumen…
          </p>
        ) : kpis.length > 0 ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 8 }}>
            {kpis.map((k) => (
              <Link key={k.label} to={k.to} className="hm-kpi" style={{ background: k.bg }}>
                <Glyph d={k.glyph} />
                <div style={{ fontSize: 30, fontWeight: 800, lineHeight: 1.1, marginTop: 4 }}>{k.value}</div>
                <div style={{ fontSize: 11, lineHeight: 1.25, opacity: 0.95 }}>{k.label}</div>
              </Link>
            ))}
          </div>
        ) : null}
      </section>

      {mode !== 'none' ? (
        <section className="hm-white" style={{ padding: '16px 18px 8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>{tasksTitle}</h2>
            <Link to={tasksAll} style={{ fontSize: 12.5, fontWeight: 700, color: '#0b6b3f', background: '#e5f6ec', padding: '5px 12px', borderRadius: 999 }}>
              Ver todas
            </Link>
          </div>
          {loading ? (
            <p style={{ fontSize: 13, color: '#475569', padding: '10px 0' }}>Cargando…</p>
          ) : tasks.length === 0 ? (
            <p style={{ fontSize: 13, color: '#475569', padding: '10px 0 14px' }}>No tienes pendientes por ahora. ¡Buen trabajo!</p>
          ) : (
            tasks.map((t) => (
              <Link key={t.key} to={t.to} className="hm-task">
                <span style={{ flex: '0 0 22px', height: 22, borderRadius: 6, boxSizing: 'border-box', border: `2px solid ${t.color}` }} aria-hidden />
                <span className="hm-task-label" style={{ flex: 1, minWidth: 0, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t.label}>
                  {t.label}
                </span>
                <span style={{ fontSize: 12.5, color: '#475569', whiteSpace: 'nowrap' }}>{t.right}</span>
              </Link>
            ))
          )}
        </section>
      ) : null}

      {canNotifications ? (
        <section className="hm-white" style={{ padding: '16px 18px 10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Actividad reciente</h2>
            <Link to={notifAll} style={{ fontSize: 12.5, fontWeight: 700, color: '#0b6b3f', background: '#e5f6ec', padding: '5px 12px', borderRadius: 999 }}>
              Ver todo
            </Link>
          </div>
          {notifs === null ? (
            <p style={{ fontSize: 13, color: '#475569', padding: '10px 0' }}>Cargando…</p>
          ) : notifs.length === 0 ? (
            <p style={{ fontSize: 13, color: '#475569', padding: '10px 0 14px' }}>Sin notificaciones recientes.</p>
          ) : (
            notifs.slice(0, 4).map((n) => (
              <div key={n.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: '1px solid #eef1f4' }}>
                <span
                  style={{ flex: '0 0 38px', height: 38, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', background: n.read_at ? '#e8edf3' : '#dcf5e6', color: n.read_at ? '#475569' : '#15803d' }}
                >
                  <Glyph d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" size={20} />
                </span>
                <span style={{ flex: 1, minWidth: 0, lineHeight: 1.3 }}>
                  <span style={{ display: 'block', fontSize: 13, fontWeight: n.read_at ? 600 : 800 }}>{n.title}</span>
                  <span style={{ display: 'block', fontSize: 12, color: '#475569', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={n.message}>
                    {n.message}
                  </span>
                </span>
                <span style={{ fontSize: 11.5, color: '#475569', whiteSpace: 'nowrap', alignSelf: 'flex-start', paddingTop: 2 }}>{timeAgo(n.created_at)}</span>
              </div>
            ))
          )}
        </section>
      ) : null}
    </aside>
  );
};

export default HomeRail;
