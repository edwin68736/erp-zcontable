import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { P } from '../rbac/codes';
import { auth } from '../services/auth';
import { useBuzonUnread } from '../utils/buzonUnread';

const STATE_KEY = 'buzon_unread_reminder';
const MAX_ROWS = 4;

interface Saved {
  minimized: boolean;
  /** Total que había la última vez que se mostró expandido: si crece, el aviso vuelve a abrirse solo. */
  seenTotal: number;
}

function loadSaved(): Saved | null {
  try {
    const raw = window.sessionStorage.getItem(STATE_KEY);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}

function saveState(s: Saved) {
  try {
    window.sessionStorage.setItem(STATE_KEY, JSON.stringify(s));
  } catch {
    /* sin almacenamiento: el aviso funciona igual */
  }
}

/** «desde hace 3 días» a partir de una fecha ISO (la publicación de la notificación más antigua sin leer). */
function ageLabel(iso?: string): string {
  if (!iso) return '';
  const d = Date.parse(iso);
  if (Number.isNaN(d)) return '';
  const days = Math.floor((Date.now() - d) / 86400000);
  if (days <= 0) return 'de hoy';
  return days === 1 ? 'desde ayer' : `desde hace ${days} días`;
}

/**
 * Aviso flotante de las notificaciones de SUNAT sin leer, junto al de la agenda del calendario. Cada persona ve solo las
 * de sus empresas (el administrador, todas). Cada fila lleva a la lista de notificaciones sin leer de esa empresa.
 * «Leído» lo decide SUNAT: el sistema no abre los mensajes, así que se actualiza cuando la persona los lee en SUNAT y se
 * sincroniza la empresa.
 */
const BuzonUnreadReminder = () => {
  const canView = useMemo(() => auth.hasPermission(P.companyCredentialsView), []);
  const { data } = useBuzonUnread(canView && !!auth.getToken());
  const [saved, setSaved] = useState<Saved | null>(() => loadSaved());
  // En las propias pantallas de Notificaciones SUNAT el aviso grande tapa los botones de arriba: queda como círculo con el contador.
  const onBuzonPages = useLocation().pathname.startsWith('/tools/notificaciones-sunat');

  const total = data?.total ?? 0;
  // Se abre solo la primera vez de la sesión y cada vez que llegan más notificaciones sin leer que las que ya se vieron.
  const grew = saved != null && total > saved.seenTotal;
  const minimized = onBuzonPages || (saved == null ? false : grew ? false : saved.minimized);

  useEffect(() => {
    if (!data || total === 0) return;
    if (saved == null || grew) {
      const next = { minimized: false, seenTotal: total };
      setSaved(next);
      saveState(next);
    } else if (total < saved.seenTotal) {
      const next = { ...saved, seenTotal: total };
      setSaved(next);
      saveState(next);
    }
  }, [data, total, saved, grew]);

  if (!canView || !data || total === 0) return null;

  const setMin = (m: boolean) => {
    const next = { minimized: m, seenTotal: total };
    setSaved(next);
    saveState(next);
  };
  const rows = data.companies.slice(0, MAX_ROWS);
  const more = data.companies.length - rows.length;
  const unchecked = data.unchecked.rejected + data.unchecked.error;

  if (minimized) {
    return (
      <button
        type="button"
        onClick={() => setMin(false)}
        className="pointer-events-auto relative flex h-11 w-11 items-center justify-center rounded-full border border-white/70 bg-gradient-to-br from-amber-500 to-amber-600 text-white shadow-[0_6px_18px_-4px_rgba(217,119,6,0.5)] transition hover:scale-105 active:scale-95"
        aria-label={`Abrir notificaciones de SUNAT sin leer: ${total}`}
        title={`${total} notificación${total === 1 ? '' : 'es'} de SUNAT sin leer`}
      >
        <i className="fas fa-envelope-open-text text-sm" aria-hidden />
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-0.5 text-3xs font-bold leading-none text-white shadow ring-1 ring-white">
          {total > 99 ? '99+' : total}
        </span>
      </button>
    );
  }

  return (
    <div
      className="pointer-events-auto w-[min(100vw-2rem,380px)] overflow-hidden rounded-2xl border border-white/70 bg-gradient-to-br from-white/95 via-white/92 to-amber-50/80 shadow-[0_20px_50px_-12px_rgba(15,23,42,0.35)] backdrop-blur-xl"
      role="region"
      aria-live="polite"
      aria-label="Notificaciones de SUNAT sin leer"
    >
      <div className="relative px-4 py-3">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-amber-500 via-red-500 to-amber-400" aria-hidden />
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-amber-600 text-white shadow-lg shadow-amber-500/30">
            <i className="fas fa-envelope-open-text text-sm" aria-hidden />
          </div>
          <div className="min-w-0 flex-1 pt-0.5">
            <p className="text-2xs font-semibold uppercase tracking-wider text-amber-700">SUNAT · Buzón electrónico</p>
            <h2 className="text-base font-semibold leading-tight text-slate-900">
              {total} notificación{total === 1 ? '' : 'es'} sin leer
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              en {data.companies.length} empresa{data.companies.length === 1 ? '' : 's'}
              {data.urgent > 0 ? (
                <span className="ml-1.5 rounded-full bg-red-100 px-1.5 py-0.5 text-2xs font-semibold text-red-700">
                  {data.urgent} urgente{data.urgent === 1 ? '' : 's'}
                </span>
              ) : null}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setMin(true)}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            aria-label="Minimizar aviso de notificaciones de SUNAT"
          >
            <i className="fas fa-minus text-xs" aria-hidden />
          </button>
        </div>
      </div>

      <ul className="max-h-[min(34vh,210px)] space-y-1.5 overflow-y-auto px-3 pb-2 custom-scrollbar">
        {rows.map((c) => (
          <li key={c.company_id}>
            <Link
              to={`/tools/notificaciones-sunat/${c.company_id}?tipo=2&no_leidas=1`}
              className="flex items-center gap-3 rounded-xl border border-slate-100/80 bg-white/80 px-3 py-2 shadow-sm transition hover:border-amber-200 hover:shadow-md"
              title={`Abrir las notificaciones sin leer de ${c.business_name}`}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-800">{c.business_name}</p>
                <p className="text-2xs text-slate-500">
                  {c.code ? `Cod ${c.code} · ` : ''}
                  {ageLabel(c.oldest) || 'sin fecha'}
                </p>
              </div>
              {c.urgent > 0 ? <i className="fas fa-flag text-xs text-red-600" title={`${c.urgent} urgente${c.urgent === 1 ? '' : 's'}`} aria-label="Urgente" /> : null}
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">{c.unread}</span>
            </Link>
          </li>
        ))}
      </ul>

      <div className="space-y-1 border-t border-slate-100/80 bg-slate-50/60 px-4 py-2.5">
        {unchecked > 0 ? (
          <p className="text-2xs text-slate-500">
            <i className="fas fa-triangle-exclamation mr-1 text-amber-600" aria-hidden />
            {unchecked} empresa{unchecked === 1 ? '' : 's'} no se pudo revisar (clave rechazada o error): ahí puede haber notificaciones que no se ven aquí.
          </p>
        ) : null}
        <Link to="/tools/notificaciones-sunat?pendientes=1" className="inline-flex items-center gap-2 text-xs font-semibold text-primary-700 transition hover:text-primary-800">
          {more > 0 ? `Ver las ${data.companies.length} empresas` : 'Ver todas'}
          <i className="fas fa-arrow-right text-2xs" aria-hidden />
        </Link>
      </div>
    </div>
  );
};

export default BuzonUnreadReminder;
