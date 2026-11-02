import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import Button from '../../../components/ui/Button';
import {
  sireService,
  sireTicketFileRefs,
  type SireApiError,
  type SireLibro,
  type SirePreview,
  type SireTicketRecord,
  type TicketFileRef,
} from '../../../services/sire';
import { INPUT_CLS, SELECT_CLS } from './sireUi';

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
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
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

// ───────────────────────────── Vista de tablas (TXT/CSV de SUNAT) ─────────────────────────────

/**
 * Ventana con el contenido de un archivo de SUNAT como tabla: pagina y busca en el servidor (los archivos
 * pueden tener decenas de miles de filas). `load` pide una página; si el archivo trae varias tablas, se elige arriba.
 */
export function SireTableModal({
  title,
  load,
  onClose,
}: {
  title: string;
  load: (view: { table: number; page: number; per_page: number; q: string }) => Promise<SirePreview>;
  onClose: () => void;
}) {
  const [table, setTable] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [qInput, setQInput] = useState('');
  const [data, setData] = useState<SirePreview | null>(null);
  const [error, setError] = useState<SireApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const perPage = 100;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    load({ table, page, per_page: perPage, q })
      .then((d) => {
        if (alive) setData(d);
      })
      .catch((e: SireApiError) => {
        if (alive) setError(e);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [load, table, page, q]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const t = data?.table;
  const pages = t ? Math.max(1, Math.ceil(t.filtered / perPage)) : 1;

  return createPortal(
    <div className="fixed inset-0 z-dialog flex items-center justify-center p-3">
      <button type="button" aria-label="Cerrar" onClick={onClose} className="absolute inset-0 bg-slate-900/50 backdrop-blur-[1px]" />
      <div role="dialog" aria-modal="true" aria-label={title} className="relative flex max-h-[92vh] w-full max-w-6xl flex-col rounded-2xl border border-slate-200 bg-white shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-bold text-slate-800">{title}</h2>
            {t ? (
              <p className="text-xs text-slate-500">
                {t.filtered.toLocaleString('es-PE')} de {t.total.toLocaleString('es-PE')} filas
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {data && data.tables.length > 1 ? (
              <select
                value={table}
                onChange={(e) => {
                  setTable(Number(e.target.value));
                  setPage(1);
                }}
                className={SELECT_CLS}
                aria-label="Archivo"
              >
                {data.tables.map((x, i) => (
                  <option key={x.name} value={i}>
                    {x.name} ({x.total})
                  </option>
                ))}
              </select>
            ) : null}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setPage(1);
                setQ(qInput);
              }}
              className="flex items-center gap-1"
            >
              <input value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder="Buscar en la tabla…" className={`${INPUT_CLS} w-48`} />
              <Button type="submit" variant="secondary" className="!px-3">
                <i className="fas fa-magnifying-glass" aria-hidden />
              </Button>
            </form>
            <Button variant="secondary" onClick={onClose}>
              Cerrar
            </Button>
          </div>
        </div>

        <div className="min-h-[8rem] flex-1 overflow-auto p-3">
          {loading && !data ? <Spinner label="Leyendo el archivo…" /> : null}
          {error ? <SireErrorBox error={error} /> : null}
          {data && !t && !loading ? (
            <p className="text-sm text-slate-500">El archivo no contiene una tabla que se pueda mostrar. Descárguelo para abrirlo.</p>
          ) : null}
          {t ? (
            <table className="min-w-full border-collapse text-left text-xs">
              <thead>
                <tr>
                  <th className="sticky top-0 border-b border-slate-200 bg-slate-100 px-2 py-1.5 text-slate-500">#</th>
                  {t.columns.map((c, i) => (
                    <th key={`${c}-${i}`} className="sticky top-0 whitespace-nowrap border-b border-slate-200 bg-slate-100 px-2 py-1.5 font-semibold text-slate-700">
                      {c || `Col ${i + 1}`}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className={loading ? 'opacity-50' : undefined}>
                {t.rows.map((r, ri) => (
                  <tr key={ri} className="odd:bg-white even:bg-slate-50/60">
                    <td className="border-b border-slate-100 px-2 py-1 text-slate-400">{(t.page - 1) * t.per_page + ri + 1}</td>
                    {t.columns.map((_, ci) => (
                      <td key={ci} className="whitespace-nowrap border-b border-slate-100 px-2 py-1 text-slate-700">
                        {r[ci] ?? ''}
                      </td>
                    ))}
                  </tr>
                ))}
                {t.rows.length === 0 ? (
                  <tr>
                    <td colSpan={t.columns.length + 1} className="px-2 py-6 text-center text-slate-500">
                      Sin filas para mostrar.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          ) : null}
        </div>

        {t && pages > 1 ? (
          <div className="flex items-center justify-between border-t border-slate-200 px-4 py-2 text-xs text-slate-600">
            <span>
              Página {page} de {pages}
            </span>
            <div className="flex gap-2">
              <Button variant="secondary" className="!px-3 !py-1" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Anterior
              </Button>
              <Button variant="secondary" className="!px-3 !py-1" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                Siguiente
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

/** Botones "Ver tabla / Descargar" de cada archivo que generó un ticket terminado. */
export function SireTicketFiles({ companyId, libro, record }: { companyId: number; libro: SireLibro; record: SireTicketRecord }) {
  const refs = sireTicketFileRefs(libro, record);
  const [preview, setPreview] = useState<TicketFileRef | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState<SireApiError | null>(null);

  const loadPreview = useCallback(
    (view: { table: number; page: number; per_page: number; q: string }) =>
      preview ? sireService.ticketFilePreview(companyId, preview, view) : Promise.reject<SirePreview>({ message: 'Sin archivo' }),
    [companyId, preview],
  );

  if (refs.length === 0) return <span className="text-xs text-slate-400">Sin archivos</span>;

  const download = async (f: TicketFileRef) => {
    setBusy(f.name);
    setError(null);
    try {
      await sireService.downloadTicketFile(companyId, f);
    } catch (e) {
      setError(e as SireApiError);
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="space-y-1">
      {refs.map((f) => (
        <div key={f.name} className="flex flex-wrap items-center gap-2 text-xs">
          <span className="max-w-[16rem] truncate font-mono text-slate-600" title={f.name}>
            {f.name}
          </span>
          <button type="button" onClick={() => setPreview(f)} className="rounded-md border border-slate-300 px-2 py-0.5 font-medium text-slate-700 hover:bg-slate-50">
            <i className="fas fa-table mr-1" aria-hidden />
            Ver
          </button>
          <button
            type="button"
            disabled={busy === f.name}
            onClick={() => void download(f)}
            className="rounded-md border border-slate-300 px-2 py-0.5 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <i className={`fas ${busy === f.name ? 'fa-spinner fa-spin' : 'fa-download'} mr-1`} aria-hidden />
            Descargar
          </button>
        </div>
      ))}
      {error ? <SireErrorBox error={error} /> : null}
      {preview ? <SireTableModal title={preview.name} load={loadPreview} onClose={() => setPreview(null)} /> : null}
    </div>
  );
}

// ───────────────────────────── JSON genérico (respuestas de consulta) ─────────────────────────────

function flatten(obj: unknown, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  if (obj === null || obj === undefined) return out;
  if (typeof obj !== 'object' || Array.isArray(obj)) {
    out[prefix || 'valor'] = Array.isArray(obj) ? obj.map(String).join(', ') : String(obj);
    return out;
  }
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = Array.isArray(v) ? `${v.length} elementos` : v === null || v === undefined ? '' : String(v);
  }
  return out;
}

/** Lista de objetos como tabla (una columna por campo; los objetos anidados se aplanan). */
export function JsonTable({ rows }: { rows: unknown[] }) {
  const flat = rows.map((r) => flatten(r));
  const cols = Array.from(new Set(flat.flatMap((r) => Object.keys(r))));
  if (flat.length === 0) return <p className="text-sm text-slate-500">Sin registros.</p>;
  return (
    <div className="overflow-auto">
      <table className="min-w-full border-collapse text-left text-xs">
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c} className="whitespace-nowrap border-b border-slate-200 bg-slate-100 px-2 py-1.5 font-semibold text-slate-700">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {flat.map((r, i) => (
            <tr key={i} className="odd:bg-white even:bg-slate-50/60">
              {cols.map((c) => (
                <td key={c} className="whitespace-nowrap border-b border-slate-100 px-2 py-1 text-slate-700">
                  {r[c] ?? ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Objeto como lista campo → valor. */
export function JsonKeyValues({ value }: { value: unknown }) {
  const flat = flatten(value);
  const entries = Object.entries(flat);
  if (entries.length === 0) return <p className="text-sm text-slate-500">Sin datos.</p>;
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
      {entries.map(([k, v]) => (
        <div key={k} className="flex items-baseline justify-between gap-3 border-b border-slate-100 py-1">
          <dt className="text-slate-500">{k}</dt>
          <dd className="font-medium text-slate-800">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
