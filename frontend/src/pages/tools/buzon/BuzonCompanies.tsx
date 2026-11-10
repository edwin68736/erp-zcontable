import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import ActivityOwnerFilters from '../../../components/activity/ActivityOwnerFilters';
import PageHeading from '../../../components/ui/PageHeading';
import { companyAccessCredentialsService, type CompanyAccessCredentialRow } from '../../../services/companyAccessCredentials';
import { sunatBuzonService, type BuzonSync } from '../../../services/sunatBuzon';
import { INPUT_CLS } from '../sire/sireUi';
import { buzonBadge, timeAgo } from './buzonUi';
import Alert from '../../../components/ui/Alert';
import { useBuzonUnread } from '../../../utils/buzonUnread';

const PER_PAGE = 20;

/**
 * Herramientas → Notificaciones SUNAT: lista de empresas con el estado de la última sincronización de su buzón
 * electrónico (lo que ya está guardado). Cada empresa se abre para ver sus notificaciones y sincronizar.
 */
const BuzonCompanies = () => {
  const [q, setQ] = useState('');
  const [qInput, setQInput] = useState('');
  const [page, setPage] = useState(1);
  const [assistantId, setAssistantId] = useState<number | null>(null);
  const [supervisorId, setSupervisorId] = useState<number | null>(null);
  const [rows, setRows] = useState<CompanyAccessCredentialRow[]>([]);
  const [states, setStates] = useState<Record<string, BuzonSync>>({});
  const [running, setRunning] = useState(0);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // «Solo con notificaciones sin leer»: lista las empresas del alcance de la persona que tienen pendientes (el aviso flotante enlaza aquí).
  const [params, setParams] = useSearchParams();
  const pendientes = params.get('pendientes') === '1';
  const { data: unread } = useBuzonUnread(true);
  const pending = (unread?.companies ?? []).filter((c) => {
    const t = qInput.trim().toLowerCase();
    return t.length < 2 || `${c.business_name} ${c.ruc} ${c.code}`.toLowerCase().includes(t);
  });
  const unchecked = (unread?.unchecked.rejected ?? 0) + (unread?.unchecked.error ?? 0);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await companyAccessCredentialsService.list({
        q: q.trim().length >= 2 ? q.trim() : undefined,
        page,
        per_page: PER_PAGE,
        assistant_user_id: assistantId ?? undefined,
        supervisor_user_id: supervisorId ?? undefined,
      });
      const list = res.data ?? [];
      setRows(list);
      setTotal(res.total);
      setTotalPages(res.total_pages || 1);
      try {
        const s = await sunatBuzonService.summary(list.map((r) => r.company_id));
        setStates(s.data);
        setRunning(s.running);
      } catch {
        setStates({});
      }
    } catch {
      setError('No se pudo cargar la lista de empresas.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [q, page, assistantId, supervisorId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-3">
      <div>
        <PageHeading hint="Buzón electrónico de cada empresa. Se sincroniza todas las noches a la 1:00 a. m.; también puede sincronizar una empresa a la vez desde su pantalla.">Notificaciones SUNAT</PageHeading>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <form
          className="min-w-[14rem] flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setQ(qInput);
          }}
        >
          <label className="mb-1 block text-xs font-medium text-slate-500">Buscar</label>
          <input value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder="RUC o razón social (mín. 2 caracteres)…" className={`${INPUT_CLS} w-full`} />
        </form>
        <ActivityOwnerFilters
          assistantId={assistantId}
          supervisorId={supervisorId}
          onAssistantChange={(id) => {
            setAssistantId(id);
            setPage(1);
          }}
          onSupervisorChange={(id) => {
            setSupervisorId(id);
            setPage(1);
          }}
        />
        <div className="rounded-lg border border-slate-200 px-4 py-2 text-sm">
          <span className="block text-[10px] font-semibold uppercase text-slate-400">Empresas</span>
          <span className="font-bold text-slate-800">{total}</span>
        </div>
        <button
          type="button"
          aria-pressed={pendientes}
          onClick={() => {
            const next = new URLSearchParams(params);
            if (pendientes) next.delete('pendientes');
            else next.set('pendientes', '1');
            setParams(next, { replace: true });
          }}
          className={`rounded-lg border px-4 py-2 text-sm font-semibold transition-colors ${
            pendientes ? 'border-amber-500 bg-amber-500 text-white' : 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100'
          }`}
        >
          <i className="fas fa-envelope-open-text mr-1.5" aria-hidden />
          Con notificaciones sin leer ({unread?.total ?? 0})
        </button>
      </div>

      {unchecked > 0 ? (
        <Alert variant="warning">
          {unchecked} empresa{unchecked === 1 ? '' : 's'} de su alcance no se pudo revisar en la última sincronización (clave SOL rechazada o error de SUNAT): sus notificaciones no figuran en estos conteos. Corrija la clave en{' '}
          <Link to="/finance/claves-sol" className="font-semibold underline">
            Claves SOL
          </Link>
          .
        </Alert>
      ) : null}

      {pendientes ? (
        <div className="overflow-hidden rounded-xl border border-amber-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-left text-sm">
              <thead>
                <tr className="bg-amber-50 text-xs uppercase text-amber-800">
                  {['Cod', 'Razón social', 'RUC', 'Sin leer', 'Urgentes', 'La más antigua', 'Última sincronización', ''].map((h, i) => (
                    <th key={`${h}-${i}`} className="whitespace-nowrap px-3 py-2.5 font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pending.map((c) => (
                  <tr key={c.company_id} className="border-b border-slate-100 hover:bg-amber-50/40">
                    <td className="px-3 py-2 text-slate-600">{c.code}</td>
                    <td className="max-w-[22rem] truncate px-3 py-2 font-medium text-slate-800" title={c.business_name}>
                      {c.business_name}
                    </td>
                    <td className="px-3 py-2 font-mono text-slate-600">{c.ruc}</td>
                    <td className="px-3 py-2 text-center">
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">{c.unread}</span>
                    </td>
                    <td className="px-3 py-2 text-center">{c.urgent > 0 ? <span className="font-semibold text-red-700">{c.urgent}</span> : '0'}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-600">{c.oldest ? timeAgo(c.oldest) : '—'}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-600">{c.last_sync_at ? timeAgo(c.last_sync_at) : '—'}</td>
                    <td className="px-3 py-2 text-right">
                      <Link
                        to={`/tools/notificaciones-sunat/${c.company_id}?tipo=2&no_leidas=1`}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-700"
                      >
                        <i className="fas fa-envelope-open-text" aria-hidden />
                        Abrir
                      </Link>
                    </td>
                  </tr>
                ))}
                {pending.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-3 py-10 text-center text-slate-500">
                      {unread ? 'No hay notificaciones de SUNAT sin leer en sus empresas.' : 'Cargando…'}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {running ? (
        <Alert variant="info">
          <i className="fas fa-spinner fa-spin mr-1.5" aria-hidden />
          Se está sincronizando una empresa ahora mismo. Las demás sincronizaciones esperan a que termine.
        </Alert>
      ) : null}
      {error ? <Alert variant="error">{error}</Alert> : null}

      <div className={`overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm ${pendientes ? 'hidden' : ''}`}>
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-left text-sm">
            <thead>
              <tr className="bg-slate-50 text-xs uppercase text-slate-500">
                {['Cod', 'Razón social', 'RUC', 'Asistente', 'Estado', 'Notif.', 'Mensajes', 'Notif. sin leer', 'Nuevas', 'Última sincronización', ''].map((h, i) => (
                  <th key={`${h}-${i}`} className="whitespace-nowrap px-3 py-2.5 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className={loading ? 'opacity-60' : undefined}>
              {rows.map((r) => {
                const st = states[String(r.company_id)];
                const badge = buzonBadge(r, st);
                const synced = r.sol_configurado && st && st.status !== 'sin_clave';
                return (
                  <tr key={r.company_id} className="border-b border-slate-100 hover:bg-slate-50/70">
                    <td className="px-3 py-2 text-slate-600">{r.code}</td>
                    <td className="max-w-[20rem] truncate px-3 py-2 font-medium text-slate-800" title={r.business_name}>
                      {r.business_name}
                    </td>
                    <td className="px-3 py-2 font-mono text-slate-600">{r.ruc}</td>
                    <td className="px-3 py-2 text-slate-600">{r.assistant_username || '—'}</td>
                    <td className="px-3 py-2">
                      <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${badge.className}`}>{badge.label}</span>
                    </td>
                    <td className="px-3 py-2 text-center">{synced && st.last_success_at ? st.notificaciones : '—'}</td>
                    <td className="px-3 py-2 text-center">{synced && st.last_success_at ? st.mensajes : '—'}</td>
                    <td className="px-3 py-2 text-center">
                      {synced && st.last_success_at ? (
                        <span className={st.notif_no_leidas > 0 ? 'rounded-full bg-amber-100 px-2 py-0.5 font-bold text-amber-800' : undefined}>{st.notif_no_leidas ?? 0}</span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {synced && st.nuevos > 0 ? <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold text-white">{st.nuevos}</span> : synced && st.last_success_at ? '0' : '—'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-600">
                      {synced && st.last_success_at ? timeAgo(st.last_success_at) : synced && st.last_attempt_at ? `intento ${timeAgo(st.last_attempt_at)}` : '—'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Link
                        to={`/tools/notificaciones-sunat/${r.company_id}${synced && (st?.notif_no_leidas ?? 0) > 0 ? '?tipo=2&no_leidas=1' : ''}`}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-700"
                      >
                        <i className="fas fa-envelope-open-text" aria-hidden />
                        Abrir
                      </Link>
                    </td>
                  </tr>
                );
              })}
              {!loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-3 py-10 text-center text-slate-500">
                    No hay empresas para mostrar.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {totalPages > 1 ? (
          <div className="flex items-center justify-between border-t border-slate-200 px-4 py-2 text-xs text-slate-600">
            <span>
              Página {page} de {totalPages}
            </span>
            <div className="flex gap-2">
              <button type="button" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)} className="rounded-lg border border-slate-300 px-3 py-1 disabled:opacity-50">
                Anterior
              </button>
              <button type="button" disabled={page >= totalPages || loading} onClick={() => setPage((p) => p + 1)} className="rounded-lg border border-slate-300 px-3 py-1 disabled:opacity-50">
                Siguiente
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default BuzonCompanies;
