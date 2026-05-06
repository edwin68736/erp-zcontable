import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { productsService, type ProductUpsertInput, type ProductKind } from '../services/products';
import { productCategoriesService, type ProductCategory } from '../services/productCategories';
import { auth } from '../services/auth';
import SearchableSelect from '../components/SearchableSelect';
import { SUNAT_PRODUCT_UNIT_LABEL, SUNAT_SERVICE_UNITS } from '../constants/sunatUnitOfMeasure';

/** Contenedor: crece con el viewport en pantallas grandes; mantiene márgenes cómodos en móvil. */
const PAGE_CLASS =
  'w-full mx-auto max-w-full px-3 sm:px-4 lg:px-6 py-2 space-y-5 sm:max-w-2xl md:max-w-3xl lg:max-w-4xl xl:max-w-5xl 2xl:max-w-6xl min-[1920px]:max-w-[90rem]';

type IgvAffectation = '10' | '20' | '30';

function affectationFromProduct(code: string | undefined): IgvAffectation {
  const c = (code ?? '').trim();
  if (c === '20' || c === '30') return c;
  return '10';
}

function buildUpsert(input: {
  productKind: ProductKind;
  description: string;
  internalId: string;
  barcode: string;
  serviceUnit: 'ZZ' | 'NIU';
  price: number;
  trackInventory: boolean;
  stock: string;
  stockMin: string;
  purchasePrice: string;
  categoryId: number | null;
  igvAffect: IgvAffectation;
  priceIncludesIgv: boolean;
}): ProductUpsertInput {
  const sym = 'S/';
  const saleText = `${sym} ${input.price.toFixed(2)}`;
  const purchaseText =
    input.trackInventory && input.purchasePrice.trim() !== ''
      ? `${sym} ${(Number.parseFloat(input.purchasePrice) || 0).toFixed(2)}`
      : '';

  const unit = input.productKind === 'product' ? 'NIU' : input.serviceUnit;

  return {
    product_kind: input.productKind,
    product_category_id: input.categoryId && input.categoryId > 0 ? input.categoryId : null,
    unit_type_id: unit,
    category_id: 0,
    description: input.description.trim(),
    name: '',
    second_name: '',
    warehouse_id: 0,
    internal_id: input.internalId.trim(),
    barcode: input.barcode.trim(),
    item_code: '',
    item_code_gs1: '',
    stock: input.trackInventory ? input.stock.trim() || '0' : '0',
    stock_min: input.trackInventory ? input.stockMin.trim() || '0' : '0',
    currency_type_id: 'PEN',
    currency_type_symbol: sym,
    sale_affectation_igv_type_id: input.igvAffect,
    price: input.price,
    calculate_quantity: false,
    has_igv: input.igvAffect === '10',
    price_includes_igv: input.igvAffect === '10' ? input.priceIncludesIgv : false,
    track_inventory: input.trackInventory,
    active: true,
    sale_unit_price: saleText,
    purchase_unit_price: purchaseText,
    apply_store: true,
  };
}

