import { useCallback, useEffect, useState } from 'react';
import Button from '../../components/ui/Button';
import PageHeading from '../../components/ui/PageHeading';
import { apiErrorMessage, securityService, type SecurityEvent, type SecurityEventsPage } from '../../services/security';
import { EVENT_LABEL, describeUserAgent } from './securityUi';
import { formatDateTimeSeconds } from '../../utils/format';

const INPUT = 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800';

const fmtDate = (iso: string) => formatDateTimeSeconds(iso);

/**
 * Estudio → Bitácora de seguridad: inicios de sesión, intentos fallidos, bloqueos y cambios de contraseña, con la IP y
 * el navegador. Solo la ven quienes tienen el permiso (Super usuario y Administrador por defecto). Se conservan 180 días.
 */
const SecurityEvents = ({ embedded = false }: { embedded?: boolean }) => {
  const [type, setType] = useState('');
  const [username, setUsername] = useState('');
  const [ip, setIp] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<SecurityEventsPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await securityService.events({ type: type || undefined, username: username.trim() || undefined, ip: ip.trim() || undefined, from: from || undefined, to: to || undefined, page, per_page: 50 }));
    } catch (e) {
      setError(apiErrorMessage(e, 'No se pudo cargar la bitácora.'));
    } finally {
      setLoading(false);
    }
  }, [type, username, ip, from, to, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const filter = (fn: () => void) => {
    fn();
    setPage(1);
  };

  return (
    <div className={embedded ? 'space-y-5' : 'space-y-5 pt-2'}>
      {embedded ? (
        <p className="text-sm text-slate-500">Quién entró al sistema, quién falló y desde dónde. Se conserva 180 días.</p>
      ) : (
        <div>
          <PageHeading hint="Quién entró al sistema, quién falló y desde dónde. Se conserva 180 días.">Bitácora de seguridad</PageHeading>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <label className="text-xs text-slate-600">
          <span className="mb-0.5 block">Tipo</span>
          <select value={type} onChange={(e) => filter(() => setType(e.target.value))} className={INPUT}>
            <option value="">Todos</option>
            {Object.entries(EVENT_LABEL).map(([v, e]) => (
              <option key={v} value={v}>
                {e.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-600">
          <span className="mb-0.5 block">Usuario</span>
          <input value={username} onChange={(e) => filter(() => setUsername(e.target.value))} placeholder="Parte del usuario" className={`${INPUT} w-44`} />
        </label>
        <label className="text-xs text-slate-600">
          <span className="mb-0.5 block">IP</span>
          <input value={ip} onChange={(e) => filter(() => setIp(e.target.value))} placeholder="Ej. 190.12.3.4" className={`${INPUT} w-40`} />
        </label>
        <label className="text-xs text-slate-600">
          <span className="mb-0.5 block">Desde</span>
          <input type="date" value={from} max={to || undefined} onChange={(e) => filter(() => setFrom(e.target.value))} className={INPUT} />
        </label>
        <label className="text-xs text-slate-600">
          <span className="mb-0.5 block">Hasta</span>
          <input type="date" value={to} min={from || undefined} onChange={(e) => filter(() => setTo(e.target.value))} className={INPUT} />
        </label>
        <Button variant="secondary" className="ml-auto" disabled={loading} onClick={() => void load()}>
          <i className={`fas ${loading ? 'fa-spinner fa-spin' : 'fa-rotate'} mr-1.5`} aria-hidden />
          Actualizar
        </Button>
      </div>

      {error ? <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p> : null}

      <div className={`overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm ${loading ? 'opacity-60' : ''}`}>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="bg-blue-900 text-xs uppercase text-white">
                {['Fecha', 'Evento', 'Usuario', 'IP', 'Navegador', 'Detalle'].map((h) => (
                  <th key={h} className="whitespace-nowrap px-3 py-2.5 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data?.rows ?? []).map((r: SecurityEvent) => {
                const ev = EVENT_LABEL[r.type] ?? { label: r.type, cls: 'bg-slate-100 text-slate-700' };
                return (
                  <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50/70">
                    <td className="whitespace-nowrap px-3 py-2 text-slate-600">{fmtDate(r.created_at)}</td>
                    <td className="px-3 py-2">
                      <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${ev.cls}`}>{ev.label}</span>
                    </td>
                    <td className="px-3 py-2 font-medium text-slate-800">{r.username || '—'}</td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-slate-600">{r.ip || '—'}</td>
                    <td className="px-3 py-2 text-slate-600" title={r.user_agent}>
                      {describeUserAgent(r.user_agent)}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500">{r.detail || ''}</td>
                  </tr>
                );
              })}
              {!loading && (data?.rows.length ?? 0) === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-10 text-center text-slate-500">
                    No hay eventos para esos filtros.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {data && data.total_pages > 1 ? (
          <div className="flex items-center justify-between border-t border-slate-200 px-4 py-2 text-xs text-slate-600">
            <span>
              Página {data.page} de {data.total_pages} · {data.total} eventos
            </span>
            <div className="flex gap-2">
              <button type="button" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)} className="rounded-lg border border-slate-300 px-3 py-1 disabled:opacity-50">
                Anterior
              </button>
              <button type="button" disabled={page >= data.total_pages || loading} onClick={() => setPage((p) => p + 1)} className="rounded-lg border border-slate-300 px-3 py-1 disabled:opacity-50">
                Siguiente
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default SecurityEvents;
