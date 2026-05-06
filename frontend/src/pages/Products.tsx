import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { productsService, type Product, type TukifacSellnowItem } from '../services/products';
import { auth } from '../services/auth';
import Pagination from '../components/Pagination';

function parsePositiveInt(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.trunc(n);
  if (i <= 0) return fallback;
  return i;
}

type TabKey = 'system' | 'tukifac';

function formatStock(v: string | number | undefined): string {
  if (v === undefined || v === null) return '—';
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  const s = String(v).trim();
  return s === '' ? '—' : s;
}

const Products = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const role = auth.getRole() ?? '';
  const canUpsert = ['Administrador', 'Supervisor', 'Contador'].includes(role);
  const canDelete = role === 'Administrador' || role === 'Supervisor';
  const canViewTukifac = ['Administrador', 'Supervisor', 'Contador', 'Asistente'].includes(role);

  const [tab, setTab] = useState<TabKey>('system');

  const initialQuery = searchParams.get('q') ?? '';
  const initialKind = searchParams.get('kind') ?? '';
  const initialActive = searchParams.get('active') ?? '';
  const initialPage = parsePositiveInt(searchParams.get('page'), 1);
  const initialPerPage = parsePositiveInt(searchParams.get('per_page'), 20);

  const [query, setQuery] = useState(initialQuery);
  const [kind, setKind] = useState(initialKind);
  const [active, setActive] = useState(initialActive);
  const [items, setItems] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({
    page: initialPage,
    per_page: initialPerPage,
    total: 0,
    total_pages: 0,
  });
  const [syncing, setSyncing] = useState(false);

  const [tukifacItems, setTukifacItems] = useState<TukifacSellnowItem[]>([]);
  const [tukifacLoading, setTukifacLoading] = useState(false);
  const [tukifacError, setTukifacError] = useState('');

  useEffect(() => {
    setQuery(initialQuery);
    setKind(initialKind);
    setActive(initialActive);
  }, [initialQuery, initialKind, initialActive]);

  const loadSystem = useCallback(async () => {
    try {
      setLoading(true);
      const res = await productsService.listPaged({
        q: initialQuery || undefined,
        kind: initialKind || undefined,
        active: initialActive || undefined,
        page: initialPage,
        per_page: initialPerPage,
      });
      setItems(res.items);
      setPagination(res.pagination);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [initialQuery, initialKind, initialActive, initialPage, initialPerPage]);

  useEffect(() => {
    if (tab !== 'system') return;
    void loadSystem();
  }, [tab, loadSystem]);

  const loadTukifac = useCallback(async () => {
    if (!canViewTukifac) return;
    setTukifacError('');
    setTukifacLoading(true);
    try {
      const list = await productsService.listTukifacSellnow();
      setTukifacItems(list);
    } catch {
      setTukifacError('No se pudo cargar el catálogo Tukifac. Revise URL y token en configuración.');
      setTukifacItems([]);
    } finally {
      setTukifacLoading(false);
    }
  }, [canViewTukifac]);

  useEffect(() => {
    if (tab !== 'tukifac') return;
    void loadTukifac();
  }, [tab, loadTukifac]);

  const handleFilterSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (query) next.set('q', query);
      else next.delete('q');
      if (kind) next.set('kind', kind);
      else next.delete('kind');
      if (active) next.set('active', active);
      else next.delete('active');
      next.set('page', '1');
      if (next.get('per_page') == null) next.set('per_page', String(initialPerPage));
      return next;
    });
  };

  const handlePageChange = (nextPage: number) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('page', String(nextPage));
      if (next.get('per_page') == null) next.set('per_page', String(initialPerPage));
      return next;
    });
  };

  const handlePerPageChange = (nextPerPage: number) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('per_page', String(nextPerPage));
      next.set('page', '1');
      return next;
    });
  };

  const runSync = async () => {
    if (!canUpsert) return;
    try {
      setSyncing(true);
      const r = await productsService.syncTukifac();
      window.dispatchEvent(
        new CustomEvent('miweb:toast', {
          detail: {
            type: 'success',
            message: `Sincronización: ${r.created} nuevo(s), ${r.updated} actualizado(s).`,
          },
        }),
      );
      await loadSystem();
    } catch {
      window.dispatchEvent(
        new CustomEvent('miweb:toast', { detail: { type: 'error', message: 'Error al sincronizar con Tukifac' } }),
      );
    } finally {
      setSyncing(false);
    }
  };

  const handleDelete = async (p: Product) => {
    if (!canDelete) return;
    if (!confirm(`¿Eliminar «${p.description}»?`)) return;
    try {
      await productsService.remove(p.id);
      window.dispatchEvent(
        new CustomEvent('miweb:toast', { detail: { type: 'success', message: 'Ítem eliminado.' } }),
      );
      void loadSystem();
    } catch {
      window.dispatchEvent(
        new CustomEvent('miweb:toast', { detail: { type: 'error', message: 'No se pudo eliminar' } }),
      );
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-800">Productos y servicios</h2>
          <p className="text-sm text-slate-500">
            Gestión local con campos SUNAT; importación desde Tukifac sin enviar cambios al facturador.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canUpsert ? (
            <Link
              to="/products/new"
              className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-full bg-primary-600 text-white text-sm font-medium"
            >
              <i className="fas fa-plus text-xs"></i> Nuevo ítem
            </Link>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-1">
        <button
          type="button"
          onClick={() => setTab('system')}
          className={`px-4 py-2 rounded-full text-sm font-medium transition ${
            tab === 'system' ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          En el sistema
        </button>
        <button
          type="button"
          onClick={() => setTab('tukifac')}
          className={`px-4 py-2 rounded-full text-sm font-medium transition ${
            tab === 'tukifac' ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          Catálogo Tukifac
        </button>
      </div>

      {tab === 'system' ? (
        <>
          <form
            onSubmit={handleFilterSubmit}
            className="flex flex-wrap items-end gap-3 bg-white rounded-xl border border-slate-200 p-4 shadow-sm"
          >
            <div className="flex-1 min-w-[180px]">
              <label className="block text-xs font-medium text-slate-500 mb-1">Buscar</label>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                placeholder="Descripción, barras, código interno…"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Tipo</label>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value)}
                className="px-3 py-2 rounded-lg border border-slate-300 text-sm min-w-[140px]"
              >
                <option value="">Todos</option>
                <option value="service">Servicio</option>
                <option value="product">Producto</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Activo</label>
              <select
                value={active}
                onChange={(e) => setActive(e.target.value)}
                className="px-3 py-2 rounded-lg border border-slate-300 text-sm min-w-[120px]"
              >
                <option value="">Todos</option>
                <option value="1">Sí</option>
                <option value="0">No</option>
              </select>
            </div>
            <button
              type="submit"
              className="inline-flex items-center px-4 py-2 rounded-full bg-slate-800 text-white text-sm font-medium"
            >
              <i className="fas fa-search mr-2 text-xs"></i> Filtrar
            </button>
            {canUpsert ? (
              <button
                type="button"
                disabled={syncing}
                onClick={() => void runSync()}
                className="inline-flex items-center px-4 py-2 rounded-full border border-emerald-300 text-emerald-800 text-sm font-medium hover:bg-emerald-50 disabled:opacity-60"
              >
                <i className={`fas fa-cloud-download-alt mr-2 text-xs ${syncing ? 'fa-spin' : ''}`}></i>
                {syncing ? 'Sincronizando…' : 'Sincronizar desde Tukifac'}
              </button>
            ) : null}
          </form>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm text-left">
                <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Tipo</th>
                    <th className="px-4 py-3">Descripción</th>
                    <th className="px-4 py-3">Categoría</th>
                    <th className="px-4 py-3">Unidad</th>
                    <th className="px-4 py-3">Precio</th>
                    <th className="px-4 py-3">Origen</th>
                    <th className="px-4 py-3">Activo</th>
                    <th className="px-4 py-3 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loading ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-6 text-center text-slate-500">
                        <i className="fas fa-spinner fa-spin mr-2"></i> Cargando…
                      </td>
                    </tr>
                  ) : items.length ? (
                    items.map((p) => (
                      <tr key={p.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium border ${
                              p.product_kind === 'service'
                                ? 'bg-violet-50 text-violet-800 border-violet-200'
                                : 'bg-sky-50 text-sky-800 border-sky-200'
                            }`}
                          >
                            {p.product_kind === 'service' ? 'Servicio' : 'Producto'}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-800 max-w-[280px]">
                          <span className="line-clamp-2">{p.description}</span>
                          {p.barcode ? (
                            <div className="text-xs font-mono text-slate-500 mt-0.5">{p.barcode}</div>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-slate-600 text-xs">{p.product_category?.name ?? '—'}</td>
                        <td className="px-4 py-3 font-mono text-xs">{p.unit_type_id || '—'}</td>
                        <td className="px-4 py-3">
                          <div className="font-semibold text-slate-800">
                            {p.currency_type_symbol || ''} {Number(p.price ?? 0).toFixed(2)}
                          </div>
                          {p.sale_unit_price ? (
                            <div className="text-xs text-slate-500">{p.sale_unit_price}</div>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {p.tukifac_item_id ? (
                            <span className="text-emerald-700 font-medium">Tukifac #{p.tukifac_item_id}</span>
                          ) : (
                            <span className="text-slate-500">Local</span>
                          )}
                        </td>
                        <td className="px-4 py-3">{p.active ? 'Sí' : 'No'}</td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex justify-end gap-1.5">
                            {canUpsert ? (
                              <Link
                                to={`/products/${p.id}/edit`}
                                title="Editar"
                                aria-label="Editar"
                                className="inline-flex items-center justify-center w-9 h-9 rounded-full border border-amber-300 text-amber-700 hover:bg-amber-50 transition-colors"
                              >
                                <i className="fas fa-pen text-xs" aria-hidden="true"></i>
                              </Link>
                            ) : null}
                            {canDelete ? (
                              <button
                                type="button"
                                title="Eliminar"
                                aria-label="Eliminar"
                                onClick={() => void handleDelete(p)}
                                className="inline-flex items-center justify-center w-9 h-9 rounded-full border border-red-200 text-red-700 hover:bg-red-50 transition-colors"
                              >
                                <i className="fas fa-trash text-xs" aria-hidden="true"></i>
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={8} className="px-4 py-6 text-center text-slate-500">
                        No hay ítems. Cree uno local o sincronice desde Tukifac.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="px-4 sm:px-6 py-4 border-t border-slate-100">
              <Pagination
                page={pagination.page || initialPage}
                perPage={pagination.per_page || initialPerPage}
                total={pagination.total ?? 0}
                onPageChange={handlePageChange}
                onPerPageChange={handlePerPageChange}
              />
            </div>
          </div>
        </>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-950">
            <p>
              Vista previa directa de <code className="font-mono text-xs bg-white/60 px-1 rounded">/api/sellnow/items</code>
              . Lista completa sin paginación; use desplazamiento.
            </p>
            {canViewTukifac ? (
              <button
                type="button"
                onClick={() => void loadTukifac()}
                className="shrink-0 px-3 py-1.5 rounded-full border border-amber-400 text-xs font-medium hover:bg-white/60"
              >
                Actualizar vista
              </button>
            ) : null}
          </div>

          {tukifacError ? <div className="text-sm text-red-600">{tukifacError}</div> : null}

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm max-h-[min(70vh,720px)] overflow-auto">
            <table className="min-w-full text-sm text-left">
              <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-500 sticky top-0 z-10">
                <tr>
                  <th className="px-4 py-3">ID</th>
                  <th className="px-4 py-3">Descripción</th>
                  <th className="px-4 py-3">Unidad</th>
                  <th className="px-4 py-3">Stock</th>
                  <th className="px-4 py-3">Precio</th>
                  <th className="px-4 py-3">IGV</th>
                  <th className="px-4 py-3">Imagen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {tukifacLoading ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-slate-500">
                      <i className="fas fa-spinner fa-spin mr-2"></i> Cargando Tukifac…
                    </td>
                  </tr>
                ) : tukifacItems.length ? (
                  tukifacItems.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-mono text-xs">{row.id}</td>
                      <td className="px-4 py-3 font-medium text-slate-800 max-w-xs">
                        <span className="line-clamp-2">{row.description ?? '—'}</span>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{row.unit_type_id ?? '—'}</td>
                      <td className="px-4 py-3 font-mono text-xs">{formatStock(row.stock)}</td>
                      <td className="px-4 py-3">
                        <div className="font-semibold">{row.sale_unit_price ?? row.price ?? '—'}</div>
                      </td>
                      <td className="px-4 py-3 text-xs font-mono">{row.sale_affectation_igv_type_id ?? '—'}</td>
                      <td className="px-4 py-3">
                        {row.image_url ? (
                          <a href={row.image_url} target="_blank" rel="noreferrer" className="inline-block">
                            <img
                              src={row.image_url}
                              alt=""
                              className="h-10 w-10 rounded object-cover border border-slate-200"
                            />
                          </a>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-slate-500">
                      {tukifacError ? '—' : 'Sin datos.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {canUpsert ? (
            <p className="text-sm text-slate-600">
              Para guardar estos ítems en su base local, use{' '}
              <button
                type="button"
                className="text-primary-700 font-medium underline"
                onClick={() => {
                  setTab('system');
                  void runSync();
                }}
              >
                Sincronizar desde Tukifac
              </button>{' '}
              en la pestaña «En el sistema».
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
};

export default Products;