const ProductForm = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const editId = id ? Number(id) : null;
  const role = auth.getRole() ?? '';
  const canUpsert = ['Administrador', 'Supervisor', 'Contador'].includes(role);

  const [productKind, setProductKind] = useState<ProductKind>('service');
  const [description, setDescription] = useState('');
  const [internalId, setInternalId] = useState('');
  const [barcode, setBarcode] = useState('');
  const [serviceUnit, setServiceUnit] = useState<'ZZ' | 'NIU'>('ZZ');
  const [price, setPrice] = useState(0);
  const [trackInventory, setTrackInventory] = useState(false);
  const [stock, setStock] = useState('0');
  const [stockMin, setStockMin] = useState('0');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [categoryIdStr, setCategoryIdStr] = useState('');
  const [igvAffect, setIgvAffect] = useState<IgvAffectation>('10');
  const [priceIncludesIgv, setPriceIncludesIgv] = useState(true);

  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [catModalOpen, setCatModalOpen] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [catSaving, setCatSaving] = useState(false);
  const [catError, setCatError] = useState('');

  const [tukifacItemId, setTukifacItemId] = useState<number | null>(null);
  const [remoteCategoryId, setRemoteCategoryId] = useState(0);
  const [imageUrl, setImageUrl] = useState('');
  const [loading, setLoading] = useState(!!editId);
  const [error, setError] = useState('');

  const loadCategories = () => {
    void productCategoriesService.list().then(setCategories);
  };

  useEffect(() => {
    loadCategories();
  }, []);

  useEffect(() => {
    if (!editId) return;
    void productsService
      .get(editId)
      .then((p) => {
        setProductKind(p.product_kind);
        setDescription(p.description ?? '');
        setInternalId(p.internal_id ?? '');
        setBarcode(p.barcode ?? '');
        const u = (p.unit_type_id ?? '').toUpperCase();
        setServiceUnit(u === 'NIU' ? 'NIU' : 'ZZ');
        setPrice(Number(p.price) || 0);
        setTrackInventory(Boolean(p.track_inventory));
        setStock(p.stock ?? '0');
        setStockMin(p.stock_min ?? '0');
        const pur = (p.purchase_unit_price ?? '').replace(/^S\/\s*/i, '').trim();
        setPurchasePrice(pur);
        setCategoryIdStr(p.product_category_id ? String(p.product_category_id) : '');
        setIgvAffect(affectationFromProduct(p.sale_affectation_igv_type_id));
        setPriceIncludesIgv(Boolean(p.price_includes_igv));
        setTukifacItemId(p.tukifac_item_id ?? null);
        setRemoteCategoryId(Number(p.category_id) || 0);
        setImageUrl((p.image_url ?? '').trim());
      })
      .catch(() => setError('Error al cargar'))
      .finally(() => setLoading(false));
  }, [editId]);

  const categoryOptions = useMemo(
    () =>
      categories.map((c) => ({
        value: String(c.id),
        label: c.name,
        searchText: c.name,
      })),
    [categories],
  );

  const serviceUnitOptions = useMemo(
    () =>
      SUNAT_SERVICE_UNITS.map((u) => ({
        value: u.code,
        label: u.label,
        searchText: u.label,
      })),
    [],
  );

  const handleCreateCategory = async () => {
    const name = newCatName.trim();
    if (!name) {
      setCatError('Ingrese un nombre');
      return;
    }
    try {
      setCatSaving(true);
      setCatError('');
      const created = await productCategoriesService.create(name);
      setCategories((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      setCategoryIdStr(String(created.id));
      setNewCatName('');
      setCatModalOpen(false);
    } catch {
      setCatError('No se pudo crear la categoría');
    } finally {
      setCatSaving(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canUpsert) return;
    try {
      setError('');
      const catNum = categoryIdStr ? Number(categoryIdStr) : 0;
      const payload = buildUpsert({
        productKind,
        description,
        internalId,
        barcode,
        serviceUnit,
        price,
        trackInventory,
        stock,
        stockMin,
        purchasePrice,
        categoryId: Number.isFinite(catNum) && catNum > 0 ? catNum : null,
        igvAffect,
        priceIncludesIgv,
      });
      if (editId) {
        payload.category_id = remoteCategoryId;
      }
      if (editId) {
        await productsService.update(editId, payload);
      } else {
        await productsService.create(payload);
      }
      navigate('/products', { replace: true });
    } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { error?: string } } }).response?.data?.error
          : 'Error al guardar';
      setError(typeof msg === 'string' ? msg : 'Error al guardar');
    }
  };

  if (loading) {
    return (
      <div className={PAGE_CLASS}>
        <div className="p-6 text-sm text-slate-500">Cargando…</div>
      </div>
    );
  }

  const fromTukifac = tukifacItemId != null && tukifacItemId > 0;

  return (
    <div className={PAGE_CLASS}>
      <div className="flex justify-between items-center gap-3">
        <h2 className="text-lg font-semibold text-slate-800">{editId ? 'Editar producto / servicio' : 'Nuevo producto / servicio'}</h2>
        <Link
          to="/products"
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          <i className="fas fa-arrow-left text-xs" aria-hidden="true"></i>
          Volver al listado
        </Link>
      </div>

      {fromTukifac ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 px-3 py-2.5 text-xs text-emerald-900 flex flex-wrap items-center gap-2">
          <span className="font-semibold">Sincronizado con Tukifac</span>
          <span className="text-emerald-800/80">ID {tukifacItemId}</span>
          {imageUrl ? (
            <a href={imageUrl} target="_blank" rel="noreferrer" className="ml-auto">
              <img src={imageUrl} alt="" className="h-12 w-12 rounded-lg object-cover border border-emerald-200" />
            </a>
          ) : null}
        </div>
      ) : null}

      {error ? <div className="text-sm text-red-600">{error}</div> : null}

      <form
        onSubmit={handleSubmit}
        className="w-full space-y-4 bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 lg:p-8 shadow-sm"
      >
        <div className="xl:grid xl:grid-cols-2 xl:gap-x-10 xl:gap-y-4 xl:items-start">
          <div className="space-y-4 min-w-0">
            <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Tipo <span className="text-red-500">*</span>
          </label>
          <select
            value={productKind}
            onChange={(e) => {
              const k = e.target.value as ProductKind;
              setProductKind(k);
              if (k === 'product') setPriceIncludesIgv(true);
            }}
            className="w-full px-3 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
          >
            <option value="service">Servicio</option>
            <option value="product">Producto</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Nombre <span className="text-red-500">*</span>
          </label>
          <input
            required
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Ingrese el nombre del producto o servicio"
            className="w-full px-3 py-2.5 rounded-xl border border-slate-300 text-sm placeholder:text-slate-400 focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Código de barras</label>
            <input
              value={barcode}
              onChange={(e) => {
                const next = e.target.value;
                setInternalId((prev) => (prev === barcode ? next : prev));
                setBarcode(next);
              }}
              placeholder="Código de barras"
              className="w-full px-3 py-2.5 rounded-xl border border-slate-300 text-sm placeholder:text-slate-400 focus:ring-2 focus:ring-primary-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Código interno</label>
            <input
              value={internalId}
              onChange={(e) => setInternalId(e.target.value)}
              placeholder="Código interno"
              className="w-full px-3 py-2.5 rounded-xl border border-slate-300 text-sm placeholder:text-slate-400 focus:ring-2 focus:ring-primary-500 outline-none"
            />
            <p className="mt-1 text-[11px] text-slate-500 leading-snug">
              Por defecto coincide con el código de barras; puede escribir otro valor si lo necesita.
            </p>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Unidad (SUNAT) <span className="text-red-500">*</span>
          </label>
          {productKind === 'product' ? (
            <div className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-700">
              {SUNAT_PRODUCT_UNIT_LABEL}
            </div>
          ) : (
            <SearchableSelect
              value={serviceUnit}
              onChange={(v) => setServiceUnit(v === 'NIU' ? 'NIU' : 'ZZ')}
              options={serviceUnitOptions}
              placeholder="Unidad"
              searchPlaceholder="Buscar…"
              className="w-full"
            />
          )}
        </div>
          </div>

          <div className="space-y-4 min-w-0 mt-4 xl:mt-0">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Precio de venta <span className="text-red-500">*</span>
          </label>
          <input
            type="number"
            step="0.01"
            min={0}
            required
            value={Number.isFinite(price) ? String(price) : '0'}
            onChange={(e) => setPrice(Number(e.target.value) || 0)}
            placeholder="0.00"
            className="w-full px-3 py-2.5 rounded-xl border border-slate-300 text-sm placeholder:text-slate-400 focus:ring-2 focus:ring-primary-500 outline-none"
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={trackInventory}
            onChange={(e) => setTrackInventory(e.target.checked)}
            className="rounded border-slate-300 text-primary-600 focus:ring-primary-500"
          />
          Control inventario
        </label>

        {trackInventory ? (
          <div className="space-y-3 pl-1 border-l-2 border-primary-200 ml-1 py-1">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Stock</label>
                <input
                  value={stock}
                  onChange={(e) => setStock(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Stock mínimo</label>
                <input
                  value={stockMin}
                  onChange={(e) => setStockMin(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Precio de compra</label>
              <input
                type="number"
                step="0.01"
                min={0}
                value={purchasePrice}
                onChange={(e) => setPurchasePrice(e.target.value)}
                placeholder="0.00"
                className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
          </div>
        ) : null}

        <div className="flex flex-col sm:flex-row sm:items-end gap-3">
          <div className="flex-1 min-w-0">
            <label className="block text-sm font-medium text-slate-700 mb-1">Categoría</label>
            <SearchableSelect
              value={categoryIdStr}
              onChange={setCategoryIdStr}
              options={[{ value: '', label: 'Sin categoría', searchText: '' }, ...categoryOptions]}
              placeholder="Seleccionar categoría"
              searchPlaceholder="Buscar categoría…"
              className="w-full"
            />
          </div>
          <button
            type="button"
            title="Nueva categoría"
            onClick={() => {
              setCatError('');
              setNewCatName('');
              setCatModalOpen(true);
            }}
            className="shrink-0 inline-flex items-center justify-center h-[42px] w-[42px] rounded-xl bg-sky-500 text-white text-lg font-semibold hover:bg-sky-600 shadow-sm"
          >
            +
          </button>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">
            Afectación IGV <span className="text-red-500">*</span>
          </label>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="igv_aff"
                checked={igvAffect === '10'}
                onChange={() => {
                  setIgvAffect('10');
                  setPriceIncludesIgv(true);
                }}
              />
              Gravado
            </label>
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="igv_aff"
                checked={igvAffect === '20'}
                onChange={() => {
                  setIgvAffect('20');
                  setPriceIncludesIgv(false);
                }}
              />
              Exonerado
            </label>
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="igv_aff"
                checked={igvAffect === '30'}
                onChange={() => {
                  setIgvAffect('30');
                  setPriceIncludesIgv(false);
                }}
              />
              Inafecto
            </label>
          </div>
        </div>

        <label
          className={`flex items-center gap-2 text-sm text-slate-700 select-none ${
            igvAffect !== '10' ? 'opacity-50 pointer-events-none' : 'cursor-pointer'
          }`}
        >
          <input
            type="checkbox"
            checked={igvAffect === '10' && priceIncludesIgv}
            disabled={igvAffect !== '10'}
            onChange={(e) => setPriceIncludesIgv(e.target.checked)}
            className="rounded border-slate-300 text-primary-600 focus:ring-primary-500"
          />
          Incluye IGV en precios
        </label>
          </div>

          <div className="xl:col-span-2 pt-4 border-t border-slate-100 xl:border-t-0 xl:pt-2">
            <button
              type="submit"
              disabled={!canUpsert}
              className="inline-flex items-center justify-center gap-2 w-full sm:w-auto px-6 py-2.5 rounded-full bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50 shadow-sm"
            >
              <i className="fas fa-save text-xs" aria-hidden="true"></i>
              Guardar
            </button>
          </div>
        </div>
      </form>

      {catModalOpen
        ? createPortal(
            <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
              <button
                type="button"
                className="absolute inset-0 bg-slate-900/40"
                aria-label="Cerrar"
                onClick={() => setCatModalOpen(false)}
              />
              <div className="relative w-full max-w-sm bg-white rounded-2xl border border-slate-200 shadow-xl p-5">
                <h3 className="text-sm font-semibold text-slate-800 mb-3">Nueva categoría</h3>
                {catError ? <div className="text-xs text-red-600 mb-2">{catError}</div> : null}
                <input
                  autoFocus
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  placeholder="Nombre de la categoría"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm mb-4 outline-none focus:ring-2 focus:ring-primary-500"
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setCatModalOpen(false)}
                    className="px-4 py-2 rounded-full border border-slate-300 text-sm text-slate-700 hover:bg-slate-50"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    disabled={catSaving}
                    onClick={() => void handleCreateCategory()}
                    className="px-4 py-2 rounded-full bg-primary-600 text-white text-sm font-medium disabled:opacity-50"
                  >
                    {catSaving ? 'Guardando…' : 'Crear'}
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
};

export default ProductForm;
