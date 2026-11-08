import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import ActivityOwnerFilters from '../../../components/activity/ActivityOwnerFilters';
import PageHeading from '../../../components/ui/PageHeading';
import { companyAccessCredentialsService, type CompanyAccessCredentialRow } from '../../../services/companyAccessCredentials';
import { sunatBuzonService, type BuzonSync } from '../../../services/sunatBuzon';
import { INPUT_CLS } from '../sire/sireUi';
import { buzonBadge, timeAgo } from './buzonUi';

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

      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
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
      </div>

      {running ? (
        <p className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900" role="status">
          <i className="fas fa-spinner fa-spin mr-1.5" aria-hidden />
          Se está sincronizando una empresa ahora mismo. Las demás sincronizaciones esperan a que termine.
        </p>
      ) : null}
      {error ? <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p> : null}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-left text-sm">
            <thead>
              <tr className="bg-blue-900 text-xs uppercase text-white">
                {['Cod', 'Razón social', 'RUC', 'Asistente', 'Estado', 'Notif.', 'Mensajes', 'No leídas', 'Nuevas', 'Última sincronización', ''].map((h, i) => (
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
                        <span className={st.no_leidas > 0 ? 'font-semibold text-amber-700' : undefined}>{st.no_leidas}</span>
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
                        to={`/tools/notificaciones-sunat/${r.company_id}`}
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
