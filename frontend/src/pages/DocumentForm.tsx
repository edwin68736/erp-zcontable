import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { formatInTimeZone } from 'date-fns-tz';
import { dateInputToRFC3339MidnightPeru, peruDateInputFromApiDate } from '../utils/peruDates';
import { companiesService } from '../services/companies';
import { documentsService, type DocumentItemInput, type DocumentUpsertInput } from '../services/documents';
import { auth } from '../services/auth';
import type { Company } from '../types/dashboard';
import SearchableSelect from '../components/SearchableSelect';
import ProductPickerModal, { productLabel, productUnitPrice } from '../components/ProductPickerModal';
import type { Product } from '../services/products';

const DEBT_TYPE_OPTIONS = [
  { value: 'nota_venta', label: 'Nota de venta' },
  { value: 'recibo', label: 'Recibo' },
  { value: 'liquidacion_impuestos', label: 'Liquidación de impuestos' },
];

function toMonthInput(value?: string): string {
  if (!value) return '';
  if (value.length >= 7) return value.slice(0, 7);
  return value;
}

function getErrorMessage(e: unknown): string {
  if (!e || typeof e !== 'object') return 'Error al guardar la deuda';
  if (!('response' in e)) return 'Error al guardar la deuda';
  const maybe = e as { response?: { data?: unknown } };
  const data = maybe.response?.data;
  if (data && typeof data === 'object' && 'error' in data) {
    const msg = (data as { error?: unknown }).error;
    if (typeof msg === 'string' && msg.trim()) return msg;
  }
  return 'Error al guardar la deuda';
}

function typeOptionsForEdit(currentType: string) {
  const t = String(currentType ?? '').trim();
  const base = [...DEBT_TYPE_OPTIONS];
  if (t && !base.some((o) => o.value === t)) {
    const label = t === 'PLAN' ? 'Mensualidad (plan)' : t === 'LI' ? 'Liquidación (LI)' : t;
    base.push({ value: t, label });
  }
  return base;
}

type DebtLine = {
  key: string;
  product_id?: number;
  description: string;
  amount: string;
};

