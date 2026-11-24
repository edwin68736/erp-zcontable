import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';

/** Una empresa de la lista: nombre, RUC y, opcionalmente, una línea de detalle y a dónde abrirla. */
export interface CompanyListItem {
  key: string | number;
  company: string;
  ruc?: string;
  /** Asistente de la empresa. */
  assistant?: string;
  /** Línea de detalle bajo el nombre («2 capturas pendientes»). */
  detail?: string;
  to?: string;
}

/**
 * Lista de empresas detrás de un número del dashboard del supervisor (suspendidas, capturas de buzón pendientes…). Es solo
 * lectura: buscar por empresa, RUC o asistente y abrir cada una.
 */
const CompanyListModal = ({ title, subtitle, items, empty, onClose }: { title: string; subtitle?: string; items: CompanyListItem[]; empty?: string; onClose: () => void }) => {
  const [q, setQ] = useState('');

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? items.filter((r) => r.company.toLowerCase().includes(t) || (r.ruc ?? '').includes(t) || (r.assistant ?? '').toLowerCase().includes(t)) : items;
  }, [items, q]);

  return createPortal(
    <div
      className="fixed inset-0 z-dialog flex items-center justify-center bg-slate-900/50 p-3 sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="company-list-title" className="notify-pop flex max-h-[90dvh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <h2 id="company-list-title" className="m-0 text-lg font-bold text-slate-900">
              {title}
            </h2>
            {subtitle ? <p className="m-0 mt-1 text-[12.5px] text-slate-600">{subtitle}</p> : null}
          </div>
          <button type="button" onClick={onClose} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Cerrar">
            <i className="fas fa-times" aria-hidden />
          </button>
        </div>

        {items.length > 6 ? (
          <div className="border-b border-slate-100 px-5 py-3">
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar empresa, RUC o asistente…"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/25"
              aria-label="Buscar empresa"
            />
          </div>
        ) : null}

        <div className="min-h-[6rem] flex-1 overflow-y-auto px-5 py-1">
          {shown.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-500">{items.length === 0 ? (empty ?? 'No hay empresas.') : 'Ninguna empresa coincide con la búsqueda.'}</p>
          ) : (
            <ul className="m-0 list-none p-0">
              {shown.map((r) => (
                <li key={r.key} className="flex items-center gap-3 border-b border-[#EAF1ED] py-[10px] last:border-b-0">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="text-[13px]">{r.company}</strong>
                      {r.ruc ? <span className="rounded-md bg-slate-100 px-[7px] py-px text-[10.5px] font-bold text-slate-600">{r.ruc}</span> : null}
                      {r.assistant ? (
                        <span className="rounded-md bg-sky-50 px-[7px] py-px text-[10.5px] font-bold text-sky-800" title="Asistente de la empresa">
                          <i className="fas fa-user mr-1 text-[9px]" aria-hidden />
                          {r.assistant}
                        </span>
                      ) : null}
                    </div>
                    {r.detail ? <div className="mt-[2px] text-[11.5px] text-slate-600">{r.detail}</div> : null}
                  </div>
                  {r.to ? (
                    <Link to={r.to} onClick={onClose} className="shrink-0 whitespace-nowrap rounded-[9px] border border-[#CBD5E1] bg-white px-[12px] py-[6px] text-xs font-bold text-slate-700 hover:bg-slate-50">
                      Abrir
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/70 px-5 py-3">
          <span className="text-[11px] text-slate-500">
            {shown.length.toLocaleString('es-PE')} {shown.length === 1 ? 'empresa' : 'empresas'}
          </span>
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Cerrar
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default CompanyListModal;
