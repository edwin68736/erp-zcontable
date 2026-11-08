import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { SireApiError } from '../../../services/sire';

/** Códigos tras los cuales hay que corregir las credenciales (no sirve reintentar). */
const CREDENTIAL_CODES = new Set(['faltan_datos', 'credenciales_api_invalidas', 'credenciales_en_pausa', 'sin_permiso_sunat']);

export function SireErrorBox({ error, onRetry }: { error: SireApiError; onRetry?: () => void }) {
  const [detail, setDetail] = useState(false);
  const needsCredentials = CREDENTIAL_CODES.has(error.code ?? '');
  return (
    <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
      <p className="font-medium">{error.message}</p>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
        {needsCredentials ? (
          <Link to="/finance/claves-sol" className="font-semibold text-red-900 underline">
            Ir a Claves SOL
          </Link>
        ) : null}
        {onRetry && !needsCredentials ? (
          <button type="button" onClick={onRetry} className="font-semibold text-red-900 underline">
            Reintentar
          </button>
        ) : null}
        {error.detail ? (
          <button type="button" onClick={() => setDetail((v) => !v)} className="text-red-700 underline">
            {detail ? 'Ocultar detalle técnico' : 'Ver detalle técnico'}
          </button>
        ) : null}
      </div>
      {detail && error.detail ? (
        <p className="mt-2 break-words rounded-md bg-white/70 px-2 py-1.5 font-mono text-2xs text-slate-700">
          {error.code ? `[${error.code}] ` : ''}
          {error.detail}
        </p>
      ) : null}
    </div>
  );
}

export function Spinner({ label = 'Consultando SUNAT…' }: { label?: string }) {
  return (
    <p className="flex items-center gap-2 text-sm text-slate-500" role="status">
      <i className="fas fa-spinner fa-spin" aria-hidden />
      {label}
    </p>
  );
}

export function Card({ title, subtitle, children, actions }: { title: string; subtitle?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-slate-800">{title}</h3>
          {subtitle ? <p className="text-xs text-slate-500">{subtitle}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}
