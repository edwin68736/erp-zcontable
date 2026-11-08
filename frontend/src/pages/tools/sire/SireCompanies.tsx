import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import ActivityOwnerFilters from '../../../components/activity/ActivityOwnerFilters';
import PageHeading from '../../../components/ui/PageHeading';
import { companyAccessCredentialsService, type CompanyAccessCredentialRow } from '../../../services/companyAccessCredentials';
import { INPUT_CLS } from './sireUi';

const PER_PAGE = 20;

/**
 * Herramientas → SIRE: lista de empresas del estudio. Desde cada una se abre su SIRE (ventas y compras) para
 * consultar y descargar la información de SUNAT. Las credenciales de API se generan en Claves SOL (llave y enchufe).
 */
interface Props {
  title?: string;
  subtitle?: string;
  /** Ruta base de la herramienta: cada fila enlaza a `<basePath>/<empresa>`. */
  basePath?: string;
  openLabel?: string;
  openIcon?: string;
}

const SireCompanies = ({
  title = 'SIRE',
  subtitle = 'Elija una empresa para descargar en Excel sus ventas y compras (propuesta del SIRE de SUNAT) de un período.',
  basePath = '/tools/sire',
  openLabel = 'Abrir SIRE',
  openIcon = 'fas fa-file-invoice',
}: Props) => {
  const [q, setQ] = useState('');
  const [qInput, setQInput] = useState('');
  const [page, setPage] = useState(1);
  const [assistantId, setAssistantId] = useState<number | null>(null);
  const [supervisorId, setSupervisorId] = useState<number | null>(null);
  const [rows, setRows] = useState<CompanyAccessCredentialRow[]>([]);
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
      setRows(res.data ?? []);
      setTotal(res.total);
      setTotalPages(res.total_pages || 1);
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
        <PageHeading hint={subtitle}>{title}</PageHeading>
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

      {error ? <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p> : null}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-left text-sm">
            <thead>
              <tr className="bg-slate-50 text-xs uppercase text-slate-500">
                {['Cod', 'Razón social', 'RUC', 'Asistente', 'Supervisor', ''].map((h, i) => (
                  <th key={`${h}-${i}`} className="px-3 py-2.5 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className={loading ? 'opacity-60' : undefined}>
              {rows.map((r) => {
                return (
                  <tr key={r.company_id} className="border-b border-slate-100 hover:bg-slate-50/70">
                    <td className="px-3 py-2 text-slate-600">{r.code}</td>
                    <td className="max-w-[22rem] truncate px-3 py-2 font-medium text-slate-800" title={r.business_name}>
                      {r.business_name}
                    </td>
                    <td className="px-3 py-2 font-mono text-slate-600">{r.ruc}</td>
                    <td className="px-3 py-2 text-slate-600">{r.assistant_username || '—'}</td>
                    <td className="px-3 py-2 text-slate-600">{r.supervisor_username || '—'}</td>
                    <td className="px-3 py-2 text-right">
                      <Link
                        to={`${basePath}/${r.company_id}`}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-700"
                      >
                        <i className={openIcon} aria-hidden />
                        {openLabel}
                      </Link>
                    </td>
                  </tr>
                );
              })}
              {!loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-10 text-center text-slate-500">
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

export default SireCompanies;
