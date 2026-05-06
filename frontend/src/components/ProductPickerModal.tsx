import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { productsService, type Product } from '../services/products';

export function productLabel(p: Product): string {
  const n = p.name?.trim();
  if (n) return n;
  return p.description?.trim() || `Ítem #${p.id}`;
}

export function productUnitPrice(p: Product): number {
  const fromSale = Number(String(p.sale_unit_price ?? '').replace(',', '.'));
  if (Number.isFinite(fromSale) && fromSale > 0) return fromSale;
  if (Number.isFinite(p.price) && p.price > 0) return p.price;
  return 0;
}

type ProductPickerModalProps = {
  open: boolean;
  onClose: () => void;
  /** Se llama al elegir un producto (el modal no se cierra solo; el padre puede cerrarlo). */
  onPick: (p: Product) => void;
  title?: string;
};

const ProductPickerModal = ({ open, onClose, onPick, title = 'Catálogo de productos y servicios' }: ProductPickerModalProps) => {
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<'all' | 'service' | 'product'>('all');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<Product[]>([]);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setQ(qInput.trim()), 350);
    return () => window.clearTimeout(t);
  }, [qInput]);

  useEffect(() => {
    if (open) {
      setPage(1);
      setQInput('');
      setQ('');
    }
  }, [open]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await productsService.listPaged({
        q: q || undefined,
        kind: kind === 'all' ? undefined : kind,
        active: '1',
        page,
        per_page: 12,
      });
      setItems(res.items);
      setTotalPages(res.pagination.total_pages || 0);
    } catch {
      setItems([]);
      setTotalPages(0);
    } finally {
      setLoading(false);
    }
  }, [q, kind, page]);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  useEffect(() => {
    if (open) setPage(1);
  }, [q, kind, open]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <button type="button" className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} aria-label="Cerrar" />
      <div className="relative w-full max-w-lg bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl border border-slate-200 flex flex-col max-h-[min(90vh,640px)]">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 shrink-0">
          <h3 className="text-base font-semibold text-slate-800">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center justify-center w-9 h-9 rounded-full border border-slate-200 text-slate-500 hover:bg-slate-50"
            aria-label="Cerrar"
          >
            <i className="fas fa-times text-xs" />
          </button>
        </div>

        <div className="px-4 py-3 border-b border-slate-50 space-y-2 shrink-0">
          <input
            type="search"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            placeholder="Buscar por nombre o descripción…"
            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500 outline-none"
          />
          <div className="flex flex-wrap gap-2">
            {(
              [
                { id: 'all' as const, label: 'Todos' },
                { id: 'service' as const, label: 'Servicios' },
                { id: 'product' as const, label: 'Productos' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setKind(opt.id)}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition ${
                  kind === opt.id
                    ? 'bg-primary-600 text-white border-primary-600'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0 px-2 py-2">
          {loading ? (
            <div className="py-12 text-center text-sm text-slate-500">
              <i className="fas fa-spinner fa-spin mr-2" />
              Cargando…
            </div>
          ) : items.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-500">No hay resultados. Ajuste la búsqueda o cree ítems en el módulo Productos.</div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {items.map((p) => {
                const price = productUnitPrice(p);
                const kindLabel = p.product_kind === 'service' ? 'Servicio' : 'Producto';
                return (
                  <li key={p.id} className="flex items-start gap-3 px-2 py-3 hover:bg-slate-50/80 rounded-lg">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-slate-900 truncate">{productLabel(p)}</span>
                        <span className="text-[10px] uppercase font-semibold text-slate-500 border border-slate-200 rounded px-1.5 py-0.5 shrink-0">
                          {kindLabel}
                        </span>
                      </div>
                      {p.description?.trim() && p.description.trim() !== productLabel(p) ? (
                        <p className="text-xs text-slate-500 mt-1 line-clamp-2">{p.description.trim()}</p>
                      ) : null}
                      <p className="text-sm font-semibold text-primary-800 mt-1 tabular-nums">
                        S/ {price.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onPick(p)}
                      className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-primary-600 text-white hover:bg-primary-700 shadow-sm"
                    >
                      <i className="fas fa-cart-plus text-[11px]" />
                      Agregar
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {totalPages > 1 ? (
          <div className="flex items-center justify-center gap-2 px-4 py-3 border-t border-slate-100 shrink-0">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium disabled:opacity-40"
            >
              Anterior
            </button>
            <span className="text-xs text-slate-600">
              {page} / {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium disabled:opacity-40"
            >
              Siguiente
            </button>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
};

export default ProductPickerModal;
