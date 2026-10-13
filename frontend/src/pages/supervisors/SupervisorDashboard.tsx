import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import {
  supervisorsService,
  type SupervisorPdtTypeSummary,
  type SupervisorPdtAssistantSummary,
  type SupervisorPdtBucketCompany,
} from '../../services/supervisors';
import SupervisorDashboardView from './SupervisorDashboardView';
import { extractApiErrorMessage } from '../../utils/apiError';

// El dashboard rediseñado (propuesta B: vista del estudio para el administrador y "mi cartera" para
// el supervisor) vive en SupervisorDashboardView; este archivo conserva los bloques de resumen PDT
// que reutiliza el dashboard del asistente (PdtSummarySection).
const SupervisorDashboard = () => <SupervisorDashboardView />;

/** Filtros vigentes del dashboard — se reenvían tal cual al pedir la lista de empresas de un
 * bucket, para que esa lista siempre calce con el número ya mostrado en la tarjeta. */
export type PdtDashboardFilters = {
  periodYm: string;
  companyId?: string;
  generalStatus?: string;
  riskLevel?: string;
  responsibleUserId?: string;
  supervisorUserId?: string;
};

type OpenBucket = { declarationType: 'pdt_601' | 'pdt_621'; bucket: string; label: string };

export function PdtSummarySection({
  loading,
  error,
  summary601,
  summary621,
  workspace,
  assistantPerformance,
  assistantPerformanceLoading,
  assistantPerformanceError,
  filters,
}: {
  loading: boolean;
  error?: string;
  summary601?: SupervisorPdtTypeSummary;
  summary621?: SupervisorPdtTypeSummary;
  workspace: 'supervisor' | 'assistant';
  /** Solo se pasa desde el dashboard del supervisor (docs/diseno-estados-pdt601-pdt621-2026-09-
   * 16.md §12.3) — el del asistente no la necesita, ahí solo hay una persona. */
  assistantPerformance?: SupervisorPdtAssistantSummary[];
  assistantPerformanceLoading?: boolean;
  assistantPerformanceError?: string;
  filters: PdtDashboardFilters;
}) {
  const base = workspace === 'assistant' ? '/assistant/activities' : '/supervisors/activities';
  const [openBucket, setOpenBucket] = useState<OpenBucket | null>(null);

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-slate-800">Declaraciones PDT 601/621</h3>
        <p className="text-xs text-slate-500 mt-0.5">
          Resumen por tipo a partir de controles y declaraciones del período. Haga clic en un estado para ver las
          empresas.
        </p>
      </div>
      {loading ? (
        <p className="text-sm text-slate-500">Cargando resumen PDT…</p>
      ) : error ? (
        <p className="text-sm text-red-600 flex items-center gap-1.5">
          <i className="fas fa-exclamation-circle text-xs" aria-hidden />
          {error}
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <PdtTypeCard
            title="PDT 601"
            summary={summary601 ?? emptyPdtSummary()}
            linkTo={`${base}/pdt-601`}
            onOpenBucket={(bucket, label) => setOpenBucket({ declarationType: 'pdt_601', bucket, label })}
          />
          <PdtTypeCard
            title="PDT 621"
            summary={summary621 ?? emptyPdtSummary()}
            linkTo={`${base}/pdt-621`}
            onOpenBucket={(bucket, label) => setOpenBucket({ declarationType: 'pdt_621', bucket, label })}
          />
        </div>
      )}
      {openBucket ? (
        <PdtBucketCompaniesModal
          open={openBucket}
          filters={filters}
          base={base}
          onClose={() => setOpenBucket(null)}
        />
      ) : null}
      {workspace === 'supervisor' ? (
        <PdtAssistantPerformanceTable
          loading={!!assistantPerformanceLoading}
          error={assistantPerformanceError}
          rows={assistantPerformance ?? []}
        />
      ) : null}
    </div>
  );
}

