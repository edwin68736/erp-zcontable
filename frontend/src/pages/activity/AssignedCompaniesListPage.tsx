/**
 * Lista de empresas asignadas (Supervisores / Asistente) — solo lectura.
 *
 * Technical Debt:
 * La pantalla Empresas pertenece al dominio Supervisores/Asistente, pero reutiliza
 * temporalmente GET /api/finance/company-credentials (lectura global para usuarios autenticados)
 * Asistente con alcance por AccessService.
 * En una futura fase podría migrarse a un endpoint específico del dominio
 * Supervisores/Asistente (p. ej. GET /api/supervisors/companies).
 */
import { useCallback, useEffect, useState } from 'react';
import Pagination from '../../components/Pagination';
import { PAGE_WORKSPACE_CLASS } from '../../constants/pageLayout';
import {
  companyAccessCredentialsService,
  type CompanyAccessCredentialRow,
} from '../../services/companyAccessCredentials';
import { extractApiErrorMessage } from '../../utils/apiError';
import type { ActivityWorkspace } from '../../navigation/activityRoutes';

function useDebouncedValue<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

const TH = 'px-4 py-3 text-left text-xs font-semibold uppercase text-slate-500';
const TD = 'px-4 py-3 text-sm text-slate-700 border-t border-slate-100';

type AssignedCompaniesListPageProps = {
  workspace: ActivityWorkspace;
};

const AssignedCompaniesListPage = ({ workspace }: AssignedCompaniesListPageProps) => {
  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q, 400);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(20);
  const [rows, setRows] = useState<CompanyAccessCredentialRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const subtitle =
    workspace === 'assistant'
      ? 'Empresas asignadas a su alcance operativo.'
      : 'Empresas asignadas dentro de su alcance de supervisión.';

  const load = useCallback(async () => {
    const term = debouncedQ.trim();
    try {
      setLoading(true);
      setError('');
      const res = await companyAccessCredentialsService.list({
        q: term.length >= 2 ? term : undefined,
        page,
        per_page: perPage,
      });
      setRows(res.data ?? []);
      setTotal(res.total ?? 0);
    } catch (err) {
      console.error(err);
      setError(extractApiErrorMessage(err, 'No se pudo cargar el listado de empresas.'));
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [debouncedQ, page, perPage]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [debouncedQ]);

  return (
    <div className={PAGE_WORKSPACE_CLASS}>
      <div>
        <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Empresas</h1>
        <p className="text-slate-500 mt-1 text-sm">{subtitle}</p>
      </div>

      <div className="flex flex-wrap items-end gap-3 bg-white rounded-xl border border-slate-200 p-3 shadow-sm">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs font-medium text-slate-500 mb-1" htmlFor="assigned-companies-q">
            Buscar
          </label>
          <input
            id="assigned-companies-q"
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm outline-none focus:ring-2 focus:ring-primary-500"
            placeholder="RUC, razón social o código (mín. 2 caracteres)…"
          />
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2 shrink-0 min-w-[9rem]">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Total</p>
          <p className="text-lg font-semibold text-slate-800 tabular-nums leading-tight">{loading ? '—' : total}</p>
        </div>
      </div>

      {error ? (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">{error}</div>
      ) : null}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full w-full text-left">
            <thead className="bg-slate-50">
              <tr>
                <th className={TH}>Código</th>
                <th className={TH}>Dígito</th>
                <th className={TH}>Razón social</th>
                <th className={TH}>RUC</th>
                <th className={TH}>Asistente</th>
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500 text-sm">
                    <i className="fas fa-spinner fa-spin mr-2" aria-hidden />
                    Cargando…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500 text-sm">
                    No hay empresas para mostrar.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.company_id} className="hover:bg-slate-50/80">
                    <td className={`${TD} font-mono`}>{row.code || '—'}</td>
                    <td className={TD}>{row.dig || '—'}</td>
                    <td className={`${TD} max-w-[16rem] font-medium`} title={row.business_name}>
                      <span className="block truncate">{row.business_name || '—'}</span>
                    </td>
                    <td className={`${TD} font-mono whitespace-nowrap`}>{row.ruc || '—'}</td>
                    <td className={TD}>{row.assistant_username || '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Pagination
        page={page}
        perPage={perPage}
        total={total}
        onPageChange={setPage}
        onPerPageChange={(next) => {
          setPerPage(next);
          setPage(1);
        }}
      />
    </div>
  );
};

export default AssignedCompaniesListPage;