function newDebtLineKey() {
  return `ln-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

const DocumentForm = () => {
  const navigate = useNavigate();
  const params = useParams();
  const [searchParams] = useSearchParams();
  const documentId = params.id ? Number(params.id) : null;
  const isEdit = Boolean(documentId);

  const role = auth.getRole() ?? '';
  const canUpsert = role === 'Administrador' || role === 'Supervisor' || role === 'Contador';

  const peruvianToday = useMemo(() => formatInTimeZone(new Date(), 'America/Lima', 'yyyy-MM-dd'), []);

  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [companyId, setCompanyId] = useState(searchParams.get('company_id') ?? '');
  const [type, setType] = useState('nota_venta');
  const [displayNumber, setDisplayNumber] = useState('');
  const [issueDate, setIssueDate] = useState(() => (isEdit ? '' : peruvianToday));
  const [dueDate, setDueDate] = useState('');
  const [totalAmount, setTotalAmount] = useState('');
  const [status, setStatus] = useState('pendiente');
  const [description, setDescription] = useState('');
  const [serviceMonth, setServiceMonth] = useState('');
  const [accountingPeriod, setAccountingPeriod] = useState(() => peruvianToday.slice(0, 7));
  const accountingPeriodTouchedRef = useRef(false);
  const [loadedSource, setLoadedSource] = useState('');
  const [lines, setLines] = useState<DebtLine[]>([{ key: newDebtLineKey(), description: '', amount: '' }]);
  const [pickerOpen, setPickerOpen] = useState(false);

  const linesTotal = useMemo(
    () =>
      lines.reduce((s, l) => {
        const n = Number(l.amount);
        return s + (Number.isFinite(n) && n > 0 ? n : 0);
      }, 0),
    [lines],
  );

  useEffect(() => {
    if (loadedSource === 'recurrente_plan') return;
    if (accountingPeriodTouchedRef.current) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(issueDate)) return;
    setAccountingPeriod(issueDate.slice(0, 7));
  }, [issueDate, loadedSource]);

  useEffect(() => {
    const run = async () => {
      try {
        setLoading(true);
        setError('');
        const [comps, doc] = await Promise.all([
          companiesService.list(),
          isEdit && documentId ? documentsService.get(documentId) : Promise.resolve(null),
        ]);

        setCompanies(comps);

        if (doc) {
          setCompanyId(String(doc.company_id ?? ''));
          setType(doc.type ?? 'nota_venta');
          setLoadedSource(String(doc.source ?? ''));
          setDisplayNumber(doc.number ?? '');
          setIssueDate(peruDateInputFromApiDate(doc.issue_date) || peruvianToday);
          setDueDate(peruDateInputFromApiDate(doc.due_date));
          setTotalAmount(Number.isFinite(doc.total_amount) ? doc.total_amount.toFixed(2) : '');
          setStatus(doc.status ?? 'pendiente');
          setDescription(doc.description ?? '');
          setServiceMonth(toMonthInput(doc.service_month));
          setAccountingPeriod(
            toMonthInput(doc.accounting_period || doc.service_month) ||
              (peruDateInputFromApiDate(doc.issue_date)?.slice(0, 7) ?? peruvianToday.slice(0, 7)),
          );
          accountingPeriodTouchedRef.current = false;
          const src = String(doc.source ?? '');
          if (src !== 'recurrente_plan') {
            if (doc.items && doc.items.length > 0) {
              setLines(
                doc.items.map((it, idx) => ({
                  key: `loaded-${it.id}-${idx}`,
                  product_id: it.product_id ?? undefined,
                  description: it.description ?? '',
                  amount: Number.isFinite(it.amount) ? it.amount.toFixed(2) : '',
                })),
              );
            } else {
              setLines([
                {
                  key: newDebtLineKey(),
                  description: (doc.description ?? '').trim(),
                  amount: Number.isFinite(doc.total_amount) ? doc.total_amount.toFixed(2) : '',
                },
              ]);
            }
          }
        }
      } catch (e) {
        console.error(e);
        setError(isEdit ? 'Error al cargar la deuda' : 'Error al cargar empresas');
      } finally {
        setLoading(false);
      }
    };

    run();
  }, [isEdit, documentId, peruvianToday]);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!canUpsert) {
      setError('No tienes permisos para realizar esta acción');
      return;
    }

    const companyIdNum = Number(companyId);

    if (!companyIdNum) {
      setError('La empresa es requerida');
      return;
    }

    if (!type.trim()) {
      setError('El tipo de comprobante es requerido');
      return;
    }

    const isPlanDebt = loadedSource === 'recurrente_plan';
    let payload: DocumentUpsertInput;

    if (isPlanDebt) {
      const totalNum = Number(totalAmount);
      if (!Number.isFinite(totalNum) || totalNum <= 0) {
        setError('El monto debe ser mayor a 0');
        return;
      }
      payload = {
        company_id: companyIdNum,
        type: type.trim(),
        issue_date: dateInputToRFC3339MidnightPeru(issueDate),
        due_date: dateInputToRFC3339MidnightPeru(dueDate),
        total_amount: totalNum,
        status: isEdit ? status : 'pendiente',
        description: description.trim() ? description.trim() : undefined,
        service_month: serviceMonth.trim() ? serviceMonth.trim() : undefined,
      };
    } else {
      const ap = accountingPeriod.trim();
      if (!/^\d{4}-\d{2}$/.test(ap)) {
        setError('Indique el periodo contable (año-mes) con el selector o formato AAAA-MM');
        return;
      }
      const items: DocumentItemInput[] = [];
      let sum = 0;
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        const desc = l.description.trim();
        const amt = Number(l.amount);
        if (!desc) {
          setError('Cada ítem necesita descripción');
          return;
        }
        if (!Number.isFinite(amt) || amt <= 0) {
          setError('Cada ítem necesita un monto mayor a 0');
          return;
        }
        sum += amt;
        items.push({
          ...(l.product_id ? { product_id: l.product_id } : {}),
          description: desc,
          quantity: 1,
          unit_price: amt,
          amount: amt,
          sort_order: i,
        });
      }
      if (items.length === 0) {
        setError('Agregue al menos un ítem a la deuda');
        return;
      }
      const joined = items.map((it) => it.description).join(' · ');
      payload = {
        company_id: companyIdNum,
        type: type.trim(),
        issue_date: dateInputToRFC3339MidnightPeru(issueDate),
        due_date: dateInputToRFC3339MidnightPeru(dueDate),
        total_amount: Math.round(sum * 100) / 100,
        status: isEdit ? status : 'pendiente',
        description: description.trim() || joined.slice(0, 1900) || undefined,
        accounting_period: ap,
        items,
      };
    }

    if (isEdit && displayNumber.trim()) {
      payload.number = displayNumber.trim();
    }

    try {
      setSaving(true);
      setError('');
      if (isEdit && documentId) {
        await documentsService.update(documentId, payload);
      } else {
        await documentsService.create(payload);
      }
      window.dispatchEvent(
        new CustomEvent('miweb:toast', {
          detail: { type: 'success', message: isEdit ? 'Deuda actualizada correctamente.' : 'Deuda registrada correctamente.' },
        }),
      );
      navigate('/documents', { replace: true });
    } catch (e2) {
      console.error(e2);
      setError(getErrorMessage(e2));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="w-full max-w-5xl xl:max-w-6xl 2xl:max-w-7xl mx-auto space-y-6">
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-6 text-sm text-slate-600">
          <i className="fas fa-spinner fa-spin mr-2"></i> Cargando...
        </div>
      </div>
    );
  }

  const typeSelectOptions = isEdit ? typeOptionsForEdit(type) : DEBT_TYPE_OPTIONS;
  const isPlanDebt = loadedSource === 'recurrente_plan';

  return (
    <div className="w-full max-w-5xl xl:max-w-6xl 2xl:max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-800">{isEdit ? 'Editar deuda' : 'Nueva deuda'}</h2>
          <p className="text-sm text-slate-500">
            Cargo interno en cuentas por cobrar. Las facturas y boletas oficiales se emiten en Tukifac y se concilian en la bandeja de comprobantes.
          </p>
        </div>
        <Link
          to="/documents"
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          <i className="fas fa-arrow-left text-xs"></i> Volver al listado
        </Link>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="company_id" className="block text-sm font-medium text-slate-700 mb-1">
              Empresa (cliente)
            </label>
            <SearchableSelect
              id="company_id"
              name="company_id"
              required
              value={companyId}
              onChange={setCompanyId}
              placeholder="Selecciona una empresa…"
              searchPlaceholder="Buscar empresa..."
              options={companies.map((c) => ({ value: String(c.id), label: c.business_name }))}
            />
          </div>
          <div>
            <label htmlFor="type" className="block text-sm font-medium text-slate-700 mb-1">
              Tipo de comprobante (interno)
            </label>
            {isPlanDebt ? (
              <div className="px-3 py-2.5 rounded-lg border border-slate-200 bg-slate-50 text-sm text-slate-700">
                Mensualidad (plan) — no editable
              </div>
            ) : (
              <SearchableSelect
                id="type"
                name="type"
                required
                value={type}
                onChange={setType}
                placeholder="Selecciona…"
                searchPlaceholder="Buscar tipo..."
                options={typeSelectOptions}
              />
            )}
          </div>
        </div>

        {!isEdit && type === 'liquidacion_impuestos' ? (
          <div className="rounded-xl border border-sky-200 bg-sky-50/80 px-4 py-3 text-sm text-sky-900">
            <p className="font-medium text-sky-950">Liquidación de impuestos</p>
            <p className="mt-1 text-sky-800/90 leading-relaxed">
              Puede registrar aquí un cargo resumen en cuentas por cobrar. Para armar el borrador con líneas (deudas con
              saldo, impuestos PDT, ajustes) y emitir el documento de liquidación, use el asistente.
            </p>
            {companyId ? (
              <Link
                to={`/tax-settlements/new?company_id=${encodeURIComponent(companyId)}`}
                className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium shadow-sm transition bg-sky-700 text-white hover:bg-sky-800"
              >
                <i className="fas fa-file-invoice-dollar text-xs"></i>
                Ir al asistente de liquidación
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => setError('Seleccione primero la empresa para abrir el asistente de liquidación.')}
                className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium bg-slate-200 text-slate-600 cursor-pointer"
              >
                <i className="fas fa-file-invoice-dollar text-xs"></i>
                Ir al asistente de liquidación
              </button>
            )}
          </div>
        ) : null}

        {isEdit && displayNumber ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            <span className="font-medium text-slate-600">Número interno: </span>
            <span className="font-mono text-xs">{displayNumber}</span>
            <p className="text-xs text-slate-500 mt-1">Se asigna al crear; no es el número SUNAT de Tukifac.</p>
          </div>
        ) : null}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="issue_date" className="block text-sm font-medium text-slate-700 mb-1">
              Fecha de registro (emisión)
            </label>
            <input
              type="date"
              id="issue_date"
              name="issue_date"
              value={issueDate}
              onChange={(ev) => setIssueDate(ev.target.value)}
              className="w-full px-3 py-2.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
            />
          </div>
          <div>
            <label htmlFor="due_date" className="block text-sm font-medium text-slate-700 mb-1">
              Fecha límite de pago
            </label>
            <input
              type="date"
              id="due_date"
              name="due_date"
              value={dueDate}
              onChange={(ev) => setDueDate(ev.target.value)}
              className="w-full px-3 py-2.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
            />
          </div>
        </div>

        {isPlanDebt ? (
          <div>
            <label htmlFor="description" className="block text-sm font-medium text-slate-700 mb-1">
              Descripción / concepto
            </label>
            <textarea
              id="description"
              name="description"
              rows={3}
              value={description}
              onChange={(ev) => setDescription(ev.target.value)}
              className="w-full px-3 py-2.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none resize-y min-h-[5rem]"
              placeholder="Ej. Honorarios marzo, servicio contable, etc."
            />
          </div>
        ) : (
          <>
            <div>
              <label htmlFor="description" className="block text-sm font-medium text-slate-700 mb-1">
                Notas / referencia <span className="text-slate-400 font-normal">(opcional)</span>
              </label>
              <textarea
                id="description"
                name="description"
                rows={2}
                value={description}
                onChange={(ev) => setDescription(ev.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none resize-y min-h-[4rem]"
                placeholder="Texto libre adicional; en el listado también se arma un resumen desde los ítems."
              />
            </div>

            <div className="space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <h3 className="text-sm font-semibold text-slate-800">Ítems de la deuda</h3>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setPickerOpen(true)}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-primary-200 bg-primary-50 text-xs font-semibold text-primary-900 hover:bg-primary-100"
                  >
                    <i className="fas fa-store text-[11px]" />
                    Catálogo
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setLines((prev) => [...prev, { key: newDebtLineKey(), description: '', amount: '' }])
                    }
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    <i className="fas fa-plus text-[10px]" />
                    Línea en blanco
                  </button>
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 text-left text-[11px] font-semibold uppercase text-slate-500">
                        <th className="px-3 py-2.5 w-10">#</th>
                        <th className="px-3 py-2.5 min-w-[200px]">Descripción</th>
                        <th className="px-3 py-2.5 text-right w-36">Monto (S/)</th>
                        <th className="px-2 py-2.5 w-12" aria-label="Quitar" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {lines.map((ln, idx) => (
                        <tr key={ln.key} className="bg-white">
                          <td className="px-3 py-2 text-xs text-slate-400 tabular-nums">{idx + 1}</td>
                          <td className="px-3 py-2">
                            <input
                              type="text"
                              value={ln.description}
                              onChange={(ev) =>
                                setLines((prev) =>
                                  prev.map((x) => (x.key === ln.key ? { ...x, description: ev.target.value } : x)),
                                )
                              }
                              className="w-full px-2.5 py-2 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-primary-500/25 outline-none"
                              placeholder="Descripción del cargo"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center justify-end gap-0.5 rounded-lg border border-slate-200">
                              <span className="pl-2 text-xs text-slate-500">S/</span>
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                value={ln.amount}
                                onChange={(ev) =>
                                  setLines((prev) =>
                                    prev.map((x) => (x.key === ln.key ? { ...x, amount: ev.target.value } : x)),
                                  )
                                }
                                className="w-full min-w-0 py-2 pr-2 border-0 text-sm text-right tabular-nums outline-none"
                              />
                            </div>
                          </td>
                          <td className="px-2 py-2 text-center">
                            <button
                              type="button"
                              disabled={lines.length <= 1}
                              onClick={() => setLines((prev) => prev.filter((x) => x.key !== ln.key))}
                              className="inline-flex items-center justify-center w-9 h-9 rounded-lg text-red-600 bg-red-50 border border-red-100 hover:bg-red-100 disabled:opacity-40 disabled:pointer-events-none"
                              aria-label="Quitar ítem"
                            >
                              <i className="fas fa-trash-alt text-sm" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <p className="text-xs text-slate-500">
                Use <strong>Catálogo</strong> para cargar productos o servicios guardados (precio editable después). El total se calcula sumando los ítems.
              </p>
            </div>
          </>
        )}

        <div className={`grid grid-cols-1 gap-4 ${isEdit ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
          {isPlanDebt ? (
            <div>
              <label htmlFor="total_amount" className="block text-sm font-medium text-slate-700 mb-1">
                Monto total
              </label>
              <div className="flex items-center rounded-lg border border-slate-300 focus-within:ring-2 focus-within:ring-primary-500 focus-within:border-primary-500">
                <span className="px-3 text-slate-600 text-sm font-medium whitespace-nowrap">S/</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  id="total_amount"
                  name="total_amount"
                  required
                  value={totalAmount}
                  onChange={(ev) => setTotalAmount(ev.target.value)}
                  className="w-full px-2 py-2.5 rounded-r-lg outline-none text-sm"
                />
              </div>
            </div>
          ) : (
            <div>
              <span className="block text-sm font-medium text-slate-700 mb-1">Monto total (suma de ítems)</span>
              <div className="px-3 py-2.5 rounded-lg border border-slate-200 bg-slate-50 text-sm font-semibold text-slate-900 tabular-nums">
                S/ {linesTotal.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>
          )}
          <div>
            {isPlanDebt ? (
              <>
                <label htmlFor="service_month" className="block text-sm font-medium text-slate-700 mb-1">
                  Mes de servicio (plan)
                </label>
                <input
                  type="month"
                  id="service_month"
                  name="service_month"
                  value={serviceMonth}
                  onChange={(ev) => setServiceMonth(ev.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                />
              </>
            ) : (
              <>
                <label htmlFor="accounting_period" className="block text-sm font-medium text-slate-700 mb-1">
                  Periodo contable (año-mes)
                </label>
                <p className="text-xs text-slate-500 mb-1.5">
                  Independiente de la fecha de registro; identifica el mes al que corresponde el cargo.
                </p>
                <input
                  type="month"
                  id="accounting_period"
                  name="accounting_period"
                  required
                  value={accountingPeriod}
                  onChange={(ev) => {
                    accountingPeriodTouchedRef.current = true;
                    setAccountingPeriod(ev.target.value);
                  }}
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                />
              </>
            )}
          </div>
          {isEdit ? (
            <div>
              <label htmlFor="status" className="block text-sm font-medium text-slate-700 mb-1">
                Estado
              </label>
              <SearchableSelect
                id="status"
                name="status"
                value={status}
                onChange={setStatus}
                options={[
                  { value: 'pendiente', label: 'Pendiente' },
                  { value: 'parcial', label: 'Parcial' },
                  { value: 'pagado', label: 'Pagado' },
                  { value: 'anulado', label: 'Anulado' },
                ]}
              />
            </div>
          ) : null}
        </div>

        <div className="pt-2">
          <button
            type="submit"
            disabled={saving || !canUpsert}
            className="inline-flex items-center justify-center px-5 py-2.5 rounded-full bg-primary-600 text-white text-sm font-medium shadow-sm hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-primary-500 disabled:opacity-60"
          >
            <i className="fas fa-save mr-2 text-xs"></i>
            {saving ? 'Guardando...' : isEdit ? 'Guardar cambios' : 'Registrar deuda'}
          </button>
        </div>
      </form>

      {!isPlanDebt ? (
        <ProductPickerModal
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          onPick={(p: Product) => {
            const price = productUnitPrice(p);
            setLines((prev) => [
              ...prev,
              {
                key: newDebtLineKey(),
                product_id: p.id,
                description: productLabel(p),
                amount: price > 0 ? price.toFixed(2) : '',
              },
            ]);
            setPickerOpen(false);
          }}
        />
      ) : null}
    </div>
  );
};

export default DocumentForm;