function emptyPdtSummary(): SupervisorPdtTypeSummary {
  return {
    pendiente: 0,
    observado: 0,
    vencido: 0,
    completado: 0,
    sin_planilla: 0,
    suspendida: 0,
    total: 0,
    entregado_a_tiempo: 0,
    entregado_fuera_de_fecha: 0,
  };
}

const PDT_DECLARATION_TYPE_LABEL: Record<string, string> = { pdt_601: 'PDT 601', pdt_621: 'PDT 621' };

/** "¿Cómo viene cada uno de mis asistentes?" — no solo el total del portafolio (§12.3). Una fila
 * por (asistente, tipo), agrupadas visualmente por asistente ya que la API las devuelve ordenadas
 * por username. */
function PdtAssistantPerformanceTable({
  loading,
  error,
  rows,
}: {
  loading: boolean;
  error?: string;
  rows: SupervisorPdtAssistantSummary[];
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-slate-800">Desempeño por asistente</h3>
      {loading ? (
        <p className="text-sm text-slate-500">Cargando desempeño por asistente…</p>
      ) : error ? (
        <p className="text-sm text-red-600 flex items-center gap-1.5">
          <i className="fas fa-exclamation-circle text-xs" aria-hidden />
          {error}
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-500">Sin empresas con asistente asignado en este período/alcance.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Asistente</th>
                <th className="px-3 py-2 text-left">Módulo</th>
                <th className="px-3 py-2 text-right">Pendiente</th>
                <th className="px-3 py-2 text-right">Observado</th>
                <th className="px-3 py-2 text-right">Vencido</th>
                <th className="px-3 py-2 text-right">Entregado a tiempo</th>
                <th className="px-3 py-2 text-right">Entregado fuera de fecha</th>
                {/* Sin planilla/Suspendida son buckets propios (docs/diseno-estados-pdt601-pdt621-
                    2026-09-16.md §6/§12.1), no "pendiente" — sin estas dos columnas, Pendiente +
                    Observado + Vencido + Entregado (a tiempo/fuera de fecha) no sumaba el Total de la
                    fila cuando el asistente tenía alguna empresa sin planilla o suspendida. */}
                <th className="px-3 py-2 text-right">Sin planilla</th>
                <th className="px-3 py-2 text-right">Suspendida</th>
                <th className="px-3 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={`${r.assistant_user_id}-${r.declaration_type}`} className="hover:bg-slate-50/80">
                  <td className="px-3 py-2 text-slate-800 font-medium">{r.assistant_username || `Usuario #${r.assistant_user_id}`}</td>
                  <td className="px-3 py-2 text-slate-600">{PDT_DECLARATION_TYPE_LABEL[r.declaration_type] ?? r.declaration_type}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.pendiente}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.observado}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-red-700">{r.vencido}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-primary-700">{r.entregado_a_tiempo}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-orange-700">{r.entregado_fuera_de_fecha}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-500">{r.sin_planilla}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-purple-700">{r.suspendida}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold">{r.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PdtTypeCard({
  title,
  summary,
  linkTo,
  onOpenBucket,
}: {
  title: string;
  summary: SupervisorPdtTypeSummary;
  linkTo: string;
  onOpenBucket: (bucket: string, label: string) => void;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2 mb-3">
        <p className="text-sm font-semibold text-slate-800">{title}</p>
        <Link to={linkTo} className="text-xs text-primary-700 font-medium">
          Ver módulo →
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <PdtMiniStat label="Pendientes" value={summary.pendiente} tone="amber" onClick={() => onOpenBucket('pendiente', 'Pendientes')} />
        <PdtMiniStat label="Observadas" value={summary.observado} tone="orange" onClick={() => onOpenBucket('observado', 'Observadas')} />
        <PdtMiniStat label="Vencidas" value={summary.vencido} tone="red" onClick={() => onOpenBucket('vencido', 'Vencidas')} />
        <PdtMiniStat label="Completadas" value={summary.completado} tone="emerald" onClick={() => onOpenBucket('completado', 'Completadas')} />
        {/* Apertura de "Completadas" por puntualidad (docs/diseno-estados-pdt601-pdt621-2026-09-
            16.md §12.1) — suman exactamente el total de arriba, calculado contra el calendario
            interno del estudio. Solo se muestran si hay algo que desglosar. */}
        {summary.entregado_a_tiempo > 0 ? (
          <PdtMiniStat
            label="Entregado a tiempo"
            value={summary.entregado_a_tiempo}
            tone="emerald"
            onClick={() => onOpenBucket('entregado_a_tiempo', 'Entregado a tiempo')}
          />
        ) : null}
        {summary.entregado_fuera_de_fecha > 0 ? (
          <PdtMiniStat
            label="Entregado fuera de fecha"
            value={summary.entregado_fuera_de_fecha}
            tone="orange"
            onClick={() => onOpenBucket('entregado_fuera_de_fecha', 'Entregado fuera de fecha')}
          />
        ) : null}
        {/* Solo PDT 601 tiene el concepto "sin planilla" (PDT 621 siempre trae 0 acá) — no se
            cuenta como pendiente: la empresa no tiene nada que declarar en el período. */}
        {summary.sin_planilla > 0 ? (
          <PdtMiniStat
            label="Sin planilla"
            value={summary.sin_planilla}
            tone="slate"
            onClick={() => onOpenBucket('sin_planilla', 'Sin planilla')}
          />
        ) : null}
        {/* "Suspendida" sí aplica a ambos módulos — tampoco cuenta como pendiente/vencido mientras
            la empresa esté suspendida (ver PdtDashboardSummary). */}
        {summary.suspendida > 0 ? (
          <PdtMiniStat
            label="Suspendida"
            value={summary.suspendida}
            tone="purple"
            onClick={() => onOpenBucket('suspendida', 'Suspendida')}
          />
        ) : null}
      </div>
      <p className="text-2xs text-slate-400 mt-3">Total en período: {summary.total}</p>
    </div>
  );
}

function PdtMiniStat({
  label,
  value,
  tone,
  onClick,
}: {
  label: string;
  value: number;
  tone: 'amber' | 'orange' | 'red' | 'emerald' | 'slate' | 'purple';
  onClick: () => void;
}) {
  const bg =
    tone === 'emerald'
      ? 'bg-primary-50 text-primary-800'
      : tone === 'amber'
        ? 'bg-amber-50 text-amber-800'
        : tone === 'red'
          ? 'bg-red-50 text-red-800'
          : tone === 'slate'
            ? 'bg-slate-100 text-slate-700'
            : tone === 'purple'
              ? 'bg-purple-100 text-purple-800'
              : 'bg-orange-50 text-orange-800';
  if (value === 0) {
    return (
      <div className={`rounded-lg px-3 py-2 flex justify-between items-center ${bg} opacity-60`}>
        <span>{label}</span>
        <span className="font-bold text-sm">{value}</span>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-3 py-2 flex justify-between items-center ${bg} hover:ring-2 hover:ring-offset-1 hover:ring-primary-400 transition-shadow cursor-pointer text-left`}
    >
      <span>{label}</span>
      <span className="font-bold text-sm">{value}</span>
    </button>
  );
}

function useBucketModalDebouncedValue<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

const BUCKET_MODAL_PAGE_SIZE = 20;

/** Lista de empresas detrás de un bucket de una tarjeta PDT (clic en "Vencidas", "Pendientes",
 * etc.) — reusa los mismos filtros del dashboard para que la lista siempre calce con el número
 * ya mostrado en la tarjeta (ver ListPdtBucketCompanies en el backend). Con búsqueda por
 * razón social/RUC y paginación, igual que los listados de PDT 601/621. */
function PdtBucketCompaniesModal({
  open,
  filters,
  base,
  onClose,
}: {
  open: OpenBucket;
  filters: PdtDashboardFilters;
  base: string;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<SupervisorPdtBucketCompany[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const debouncedQ = useBucketModalDebouncedValue(q, 400);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setPage(1);
  }, [debouncedQ, open.declarationType, open.bucket]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    supervisorsService
      .pdtBucketCompanies({
        period_ym: filters.periodYm,
        declaration_type: open.declarationType,
        bucket: open.bucket,
        general_status: filters.generalStatus,
        risk_level: filters.riskLevel,
        company_id: filters.companyId ? Number(filters.companyId) : undefined,
        responsible_user_id: filters.responsibleUserId ? Number(filters.responsibleUserId) : undefined,
        supervisor_user_id: filters.supervisorUserId ? Number(filters.supervisorUserId) : undefined,
        q: debouncedQ.trim().length >= 2 ? debouncedQ.trim() : undefined,
        page,
        per_page: BUCKET_MODAL_PAGE_SIZE,
      })
      .then(({ items, pagination }) => {
        if (!active) return;
        setRows(items);
        setTotal(pagination?.total ?? items.length);
      })
      .catch((err) => {
        if (active) setError(extractApiErrorMessage(err, 'No se pudo cargar la lista de empresas.'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [
    open.declarationType,
    open.bucket,
    filters.periodYm,
    filters.generalStatus,
    filters.riskLevel,
    filters.companyId,
    filters.responsibleUserId,
    filters.supervisorUserId,
    debouncedQ,
    page,
  ]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const declarationLabel = open.declarationType === 'pdt_601' ? 'PDT 601' : 'PDT 621';
  const detailSlug = open.declarationType === 'pdt_601' ? 'pdt-601' : 'pdt-621';
  const totalPages = Math.max(1, Math.ceil(total / BUCKET_MODAL_PAGE_SIZE));

  return createPortal(
    <div className="fixed inset-0 z-dialog flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Cerrar"
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-[1px]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${declarationLabel} — ${open.label}`}
        className="relative flex w-full max-w-3xl h-[min(85vh,820px)] flex-col rounded-xl bg-white shadow-xl border border-slate-200 overflow-hidden"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 px-5 py-4 border-b border-slate-200">
          <div className="min-w-0">
            <p className="text-base font-semibold text-slate-800">
              {declarationLabel} — {open.label}
            </p>
            <p className="text-xs text-slate-500">
              Período {filters.periodYm} · {total} {total === 1 ? 'empresa' : 'empresas'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
          >
            <i className="fas fa-times" aria-hidden />
          </button>
        </div>
        <div className="shrink-0 px-5 py-3 border-b border-slate-100">
          <div className="relative">
            <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400" aria-hidden />
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar por RUC o razón social…"
              className="w-full rounded-lg border border-slate-200 pl-9 pr-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-400"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {loading ? (
            <p className="text-sm text-slate-500">Cargando empresas…</p>
          ) : error ? (
            <p className="text-sm text-red-600 flex items-center gap-1.5">
              <i className="fas fa-exclamation-circle text-xs" aria-hidden />
              {error}
            </p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-slate-500">
              {q.trim().length >= 2 ? 'No hay empresas que coincidan con la búsqueda.' : 'No hay empresas en este estado.'}
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {rows.map((row) => (
                <li key={row.company_id} className="py-2.5">
                  <Link
                    to={`${base}/${detailSlug}/${row.company_id}?period_ym=${filters.periodYm}`}
                    onClick={onClose}
                    className="flex items-center justify-between gap-3 text-sm text-slate-700 hover:text-primary-700"
                  >
                    <span className="min-w-0 truncate">{row.business_name}</span>
                    <span className="shrink-0 text-xs text-slate-400">{row.ruc}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
        {!loading && !error && total > BUCKET_MODAL_PAGE_SIZE ? (
          <div className="flex shrink-0 items-center justify-between gap-3 px-5 py-3 border-t border-slate-200">
            <p className="text-xs text-slate-500">
              Página {page} de {totalPages}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50"
              >
                Anterior
              </button>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50"
              >
                Siguiente
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

export default SupervisorDashboard;
