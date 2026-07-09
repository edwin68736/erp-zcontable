import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { companiesService } from '../services/companies';
import type { Company } from '../types/dashboard';
import { auth } from '../services/auth';
import { P } from '../rbac/codes';
import Pagination from '../components/Pagination';
import { PAGE_WORKSPACE_CLASS } from '../constants/pageLayout';

function parsePositiveInt(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.trunc(n);
  return i <= 0 ? fallback : i;
}

const ExternalClients = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const searchKey = searchParams.toString();
  const [items, setItems] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState(() => searchParams.get('q') ?? '');
  const [pagination, setPagination] = useState({
    page: 1,
    per_page: 20,
    total: 0,
    total_pages: 0,
  });

  const canView = auth.hasPermission(P.companiesExternalView) || auth.hasPermission(P.accessStudio);
  const canConvert = auth.hasPermission(P.companiesConvertToStudio) || auth.hasPermission(P.companiesUpdate);

  const reload = useCallback(async () => {
    const sp = new URLSearchParams(searchKey);
    const q = (sp.get('q') ?? '').trim();
    try {
      setLoading(true);
      const res = await companiesService.listPaged({
        client_type: 'externo',
        q: q || undefined,
        status: sp.get('status') || undefined,
        page: parsePositiveInt(sp.get('page'), 1),
        per_page: parsePositiveInt(sp.get('per_page'), 20),
      });
      setItems(res.items);
      setPagination(res.pagination);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [searchKey]);

  useEffect(() => {
    if (!canView) return;
    void reload();
  }, [canView, reload]);

  const pushFilters = useMemo(
    () => (patch: Record<string, string | undefined>) => {
      const sp = new URLSearchParams(searchParams);
      for (const [k, v] of Object.entries(patch)) {
        if (v == null || v === '') sp.delete(k);
        else sp.set(k, v);
      }
      setSearchParams(sp, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  if (!canView) {
    return (
      <div className={PAGE_WORKSPACE_CLASS}>
        <p className="text-slate-600">No tiene permiso para ver clientes externos.</p>
      </div>
    );
  }

  return (
    <div className={PAGE_WORKSPACE_CLASS}>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Clientes externos (POS)</h1>
          <p className="text-sm text-slate-600 mt-1">
            Registrados desde ventas rápidas. No llevan contabilidad hasta convertirlos en cliente del estudio.
          </p>
        </div>
        <Link
          to="/pos"
          className="inline-flex items-center justify-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <i className="fas fa-cash-register text-xs" />
          Ir a POS
        </Link>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 mb-4 flex flex-wrap gap-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') pushFilters({ q: query.trim(), page: '1' });
          }}
          placeholder="Buscar por nombre, RUC/DNI o código…"
          className="flex-1 min-w-[200px] border border-slate-300 rounded-lg px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={() => pushFilters({ q: query.trim(), page: '1' })}
          className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
        >
          Buscar
        </button>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        {loading ? (
          <p className="p-8 text-center text-sm text-slate-500">Cargando…</p>
        ) : items.length === 0 ? (
          <p className="p-8 text-center text-sm text-slate-500">No hay clientes externos registrados.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="text-left px-4 py-3">Código</th>
                  <th className="text-left px-4 py-3">Documento</th>
                  <th className="text-left px-4 py-3">Nombre</th>
                  <th className="text-left px-4 py-3">Estado</th>
                  <th className="text-right px-4 py-3">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((c) => (
                  <tr key={c.id}>
                    <td className="px-4 py-3 font-mono text-xs">{c.code}</td>
                    <td className="px-4 py-3 font-mono">{c.ruc}</td>
                    <td className="px-4 py-3 font-medium">{c.business_name}</td>
                    <td className="px-4 py-3 capitalize">{c.status}</td>
                    <td className="px-4 py-3 text-right">
                      {canConvert ? (
                        <Link
                          to={`/companies/${c.id}/edit?convert=1`}
                          className="inline-flex items-center gap-1 rounded-full border border-primary-200 bg-primary-50 px-3 py-1.5 text-xs font-medium text-primary-800 hover:bg-primary-100"
                        >
                          <i className="fas fa-building text-[10px]" />
                          Convertir en cliente del estudio
                        </Link>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {pagination.total > 0 ? (
        <div className="mt-4">
          <Pagination
            page={pagination.page}
            perPage={pagination.per_page}
            total={pagination.total}
            onPageChange={(p) => pushFilters({ page: String(p) })}
            onPerPageChange={(n) => pushFilters({ per_page: String(n), page: '1' })}
          />
        </div>
      ) : null}
    </div>
  );
};

export default ExternalClients;
