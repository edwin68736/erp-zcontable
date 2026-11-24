import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { MODULE_SLUG } from '../../navigation/moduleSlugs';
import { dueText, stateLabel } from '../../pages/assistant/assistantUi';
import {
  supervisorsService,
  type AssistantBucket,
  type AssistantComprobantesLoad,
  type AssistantDigitProgress,
  type AssistantModuleProgress,
  type AssistantModuleRow,
  type AssistantPlanillaLoad,
  type AssistantWorkItem,
} from '../../services/supervisors';
import { BUCKET_LABEL, NO_FILTER, PLAZO_META, moduleSummary, countRows, deliveredText, digitRows, digitTotals, filterLabel, filterRows, fmtPct, isFiltered, pctTone, toggleFilter, type DigitFilter, type DigitRow } from './moduleDigits';

const n = (v: number) => (v > 0 ? v.toLocaleString('es-PE') : '·');

/**
 * Carga de planillas (PDT 601): cuántos trabajadores atiende cada asistente, para ver quién tiene más trabajo. El número de
 * empresas no basta: una empresa con 80 trabajadores pesa mucho más que una con 2.
 */
function PlanillaLoadTable({ load }: { load: AssistantPlanillaLoad }) {
  const max = Math.max(1, ...load.by_assistant.map((r) => r.workers));
  return (
    <div className="border-b border-slate-100 px-5 py-3">
      <p className="m-0 mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">
        Carga de planillas por asistente · {load.workers.toLocaleString('es-PE')} trabajadores en {load.companies.toLocaleString('es-PE')} empresas
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[30rem] border-collapse text-xs tabular-nums">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="py-1 pr-2 font-semibold">Asistente</th>
              <th className="px-2 py-1 text-right font-semibold">Empresas</th>
              <th className="w-[34%] px-2 py-1 font-semibold">Trabajadores</th>
              <th className="px-2 py-1 text-right font-semibold" title="Trabajadores en ONP / en AFP">
                ONP / AFP
              </th>
              <th className="px-2 py-1 text-right font-semibold">Por hacer</th>
            </tr>
          </thead>
          <tbody>
            {load.by_assistant.map((r) => (
              <tr key={r.assistant_id} className="border-t border-slate-100">
                <td className="py-1 pr-2 font-semibold text-slate-800">
                  {r.name}
                  {r.estimated > 0 || r.no_data > 0 ? (
                    <span className="ml-1 text-[10.5px] font-normal text-slate-400">
                      {r.estimated > 0 ? `${r.estimated} estimada${r.estimated === 1 ? '' : 's'}` : ''}
                      {r.estimated > 0 && r.no_data > 0 ? ' · ' : ''}
                      {r.no_data > 0 ? `${r.no_data} sin dato` : ''}
                    </span>
                  ) : null}
                </td>
                <td className="px-2 py-1 text-right text-slate-600">{n(r.companies)}</td>
                <td className="px-2 py-1">
                  <div className="flex items-center gap-2">
                    <div className="h-2 flex-1 overflow-hidden rounded bg-[#EEF3F0]">
                      <div className="h-full rounded bg-[#0E8F47]" style={{ width: `${Math.round((r.workers / max) * 100)}%` }} />
                    </div>
                    <span className="w-10 text-right font-bold text-slate-800">{n(r.workers)}</span>
                  </div>
                </td>
                <td className="px-2 py-1 text-right text-slate-500">
                  {n(r.workers_onp)} / {n(r.workers_afp)}
                </td>
                <td className={`px-2 py-1 text-right font-semibold ${r.open > 0 ? 'text-amber-700' : 'text-slate-300'}`}>{n(r.open)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="m-0 mt-1 text-[11px] text-slate-400">
        Trabajadores de la planilla del periodo (ONP + AFP). Si la planilla de este mes aún no se registró se usa la última registrada («estimada»); sin planilla o suspendidas no cuentan.
      </p>
    </div>
  );
}

/**
 * Comprobantes de ventas y compras por asistente (PDT 621 · Declaración): cuántos comprobantes atiende cada asistente, para ver quién
 * tiene más carga. El dato es la cantidad que se registra en el detalle del PDT 621; las empresas que aún no la registraron figuran «sin dato».
 */
function ComprobantesTable({ load }: { load: AssistantComprobantesLoad }) {
  const max = Math.max(1, ...load.by_assistant.map((r) => r.ventas + r.compras));
  return (
    <div className="border-b border-slate-100 px-5 py-3">
      <p className="m-0 mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">
        Comprobantes por asistente · {load.ventas.toLocaleString('es-PE')} de ventas y {load.compras.toLocaleString('es-PE')} de compras en {load.companies.toLocaleString('es-PE')} empresas
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[32rem] border-collapse text-xs tabular-nums">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="py-1 pr-2 font-semibold">Asistente</th>
              <th className="px-2 py-1 text-right font-semibold">Empresas</th>
              <th className="px-2 py-1 text-right font-semibold">Ventas</th>
              <th className="px-2 py-1 text-right font-semibold">Compras</th>
              <th className="w-[30%] px-2 py-1 font-semibold">Total</th>
              <th className="px-2 py-1 text-right font-semibold">Por hacer</th>
            </tr>
          </thead>
          <tbody>
            {load.by_assistant.map((r) => (
              <tr key={r.assistant_id} className="border-t border-slate-100">
                <td className="py-1 pr-2 font-semibold text-slate-800">
                  {r.name}
                  {r.no_data > 0 ? <span className="ml-1 text-[10.5px] font-normal text-slate-400">{r.no_data} sin dato</span> : null}
                </td>
                <td className="px-2 py-1 text-right text-slate-600">{n(r.companies)}</td>
                <td className="px-2 py-1 text-right text-slate-700">{n(r.ventas)}</td>
                <td className="px-2 py-1 text-right text-slate-700">{n(r.compras)}</td>
                <td className="px-2 py-1">
                  <div className="flex items-center gap-2">
                    <div className="h-2 flex-1 overflow-hidden rounded bg-[#EEF3F0]">
                      <div className="h-full rounded bg-[#0E8F47]" style={{ width: `${Math.round(((r.ventas + r.compras) / max) * 100)}%` }} />
                    </div>
                    <span className="w-12 text-right font-bold text-slate-800">{n(r.ventas + r.compras)}</span>
                  </div>
                </td>
                <td className={`px-2 py-1 text-right font-semibold ${r.open > 0 ? 'text-amber-700' : 'text-slate-300'}`}>{n(r.open)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="m-0 mt-1 text-[11px] text-slate-400">
        Cantidad de comprobantes (no montos) que se registra en el PDT 621 de cada empresa en el periodo. Las empresas sin ese dato no suman.
      </p>
    </div>
  );
}

const CELL_TONE: Record<AssistantBucket, string> = { dentro: 'text-green-700', fuera: 'text-orange-700', pendiente: 'text-slate-700' };

/**
 * Consolidado de las entregas del módulo por último dígito del RUC (los vencimientos de SUNAT se reparten por ese dígito): dentro y
 * fuera de plazo y pendientes, y el % de cumplimiento. Cada número se puede pulsar: la lista de abajo muestra esas empresas.
 */
function DigitConsolidated({ byDigit, filter, onFilter, ready, unit }: { byDigit: AssistantDigitProgress[]; filter: DigitFilter; onFilter: (f: DigitFilter) => void; ready: boolean; unit?: string }) {
  const rows = useMemo(() => digitRows(byDigit), [byDigit]);
  const totals = useMemo(() => digitTotals(rows), [rows]);
  const cols: { bucket: AssistantBucket; label: string; get: (r: DigitRow) => number }[] = [
    { bucket: 'dentro', label: 'Dentro de plazo', get: (r) => r.dentro },
    { bucket: 'fuera', label: 'Fuera de plazo', get: (r) => r.fuera },
    { bucket: 'pendiente', label: 'Pendientes', get: (r) => r.pendientes },
  ];
  const active = (digit: number | null, bucket: AssistantBucket | null) => filter.digit === digit && filter.bucket === bucket;
  const cell = (value: number, digit: number | null, bucket: AssistantBucket | null, tone: string, bold = false) =>
    value > 0 && ready ? (
      <button
        type="button"
        onClick={() => onFilter(toggleFilter(filter, { digit, bucket }))}
        title="Ver estas empresas"
        className={`min-w-[2rem] rounded-md px-1.5 py-0.5 tabular-nums ${tone} ${bold ? 'font-extrabold' : 'font-semibold'} hover:bg-slate-100 ${active(digit, bucket) ? 'bg-slate-200 ring-1 ring-slate-400' : ''}`}
      >
        {value.toLocaleString('es-PE')}
      </button>
    ) : (
      <span className={value > 0 ? `${tone} ${bold ? 'font-extrabold' : 'font-semibold'} tabular-nums` : 'text-slate-300'}>{n(value)}</span>
    );
  const bar = (r: DigitRow) => {
    const tone = pctTone(r.pct);
    return r.pct == null ? (
      <span className="text-slate-400" title="Aún no vence ningún plazo de este dígito">
        —
      </span>
    ) : (
      <div className="relative h-[18px] overflow-hidden rounded bg-[#EEF3F0]">
        <div className="h-full rounded" style={{ width: `${Math.min(r.pct, 100)}%`, background: tone.fg, opacity: 0.85 }} />
        <span className="absolute inset-0 flex items-center justify-center text-[10.5px] font-extrabold text-slate-900">{fmtPct(r.pct)}</span>
      </div>
    );
  };
  return (
    <div className="border-b border-slate-100 px-5 py-3">
      <p className="m-0 mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">Consolidado por último dígito del RUC{unit ? ` · ${unit}` : ''}</p>
      <div className="overflow-x-auto rounded-xl border border-[#DCE8E1]">
        <table className="w-full min-w-[34rem] border-collapse text-xs">
          <thead>
            <tr className="bg-[#E9F4EE] text-[10.5px] uppercase tracking-[0.4px] text-[#0A5A3A]">
              <th className="whitespace-nowrap px-2 py-[7px] text-left">Dig</th>
              <th className="whitespace-nowrap px-2 py-[7px] text-right">Total</th>
              {cols.map((c) => (
                <th key={c.bucket} className="whitespace-nowrap px-2 py-[7px] text-right">
                  {c.label}
                </th>
              ))}
              <th className="w-[26%] px-2 py-[7px] text-left" title="A tiempo ÷ lo que ya venció. Lo que aún está en plazo no baja el porcentaje.">
                % Cumplimiento
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.digit} className={`border-t border-[#EAF1ED] ${filter.digit === r.digit ? 'bg-slate-50' : ''}`}>
                <td className="whitespace-nowrap px-2 py-[5px] font-bold text-slate-800">RUC {r.digit}</td>
                <td className="px-2 py-[5px] text-right">{cell(r.total, r.digit, null, 'text-slate-800')}</td>
                {cols.map((c) => (
                  <td key={c.bucket} className="px-2 py-[5px] text-right">
                    {cell(c.get(r), r.digit, c.bucket, CELL_TONE[c.bucket])}
                  </td>
                ))}
                <td className="px-2 py-[5px]">{bar(r)}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-[#DCE8E1] bg-[#F8FBF9]">
              <td className="whitespace-nowrap px-2 py-[6px] font-extrabold text-slate-900">Total</td>
              <td className="px-2 py-[6px] text-right">{cell(totals.total, null, null, 'text-slate-900', true)}</td>
              {cols.map((c) => (
                <td key={c.bucket} className="px-2 py-[6px] text-right">
                  {cell(c.get(totals), null, c.bucket, CELL_TONE[c.bucket], true)}
                </td>
              ))}
              <td className="px-2 py-[6px]">{bar(totals)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="m-0 mt-1 text-[11px] text-slate-400">
        {ready ? 'Pulse un número para ver esas empresas abajo.' : 'Cargando el detalle de las empresas…'} El % es lo entregado a tiempo ÷ lo que ya tenía plazo cumplido, entregado o no (meta {PLAZO_META}%).
      </p>
    </div>
  );
}

/** Una tarea abierta del panel como fila del módulo (mientras llega el detalle completo). */
function workAsRow(w: AssistantWorkItem): AssistantModuleRow {
  return {
    company_id: w.company_id, company: w.company, ruc: w.ruc ?? '', digit: /\d$/.test(w.ruc ?? '') ? Number((w.ruc ?? '').slice(-1)) : -1, assistant: w.assistant,
    state: w.state, bucket: 'pendiente', declaration_id: w.declaration_id, due_date: w.due_date, days_left: w.days_left,
    hint: w.hint || w.detail,
  };
}

/** La fila del detalle como tarea del panel, para reusar los textos de plazo y la ruta de «Abrir». */
function rowAsWork(r: AssistantModuleRow, moduleKey: string, moduleLabel: string): AssistantWorkItem {
  const state: AssistantWorkItem['state'] = r.state === 'vencida' || r.state === 'observada' || r.state === 'por_revisar' ? r.state : 'pendiente';
  return { company_id: r.company_id, company: r.company, ruc: r.ruc, module_key: moduleKey, module_label: moduleLabel, state, due_date: r.due_date, days_left: r.days_left, declaration_id: r.declaration_id };
}

const BUCKET_BADGE: Record<AssistantBucket, { bg: string; fg: string; stripe: string }> = {
  dentro: { bg: '#DCF5E6', fg: '#0A7A3B', stripe: '#16A34A' },
  fuera: { bg: '#FFEDD5', fg: '#C2410C', stripe: '#EA580C' },
  pendiente: { bg: '#E2E8F0', fg: '#475569', stripe: '#94A3B8' },
};

/**
 * Empresas de una actividad (módulo) del panel del asistente. Se abre al pulsar un módulo: arriba el consolidado por último dígito del
 * RUC (con % de cumplimiento) y, abajo, las empresas. Al pulsar un número del consolidado la lista muestra solo esas empresas
 * (dentro de plazo, fuera de plazo o pendientes); desde aquí se puede abrir cada empresa o ir al módulo completo.
 */
const ModulePendingModal = ({
  module,
  items,
  periodYm,
  truncated,
  scope,
  detailPath,
  onClose,
  fetchDetail,
  initialFilter,
  moduleHref,
}: {
  module: AssistantModuleProgress | null;
  /** Tareas abiertas de ese módulo (la lista de trabajo del panel, ya filtrada por módulo): se muestran mientras llega el detalle completo. */
  items: AssistantWorkItem[];
  periodYm: string;
  /** La lista del panel se recortó por tamaño: aquí puede faltar alguna empresa. */
  truncated?: boolean;
  /** Los filtros del panel (asistente y supervisor), para pedir el detalle con el mismo alcance. */
  scope?: { assistantId?: number; supervisorId?: number };
  detailPath: (w: AssistantWorkItem) => string;
  onClose: () => void;
  /** Cómo pedir el detalle por empresa; sin esto se usa el del panel del asistente (con `scope`). El dashboard del supervisor pasa el suyo. */
  fetchDetail?: (moduleKey: string) => Promise<AssistantModuleRow[]>;
  /** Filtro con el que se abre (el número que se pulsó en el dashboard). */
  initialFilter?: DigitFilter;
  /** A dónde lleva «Ir al módulo» (por defecto, el módulo del asistente). */
  moduleHref?: (slug: string) => string;
}) => {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<DigitFilter>(NO_FILTER);
  const [detail, setDetail] = useState<AssistantModuleRow[] | null>(null);
  const [detailError, setDetailError] = useState(false);
  const open = module != null;
  const moduleKey = module?.key ?? '';
  const hasDigits = Boolean(module?.by_digit && module.by_digit.length > 0);
  const fetchRef = useRef(fetchDetail);
  fetchRef.current = fetchDetail;
  const initialFilterRef = useRef(initialFilter);
  initialFilterRef.current = initialFilter;

  useEffect(() => {
    if (!open) return;
    setQ('');
    setFilter(initialFilterRef.current ?? NO_FILTER);
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // El detalle completo (también lo ya entregado) se pide al abrir; el Buzón SOL no tiene consolidado por dígito y usa la lista del panel.
  useEffect(() => {
    setDetail(null);
    setDetailError(false);
    if (!open || !hasDigits) return;
    let alive = true;
    const load = fetchRef.current
      ? fetchRef.current(moduleKey)
      : supervisorsService
          .assistantModuleDetail({
            period_ym: periodYm,
            module_key: moduleKey,
            ...(scope?.assistantId ? { assistant_user_id: scope.assistantId } : {}),
            ...(scope?.supervisorId ? { supervisor_user_id: scope.supervisorId } : {}),
          })
          .then((r) => r.rows);
    load
      .then((rows) => {
        if (alive) setDetail(rows);
      })
      .catch(() => {
        if (alive) setDetailError(true);
      });
    return () => {
      alive = false;
    };
  }, [open, hasDigits, moduleKey, periodYm, scope?.assistantId, scope?.supervisorId]);

  // Sin el detalle todavía (o si falló), se muestran las tareas abiertas del panel.
  const allRows = useMemo(() => detail ?? items.map(workAsRow), [detail, items]);
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return filterRows(allRows, filter).filter((r) => !t || r.company.toLowerCase().includes(t) || (r.ruc ?? '').includes(t) || (r.assistant ?? '').toLowerCase().includes(t));
  }, [allRows, filter, q]);
  const bucketCounts = useMemo(() => {
    const base = { digit: filter.digit };
    return (Object.keys(BUCKET_LABEL) as AssistantBucket[]).map((b) => ({ bucket: b, count: countRows(allRows, { ...base, bucket: b }) }));
  }, [allRows, filter.digit]);

  if (!module) return null;
  const slug = MODULE_SLUG[module.key];
  const summary = moduleSummary(module);
  const isDeclaration = module.key === 'pdt_621_declaracion';

  return createPortal(
    <div
      className="fixed inset-0 z-dialog flex items-center justify-center bg-slate-900/50 p-3 sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="module-pending-title"
        className="notify-pop flex max-h-[90dvh] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <h2 id="module-pending-title" className="m-0 text-lg font-bold text-slate-900">
              {module.label}
            </h2>
            <p className="m-0 mt-1 text-[12.5px] text-slate-600">
              {summary.text} · <strong>{summary.left.toLocaleString('es-PE')} por hacer</strong> · periodo {periodYm}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Cerrar"
          >
            <i className="fas fa-times" aria-hidden />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {module.planilla && module.planilla.by_assistant.length > 0 ? <PlanillaLoadTable load={module.planilla} /> : null}
          {module.comprobantes && module.comprobantes.by_assistant.length > 0 ? <ComprobantesTable load={module.comprobantes} /> : null}
          {module.by_digit && module.by_digit.length > 0 ? <DigitConsolidated byDigit={module.by_digit} filter={filter} onFilter={setFilter} ready={detail != null} unit={module.key === 'sunat_inbox' ? 'cada captura semanal (SUNAT y SUNAFIL) cuenta por separado' : undefined} /> : null}

          <div className="space-y-2 border-b border-slate-100 px-5 py-3">
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar empresa, RUC o asistente…"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/25"
              aria-label="Buscar empresa"
            />
            {detail != null ? (
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <button
                  type="button"
                  onClick={() => setFilter({ digit: filter.digit, bucket: null })}
                  className={`rounded-full border px-2.5 py-1 font-semibold ${filter.bucket == null ? 'border-slate-700 bg-slate-800 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}
                >
                  Todas {countRows(allRows, { digit: filter.digit, bucket: null })}
                </button>
                {bucketCounts.map(({ bucket, count }) => (
                  <button
                    key={bucket}
                    type="button"
                    disabled={count === 0}
                    onClick={() => setFilter({ digit: filter.digit, bucket: filter.bucket === bucket ? null : bucket })}
                    className={`rounded-full border px-2.5 py-1 font-semibold disabled:opacity-40 ${filter.bucket === bucket ? 'border-slate-700 bg-slate-800 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}
                  >
                    {BUCKET_LABEL[bucket]} {count}
                  </button>
                ))}
              </div>
            ) : null}
            {isFiltered(filter) ? (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-50 px-2.5 py-1 font-semibold text-sky-800">
                  <i className="fas fa-filter text-[10px]" aria-hidden />
                  {filterLabel(filter)}
                  <button type="button" onClick={() => setFilter(NO_FILTER)} className="ml-0.5 text-sky-700 hover:text-sky-900" aria-label="Quitar el filtro">
                    <i className="fas fa-times" aria-hidden />
                  </button>
                </span>
              </div>
            ) : null}
            {detailError ? <p className="m-0 text-[11px] text-amber-700">No se pudo cargar el detalle completo: se muestran solo las tareas por hacer.</p> : null}
            {module.key === 'sunat_inbox' ? (
              <p className="m-0 text-[11px] text-slate-500">Buzón SOL: una fila por empresa con sus capturas sin hacer (cada semana, SUNAT y SUNAFIL por separado).</p>
            ) : null}
          </div>

          <div className="min-h-[8rem] px-5 py-1">
            {filtered.length === 0 ? (
              <p className="py-10 text-center text-sm text-slate-500">
                {allRows.length === 0 ? 'No hay empresas con tareas por hacer en este módulo y periodo.' : 'Ninguna empresa coincide con el filtro o la búsqueda.'}
              </p>
            ) : (
              <ul className="m-0 list-none p-0">
                {filtered.map((r) => {
                  const w = rowAsWork(r, module.key, module.label);
                  const done = r.state === 'completada';
                  const atrasada = r.bucket === 'pendiente' && (r.days_left ?? 0) < 0;
                  const badge = atrasada ? { bg: '#FEE2E2', fg: '#B91C1C', stripe: '#DC2626' } : BUCKET_BADGE[r.bucket];
                  const due = dueText(w);
                  const supervisorTask = module.owner === 'supervisor';
                  const delivered = deliveredText(r, isDeclaration ? 'Declaró' : 'Entregó');
                  // En la declaración, lo fuera de plazo o lo pendiente con el plazo ya pasado muestra la nota que dejó el supervisor (el motivo).
                  const wantsNote = isDeclaration && (r.bucket === 'fuera' || (r.bucket === 'pendiente' && (r.days_left ?? 0) < 0));
                  return (
                    <li key={`${r.company_id}-${r.state}-${r.hint ?? ''}`} className="flex items-start gap-3 border-b border-[#EAF1ED] py-[10px] last:border-b-0">
                      <div className="w-1 shrink-0 self-stretch rounded" style={{ background: badge.stripe }} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <strong className="text-[13px]">{r.company}</strong>
                          <span className="rounded-md px-[7px] py-px text-[10.5px] font-extrabold" style={{ background: badge.bg, color: badge.fg }}>
                            {done ? BUCKET_LABEL[r.bucket] : r.counts ? BUCKET_LABEL[r.bucket] : r.state === 'observada' ? 'Observada' : r.state === 'por_revisar' ? 'Por revisar' : stateLabel(w)}
                          </span>
                          {r.assistant ? (
                            <span className="rounded-md bg-sky-50 px-[7px] py-px text-[10.5px] font-bold text-sky-800" title="Asistente de la empresa">
                              <i className="fas fa-user mr-1 text-[9px]" aria-hidden />
                              {r.assistant}
                            </span>
                          ) : null}
                          {supervisorTask ? <span className="rounded-md bg-violet-50 px-[7px] py-px text-[10.5px] font-bold text-violet-800">Supervisor</span> : null}
                          {r.digit >= 0 ? <span className="rounded-md bg-slate-100 px-[7px] py-px text-[10.5px] font-bold text-slate-600">RUC …{r.digit}</span> : null}
                        </div>
                        {r.counts ? null : (
                          <div className={`mt-[2px] text-[11.5px] ${!done && due.urgent ? 'font-bold text-red-700' : 'text-slate-600'}`}>
                            {done ? [delivered, r.due_date ? `plazo ${r.due_date.split('-').reverse().join('/')}` : ''].filter(Boolean).join(' · ') || 'Entregada' : due.text}
                          </div>
                        )}
                        {r.hint ? <div className="mt-[2px] text-[11px] text-slate-500">{r.hint}</div> : null}
                        {wantsNote ? (
                          r.observacion ? (
                            <div className="mt-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11.5px] text-amber-900">
                              <strong>Observación:</strong> {r.observacion}
                            </div>
                          ) : (
                            <div className="mt-1 text-[11px] italic text-slate-400">Sin observación registrada</div>
                          )
                        ) : null}
                      </div>
                      <Link
                        to={detailPath(w)}
                        onClick={onClose}
                        className="shrink-0 whitespace-nowrap rounded-[9px] border border-[#CBD5E1] bg-white px-[12px] py-[6px] text-xs font-bold text-slate-700 hover:bg-slate-50"
                      >
                        Abrir
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/70 px-5 py-3">
          <span className="text-[11px] text-slate-500">
            {filtered.length.toLocaleString('es-PE')} {filtered.length === 1 ? 'empresa' : 'empresas'}
            {truncated && detail == null ? ' · lista parcial: el panel envía solo las más urgentes' : ''}
          </span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              Cerrar
            </button>
            {slug ? (
              <Link
                to={moduleHref ? moduleHref(slug) : `/assistant/activities/${slug}?period_ym=${encodeURIComponent(periodYm)}`}
                onClick={onClose}
                className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
              >
                Ir al módulo <i className="fas fa-arrow-right text-xs" aria-hidden />
              </Link>
            ) : null}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default ModulePendingModal;
