import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { auth } from '../../services/auth';
import { P } from '../../rbac/codes';
import Pagination from '../../components/Pagination';
import CompanyDigitoFilter from '../../components/finance/CompanyDigitoFilter';
import { PAGE_WORKSPACE_CLASS } from '../../constants/pageLayout';
import {
  companyAccessCredentialsService,
  type CompanyAccessCredentialRow,
} from '../../services/companyAccessCredentials';
import {
  supervisorTaxSettlementsService,
  type SupervisorCompanyLiquidationDraft,
} from '../../services/supervisorTaxSettlements';
import { extractApiErrorMessage } from '../../utils/apiError';
import {
  defaultLiquidationPeriodYM,
  isValidLiquidationPeriodYM,
  settlementStatusBadgeClass,
  settlementStatusLabel,
} from '../../utils/liquidationPeriod';

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

const SupervisorLiquidacionesListPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const canView = useMemo(() => auth.hasPermission(P.supervisorsLiquidationsView), []);
  const canCreate = useMemo(() => auth.hasPermission(P.supervisorsLiquidationsCreate), []);
  const canUpdate = useMemo(() => auth.hasPermission(P.supervisorsLiquidationsUpdate), []);

  const selectedPeriod = useMemo(() => {
    const raw = (searchParams.get('period') ?? '').trim();
    return isValidLiquidationPeriodYM(raw) ? raw : defaultLiquidationPeriodYM();
  }, [searchParams]);

  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(20);
  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q, 400);
  const [filterDig, setFilterDig] = useState<string | null>(null);
  const [digColorsJson, setDigColorsJson] = useState<string | null>(null);
  const [facetsLoading, setFacetsLoading] = useState(true);
  const [rows, setRows] = useState<CompanyAccessCredentialRow[]>([]);
  const [settlementsByCompany, setSettlementsByCompany] = useState<
    Record<number, SupervisorCompanyLiquidationDraft>
  >({});
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const setSelectedPeriod = (periodYm: string) => {
    const next = isValidLiquidationPeriodYM(periodYm) ? periodYm : defaultLiquidationPeriodYM();
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        params.set('period', next);
        return params;
      },
      { replace: true },
    );
  };

  const loadFacets = useCallback(async () => {
    if (!canView) return;
    try {
      setFacetsLoading(true);
      const data = await companyAccessCredentialsService.filterFacets();
      setDigColorsJson(data.claves_sol_dig_colors_json ?? null);
    } catch {
      setDigColorsJson(null);
    } finally {
      setFacetsLoading(false);
    }
  }, [canView]);

  const load = useCallback(async () => {
    if (!canView) return;
    const term = debouncedQ.trim();
    try {
      setLoading(true);
      setError('');
      const res = await companyAccessCredentialsService.list({
        q: term.length >= 2 ? term : undefined,
        page,
        per_page: perPage,
        dig: filterDig ?? undefined,
      });
      setRows(res.data ?? []);
      setTotal(res.total ?? 0);
      const ids = (res.data ?? []).map((r) => r.company_id).filter((id) => id > 0);
      const settlements =
        ids.length > 0 ? await supervisorTaxSettlementsService.draftsByCompanies(ids, selectedPeriod) : {};
      setSettlementsByCompany(settlements);
    } catch (err) {
      console.error(err);
      setError(extractApiErrorMessage(err, 'No se pudo cargar el listado de empresas.'));
      setRows([]);
      setTotal(0);
      setSettlementsByCompany({});
    } finally {
      setLoading(false);
    }
  }, [canView, debouncedQ, page, perPage, filterDig, selectedPeriod]);

  useEffect(() => {
    void loadFacets();
  }, [loadFacets]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [debouncedQ, filterDig, selectedPeriod]);

  const listBackQuery = `?period=${encodeURIComponent(selectedPeriod)}`;

  if (!canView) {
    return (
      <div className={PAGE_WORKSPACE_CLASS}>
        <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Liquidaciones</h1>
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-sm">
          No tiene permiso para consultar liquidaciones de supervisores.
        </div>
      </div>
    );
  }

  return (
    <div className={PAGE_WORKSPACE_CLASS}>
      <div>
        <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Liquidaciones</h1>
        <p className="text-slate-500 mt-1 text-sm max-w-3xl leading-relaxed">
          Inicie liquidaciones por empresa y periodo mensual (AAAA-MM). Por defecto se muestra el mes calendario
          anterior. Si ya existe liquidación en borrador puede editarla; si fue emitida solo podrá visualizarla. En
          periodos sin liquidación puede crear una nueva.
        </p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-sm space-y-3">
        <CompanyDigitoFilter
          filterDig={filterDig}
          onFilterDigChange={(dig) => {
            setFilterDig(dig);
            setPage(1);
          }}
          digColorsJson={digColorsJson}
          loading={facetsLoading}
        />
        <div className="flex flex-wrap items-end gap-3 pt-1 border-t border-slate-100">
          <div className="min-w-[10rem]">
            <label className="block text-xs font-medium text-slate-500 mb-1" htmlFor="sup-liq-list-period">
              Periodo de liquidación
            </label>
            <input
              id="sup-liq-list-period"
              type="month"
              value={selectedPeriod}
              onChange={(e) => setSelectedPeriod(e.target.value || defaultLiquidationPeriodYM())}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs font-medium text-slate-500 mb-1" htmlFor="sup-liq-q">
            Buscar empresa
          </label>
          <input
            id="sup-liq-q"
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm outline-none focus:ring-2 focus:ring-primary-500"
            placeholder="RUC, razón social o código (mín. 2 caracteres)…"
          />
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2 shrink-0 min-w-[9rem]">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Empresas</p>
          <p className="text-lg font-semibold text-slate-800 tabular-nums leading-tight">{loading ? '—' : total}</p>
        </div>
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
                <th className={TH}>Razón social</th>
                <th className={TH}>RUC</th>
                <th className={TH}>Asistente</th>
                <th className={TH}>Liquidación</th>
                {canCreate || canUpdate || canView ? <th className={`${TH} text-right`}>Acciones</th> : null}
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={canCreate || canUpdate || canView ? 6 : 5} className="px-4 py-8 text-center text-slate-500 text-sm">
                    <i className="fas fa-spinner fa-spin mr-2" aria-hidden />
                    Cargando…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={canCreate || canUpdate || canView ? 6 : 5} className="px-4 py-8 text-center text-slate-500 text-sm">
                    No hay empresas para mostrar.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.company_id} className="hover:bg-slate-50/80">
                    <td className={`${TD} font-mono`}>{row.code || '—'}</td>
                    <td className={`${TD} max-w-[16rem] font-medium`} title={row.business_name}>
                      <span className="block truncate">{row.business_name || '—'}</span>
                    </td>
                    <td className={`${TD} font-mono whitespace-nowrap`}>{row.ruc || '—'}</td>
                    <td className={TD}>{row.assistant_username || '—'}</td>
                    <td className={TD}>
                      {(() => {
                        const settlement = settlementsByCompany[row.company_id];
                        if (!settlement?.settlement_id) {
                          return <span className="text-xs text-slate-400">Sin liquidación</span>;
                        }
                        return (
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-md border text-[11px] font-medium ${settlementStatusBadgeClass(settlement.status)}`}
                          >
                            {settlementStatusLabel(settlement.status)}
                          </span>
                        );
                      })()}
                    </td>
                    {canCreate || canUpdate || canView ? (
                      <td className={`${TD} text-right`}>
                        {(() => {
                          const settlement = settlementsByCompany[row.company_id];
                          if (settlement?.settlement_id) {
                            if (settlement.status === 'borrador' && canUpdate) {
                              return (
                                <Link
                                  to={`/supervisors/liquidaciones/editar/${settlement.settlement_id}${listBackQuery}`}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-amber-900 bg-amber-50 border border-amber-200 hover:bg-amber-100"
                                  title={`Editar liquidación del periodo ${selectedPeriod}`}
                                >
                                  <i className="fas fa-pen text-[10px]" aria-hidden />
                                  Editar liquidación
                                </Link>
                              );
                            }
                            if (settlement.status !== 'borrador' && canView) {
                              return (
                                <Link
                                  to={`/supervisors/liquidaciones/ver/${settlement.settlement_id}${listBackQuery}`}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-800 bg-slate-50 border border-slate-200 hover:bg-slate-100"
                                  title={`Ver liquidación emitida del periodo ${selectedPeriod}`}
                                >
                                  <i className="fas fa-eye text-[10px]" aria-hidden />
                                  Ver liquidación
                                </Link>
                              );
                            }
                            return <span className="text-xs text-slate-400">—</span>;
                          }
                          if (canCreate) {
                            return (
                              <Link
                                to={`/supervisors/liquidaciones/crear/${row.company_id}?period=${encodeURIComponent(selectedPeriod)}`}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-primary-800 bg-primary-50 border border-primary-200 hover:bg-primary-100"
                              >
                                <i className="fas fa-plus text-[10px]" aria-hidden />
                                Crear liquidación
                              </Link>
                            );
                          }
                          return <span className="text-xs text-slate-400">—</span>;
                        })()}
                      </td>
                    ) : null}
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

export default SupervisorLiquidacionesListPage;
