import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { MODULE_SLUG } from '../../navigation/moduleSlugs';
import { STATE_STYLE, dueText, stateLabel } from '../../pages/assistant/assistantUi';
import type { AssistantDigitProgress, AssistantModuleProgress, AssistantPlanillaLoad, AssistantWorkItem } from '../../services/supervisors';

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
 * Consolidado de las entregas del módulo por último dígito del RUC: cuántas se hicieron dentro y fuera de plazo y cuántas
 * faltan (los vencimientos de SUNAT se reparten por ese dígito).
 */
function DigitConsolidated({ byDigit }: { byDigit: AssistantDigitProgress[] }) {
  const rows: { label: string; tone: string; get: (d: AssistantDigitProgress) => number }[] = [
    { label: 'Dentro de plazo', tone: 'text-green-700', get: (d) => d.on_time },
    { label: 'Fuera de plazo', tone: 'text-red-700', get: (d) => d.late },
    { label: 'Por hacer', tone: 'text-slate-600', get: (d) => d.total - d.completed },
  ];
  const sum = (get: (d: AssistantDigitProgress) => number) => byDigit.reduce((acc, d) => acc + get(d), 0);
  return (
    <div className="border-b border-slate-100 px-5 py-3">
      <p className="m-0 mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">Consolidado por último dígito del RUC</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[30rem] border-collapse text-center text-xs tabular-nums">
          <thead>
            <tr className="text-slate-500">
              <th className="py-1 pr-2 text-left font-semibold">RUC termina en</th>
              {byDigit.map((d) => (
                <th key={d.digit} className="w-9 px-1 py-1 font-bold text-slate-700">
                  {d.digit}
                </th>
              ))}
              <th className="w-12 px-1 py-1 font-bold text-slate-800">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-t border-slate-100">
                <th className={`py-1 pr-2 text-left font-semibold ${r.tone}`}>{r.label}</th>
                {byDigit.map((d) => {
                  const v = r.get(d);
                  return (
                    <td key={d.digit} className={`px-1 py-1 ${v > 0 ? `font-semibold ${r.tone}` : 'text-slate-300'}`}>
                      {n(v)}
                    </td>
                  );
                })}
                <td className={`px-1 py-1 font-bold ${r.tone}`}>{n(sum(r.get))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="m-0 mt-1 text-[11px] text-slate-400">Dentro y fuera de plazo cuentan lo ya entregado; «por hacer» es lo que falta del periodo.</p>
    </div>
  );
}

/**
 * Empresas con tareas por hacer de una actividad (módulo) del panel del asistente. Se abre al pulsar un módulo, en vez de
 * llevar directo a su pantalla; desde aquí se puede abrir cada empresa o ir al módulo completo.
 */
const ModulePendingModal = ({
  module,
  items,
  periodYm,
  truncated,
  detailPath,
  onClose,
}: {
  module: AssistantModuleProgress | null;
  /** Tareas abiertas de ese módulo (la lista de trabajo del panel, ya filtrada por módulo). */
  items: AssistantWorkItem[];
  periodYm: string;
  /** La lista del panel se recortó por tamaño: aquí puede faltar alguna empresa. */
  truncated?: boolean;
  detailPath: (w: AssistantWorkItem) => string;
  onClose: () => void;
}) => {
  const [q, setQ] = useState('');
  const open = module != null;

  useEffect(() => {
    if (!open) return;
    setQ('');
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return items;
    return items.filter((w) => w.company.toLowerCase().includes(t) || (w.ruc ?? '').includes(t) || (w.assistant ?? '').toLowerCase().includes(t));
  }, [items, q]);

  if (!module) return null;
  const slug = MODULE_SLUG[module.key];
  const left = module.total - module.completed;

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
        className="notify-pop flex max-h-[88dvh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <h2 id="module-pending-title" className="m-0 text-lg font-bold text-slate-900">
              {module.label}
            </h2>
            <p className="m-0 mt-1 text-[12.5px] text-slate-600">
              {module.completed.toLocaleString('es-PE')} de {module.total.toLocaleString('es-PE')} tareas completadas · <strong>{left.toLocaleString('es-PE')} por hacer</strong> · periodo {periodYm}
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

        {module.planilla && module.planilla.by_assistant.length > 0 ? <PlanillaLoadTable load={module.planilla} /> : null}
        {module.by_digit && module.by_digit.length > 0 ? <DigitConsolidated byDigit={module.by_digit} /> : null}

        <div className="border-b border-slate-100 px-5 py-3">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar empresa, RUC o asistente…"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/25"
            aria-label="Buscar empresa"
          />
          {module.key === 'sunat_inbox' ? (
            <p className="m-0 mt-2 text-[11px] text-slate-500">Buzón SOL: una fila por empresa con sus capturas vencidas (cada semana, SUNAT y SUNAFIL por separado).</p>
          ) : null}
        </div>

        <div className="min-h-[8rem] flex-1 overflow-y-auto px-5 py-1">
          {filtered.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-500">
              {items.length === 0 ? 'No hay empresas con tareas por hacer en este módulo y periodo.' : 'Ninguna empresa coincide con la búsqueda.'}
            </p>
          ) : (
            <ul className="m-0 list-none p-0">
              {filtered.map((w) => {
                const st = STATE_STYLE[w.state];
                const due = dueText(w);
                const supervisorTask = w.owner === 'supervisor';
                return (
                  <li key={`${w.company_id}-${w.slot ?? 0}-${w.week_start ?? ''}-${w.detail ?? ''}-${w.state}`} className="flex items-start gap-3 border-b border-[#EAF1ED] py-[10px] last:border-b-0">
                    <div className="w-1 shrink-0 self-stretch rounded" style={{ background: st.stripe }} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <strong className="text-[13px]">{w.company}</strong>
                        <span className="rounded-md px-[7px] py-px text-[10.5px] font-extrabold" style={{ background: st.bg, color: st.fg }}>
                          {stateLabel(w)}
                        </span>
                        {w.detail || w.slot ? <span className="rounded-md bg-slate-100 px-[7px] py-px text-[10.5px] font-bold text-slate-700">{w.detail || `${w.slot}.ª entrega`}</span> : null}
                        {w.assistant ? (
                          <span className="rounded-md bg-sky-50 px-[7px] py-px text-[10.5px] font-bold text-sky-800" title="Asistente de la empresa">
                            <i className="fas fa-user mr-1 text-[9px]" aria-hidden />
                            {w.assistant}
                          </span>
                        ) : null}
                        {supervisorTask ? <span className="rounded-md bg-violet-50 px-[7px] py-px text-[10.5px] font-bold text-violet-800">Supervisor</span> : null}
                      </div>
                      <div className={`mt-[2px] text-[11.5px] ${due.urgent ? 'font-bold text-red-700' : 'text-slate-600'}`}>{due.text}</div>
                      {w.hint ? <div className="mt-[2px] text-[11px] text-slate-500">{w.hint}</div> : null}
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

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/70 px-5 py-3">
          <span className="text-[11px] text-slate-500">
            {filtered.length.toLocaleString('es-PE')} {filtered.length === 1 ? 'empresa' : 'empresas'}
            {truncated ? ' · lista parcial: el panel envía solo las más urgentes' : ''}
          </span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              Cerrar
            </button>
            {slug ? (
              <Link
                to={`/assistant/activities/${slug}?period_ym=${encodeURIComponent(periodYm)}`}
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
