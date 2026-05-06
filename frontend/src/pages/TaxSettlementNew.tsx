import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import SearchableSelect from '../components/SearchableSelect';
import { companiesService } from '../services/companies';
import { taxSettlementsService } from '../services/taxSettlements';
import type { Company, SettlementPreviewLine } from '../types/dashboard';
import { auth } from '../services/auth';
import ProductPickerModal, { productLabel, productUnitPrice } from '../components/ProductPickerModal';
import type { Product } from '../services/products';

const pad2 = (n: number) => String(n).padStart(2, '0');
const formatDateInput = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/** YYYY-MM del mes calendario anterior al mes de `d` (hora local). Ej.: 22-abr-2026 → 2026-03. */
function previousMonthYMFromDate(d: Date): string {
  const prev = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  return `${prev.getFullYear()}-${pad2(prev.getMonth() + 1)}`;
}

const MONTH_NAMES_ES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
] as const;

/** Etiqueta legible para PDF a partir de YYYY-MM */
function periodLabelFromYM(ym: string): string {
  if (!/^\d{4}-\d{2}$/.test(ym)) return '';
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7));
  if (!Number.isFinite(y) || m < 1 || m > 12) return '';
  return `${MONTH_NAMES_ES[m - 1]} ${y}`;
}

function formatPEN(n: number): string {
  return n.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function parseLineAmount(raw: string): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

type LineRow = {
  key: string;
  line_type: 'document_ref' | 'tax_manual' | 'adjustment';
  document_id?: number;
  product_id?: number;
  concept: string;
  amount: string;
  /** Periodo contable de la línea solo año-mes (YYYY-MM). */
  period_ym: string;
};

const TaxSettlementNew = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const role = auth.getRole() ?? '';
  const allowed = ['Administrador', 'Supervisor', 'Contador'].includes(role);

  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [issueDate, setIssueDate] = useState(() => formatDateInput(new Date()));
  const [liquidationPeriod, setLiquidationPeriod] = useState(() => previousMonthYMFromDate(new Date()));
  const liquidationPeriodManualRef = useRef(false);
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<LineRow[]>([]);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const prevLiquidationPeriodRef = useRef(liquidationPeriod);
  const liquidationPeriodRef = useRef(liquidationPeriod);
  liquidationPeriodRef.current = liquidationPeriod;

  useEffect(() => {
    void companiesService.list().then(setCompanies).catch(() => setCompanies([]));
  }, []);

  /** Al cambiar la fecha de emisión, sugerir el mes calendario anterior al de esa fecha como periodo liquidado (si el usuario no lo fijó a mano). */
  useEffect(() => {
    if (liquidationPeriodManualRef.current) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(issueDate)) return;
    const [yy, mo, dd] = issueDate.split('-').map((x) => Number(x));
    if (!Number.isFinite(yy) || !Number.isFinite(mo) || !Number.isFinite(dd)) return;
    const d = new Date(yy, mo - 1, dd);
    setLiquidationPeriod(previousMonthYMFromDate(d));
  }, [issueDate]);

  /** Si cambia el periodo cabecera, propagar a líneas que aún coincidían con el periodo anterior. */
  useEffect(() => {
    const prev = prevLiquidationPeriodRef.current;
    if (prev === liquidationPeriod) {
      prevLiquidationPeriodRef.current = liquidationPeriod;
      return;
    }
    setLines((rows) =>
      rows.map((l) => (!l.period_ym || l.period_ym === prev ? { ...l, period_ym: liquidationPeriod } : l)),
    );
    prevLiquidationPeriodRef.current = liquidationPeriod;
  }, [liquidationPeriod]);

  useEffect(() => {
    const cid = searchParams.get('company_id')?.trim() ?? '';
    if (cid && /^\d+$/.test(cid)) setCompanyId(cid);
  }, [searchParams]);

  const loadPreviewForCompany = useCallback(async (id: number, opts?: { silent?: boolean }) => {
    if (!id) return;
    if (!opts?.silent) setError('');
    setLoadingPreview(true);
    try {
      const data: SettlementPreviewLine[] = await taxSettlementsService.preview(id);
      const ymFallback = liquidationPeriodRef.current;
      setLines(
        data.map((row, i) => {
          const ap = (row.accounting_period ?? '').trim();
          const lineYm = /^\d{4}-\d{2}$/.test(ap) ? ap : ymFallback;
          return {
            key: `d-${row.document_id}-${i}`,
            line_type: 'document_ref' as const,
            document_id: row.document_id,
            concept: row.concept || `Cargo #${row.document_id}`,
            amount: String(row.amount),
            period_ym: lineYm,
          };
        }),
      );
    } catch {
      if (!opts?.silent) setError('No se pudo cargar el saldo de deudas');
    } finally {
      setLoadingPreview(false);
    }
  }, []);

  useEffect(() => {
    const id = Number(companyId);
    if (!Number.isFinite(id) || id <= 0) {
      setLines([]);
      return;
    }
    const t = window.setTimeout(() => {
      void loadPreviewForCompany(id, { silent: true });
    }, 450);
    return () => window.clearTimeout(t);
  }, [companyId, loadPreviewForCompany]);

  const loadPreview = () => {
    const id = Number(companyId);
    if (!id) {
      setError('Seleccione una empresa');
      return;
    }
    void loadPreviewForCompany(id);
  };

  /** Líneas añadidas por el usuario: descripción + monto (backend: adjustment, mismo grupo que honorarios/cargos al emitir). */
  const addManualLine = () => {
    setLines((prev) => [
      ...prev,
      {
        key: `manual-${Date.now()}`,
        line_type: 'adjustment',
        concept: '',
        amount: '',
        period_ym: liquidationPeriod,
      },
    ]);
  };

  const updateLine = (key: string, patch: Partial<LineRow>) => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };

  const removeLine = (key: string) => {
    setLines((prev) => prev.filter((l) => l.key !== key));
  };

  const totals = useMemo(() => {
    let subDeudas = 0;
    let subManual = 0;
    for (const l of lines) {
      const a = parseLineAmount(l.amount);
      if (l.line_type === 'document_ref') subDeudas += a;
      else subManual += a;
    }
    return {
      subDeudas,
      subManual,
      total: subDeudas + subManual,
    };
  }, [lines]);

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const id = Number(companyId);
    if (!id) {
      setError('Empresa requerida');
      return;
    }
    if (lines.length === 0) {
      setError('Agregue líneas o cargue desde deudas abiertas');
      return;
    }
    const lp = liquidationPeriod.trim();
    if (!/^\d{4}-\d{2}$/.test(lp)) {
      setError('Seleccione el periodo de la liquidación (año y mes)');
      return;
    }
    const payloadLines: {
      line_type: string;
      document_id?: number;
      product_id?: number;
      concept: string;
      amount: number;
      sort_order: number;
      period_ym: string;
    }[] = [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const amt = Number(l.amount);
      if (!Number.isFinite(amt) || amt < 0) {
        setError('Revise los montos de cada línea');
        return;
      }
      if (!l.concept.trim()) {
        setError('Cada línea necesita concepto');
        return;
      }
      if (l.line_type === 'document_ref' && (l.document_id == null || l.document_id <= 0)) {
        setError('Línea de deuda sin documento');
        return;
      }
      const pym = (l.period_ym || lp).trim();
      if (!/^\d{4}-\d{2}$/.test(pym)) {
        setError('Cada línea requiere un periodo válido (año-mes, AAAA-MM)');
        return;
      }
      payloadLines.push({
        line_type: l.line_type,
        document_id: l.line_type === 'document_ref' ? l.document_id : undefined,
        product_id: l.line_type !== 'document_ref' && l.product_id ? l.product_id : undefined,
        concept: l.concept.trim(),
        amount: amt,
        sort_order: i,
        period_ym: pym,
      });
    }
    setError('');
    setSaving(true);
    try {
      const created = await taxSettlementsService.create({
        company_id: id,
        issue_date: `${issueDate}T12:00:00Z`,
        liquidation_period: lp,
        period_label: periodLabelFromYM(lp) || lp,
        notes: notes.trim(),
        lines: payloadLines,
      });
      window.dispatchEvent(new CustomEvent('miweb:toast', { detail: { type: 'success', message: 'Liquidación en borrador creada.' } }));
      navigate(`/tax-settlements/${created.id}`);
    } catch (e: unknown) {
      const msg =
        e && typeof e === 'object' && 'response' in e
          ? (e as { response?: { data?: { error?: string } } }).response?.data?.error
          : e instanceof Error
            ? e.message
            : 'Error al guardar';
      setError(typeof msg === 'string' ? msg : 'Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  if (!allowed) {
    return (
      <div className="w-full min-w-0 max-w-full rounded-xl border border-amber-200 bg-amber-50 p-6 text-amber-900 text-sm">
        No tiene permiso para crear liquidaciones.
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 max-w-full space-y-4 sm:space-y-6">
      <div>
        <Link to="/tax-settlements" className="text-sm text-primary-700 hover:text-primary-800 font-medium">
          ← Volver al listado
        </Link>
        <h2 className="text-xl font-semibold text-slate-800 mt-2">Nueva liquidación</h2>
      </div>

      {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

      <form
        onSubmit={(e) => void submit(e)}
        className="w-full min-w-0 space-y-8 bg-white rounded-xl border border-slate-200 p-4 sm:p-6 md:p-8 shadow-sm"
      >
        <section className="space-y-4">
          <h3 className="text-sm font-semibold text-slate-800 border-b border-slate-100 pb-2">Datos generales</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="min-w-0">
              <label className="block text-xs font-medium text-slate-600 mb-1">Empresa</label>
              <SearchableSelect
                value={companyId}
                onChange={setCompanyId}
                placeholder="Seleccione…"
                options={companies.map((c) => ({ value: String(c.id), label: `${c.business_name} (${c.ruc})` }))}
              />
            </div>
            <div className="min-w-0">
              <label className="block text-xs font-medium text-slate-600 mb-1">Fecha de emisión (borrador)</label>
              <input
                type="date"
                value={issueDate}
                onChange={(e) => {
                  setIssueDate(e.target.value);
                }}
                className="w-full px-3 py-2.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500 outline-none"
              />
            </div>
            <div className="min-w-0 sm:col-span-2 lg:col-span-1">
              <label className="block text-xs font-medium text-slate-600 mb-1">Periodo de la liquidación (año-mes)</label>
              <input
                type="month"
                value={liquidationPeriod}
                onChange={(e) => {
                  liquidationPeriodManualRef.current = true;
                  setLiquidationPeriod(e.target.value);
                }}
                className="w-full px-3 py-2.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500 outline-none"
              />
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 pb-2">
            <h3 className="text-sm font-semibold text-slate-800">Líneas de liquidación</h3>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void loadPreview()}
                disabled={loadingPreview || !companyId}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-300 text-xs sm:text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-50"
              >
                {loadingPreview ? <i className="fas fa-spinner fa-spin text-xs" /> : <i className="fas fa-sync-alt text-xs" />}
                Recargar deudas
              </button>
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs sm:text-sm font-medium text-primary-900 bg-primary-50 border border-primary-200 hover:bg-primary-100"
              >
                <i className="fas fa-store text-[10px]" />
                Catálogo
              </button>
              <button
                type="button"
                onClick={addManualLine}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs sm:text-sm font-medium text-primary-800 bg-primary-50 border border-primary-200 hover:bg-primary-100"
              >
                <i className="fas fa-plus text-[10px]" />
                Agregar línea
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 overflow-hidden shadow-sm min-w-0">
            <div className="overflow-x-auto">
              <table className="min-w-full w-full text-sm">
                <thead>
                  <tr className="bg-slate-100/90 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                    <th className="px-3 py-3 w-10 text-center">#</th>
                    <th className="px-3 py-3 whitespace-nowrap">Tipo</th>
                    <th className="px-3 py-3 min-w-[200px]">Descripción</th>
                    <th className="px-3 py-3 whitespace-nowrap w-[9.5rem]">Periodo (AAAA-MM)</th>
                    <th className="px-3 py-3 text-right whitespace-nowrap w-36">Monto (S/)</th>
                    <th className="px-3 py-3 w-14 text-center" aria-label="Acciones" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {lines.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-10 text-center text-slate-500 text-sm">
                        Sin líneas.
                      </td>
                    </tr>
                  ) : (
                    lines.map((l, idx) => (
                      <tr key={l.key} className="hover:bg-slate-50/80 transition-colors">
                        <td className="px-3 py-2.5 text-center text-xs text-slate-400 tabular-nums">{idx + 1}</td>
                        <td className="px-3 py-2.5">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold border ${
                              l.line_type === 'document_ref'
                                ? 'bg-amber-50 text-amber-900 border-amber-200'
                                : 'bg-slate-100 text-slate-800 border-slate-200'
                            }`}
                          >
                            {l.line_type === 'document_ref' ? 'Deuda' : 'Concepto'}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <input
                            type="text"
                            value={l.concept}
                            onChange={(e) => updateLine(l.key, { concept: e.target.value })}
                            className="w-full px-2.5 py-2 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-primary-500/25 focus:border-primary-400 outline-none"
                          />
                        </td>
                        <td className="px-3 py-2.5">
                          <input
                            type="month"
                            value={l.period_ym || liquidationPeriod}
                            onChange={(e) => updateLine(l.key, { period_ym: e.target.value })}
                            className="w-full min-w-[8.5rem] px-2 py-2 rounded-lg border border-slate-200 text-xs tabular-nums focus:ring-2 focus:ring-primary-500/25 focus:border-primary-400 outline-none"
                          />
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center justify-end gap-1 rounded-lg border border-slate-200 bg-white focus-within:ring-2 focus-within:ring-primary-500/25 focus-within:border-primary-400">
                            <span className="pl-2 text-xs font-medium text-slate-500">S/</span>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={l.amount}
                              onChange={(e) => updateLine(l.key, { amount: e.target.value })}
                              className="w-full min-w-0 py-2 pr-2 rounded-r-lg border-0 text-sm text-right tabular-nums outline-none"
                            />
                          </div>
                        </td>
                        <td className="px-2 py-2.5 text-center">
                          <button
                            type="button"
                            onClick={() => removeLine(l.key)}
                            className="inline-flex items-center justify-center w-9 h-9 rounded-lg text-red-600 bg-red-50 border border-red-100 hover:bg-red-100 hover:border-red-200 transition-colors"
                            aria-label="Quitar línea"
                            title="Quitar línea"
                          >
                            <i className="fas fa-trash-alt text-sm" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {lines.length > 0 ? (
            <div className="rounded-xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-4 sm:p-5 space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Resumen de montos</h4>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between gap-4 text-slate-700">
                  <dt className="text-slate-600">Subtotal deudas cargadas</dt>
                  <dd className="font-medium tabular-nums text-slate-900">S/ {formatPEN(totals.subDeudas)}</dd>
                </div>
                <div className="flex justify-between gap-4 text-slate-700">
                  <dt className="text-slate-600">Subtotal líneas agregadas (descripción + monto)</dt>
                  <dd className="font-medium tabular-nums text-slate-900">S/ {formatPEN(totals.subManual)}</dd>
                </div>
                <div className="border-t border-slate-200 pt-3 mt-3 flex justify-between gap-4 items-baseline">
                  <dt className="text-base font-semibold text-slate-800">Total liquidación</dt>
                  <dd className="text-lg font-bold text-primary-800 tabular-nums">S/ {formatPEN(totals.total)}</dd>
                </div>
              </dl>
            </div>
          ) : null}
        </section>

        <section className="space-y-2">
          <label htmlFor="tax-settle-notes" className="block text-sm font-medium text-slate-700">
            Notas
          </label>
          <textarea
            id="tax-settle-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder=""
            className="w-full px-3 py-2.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500 outline-none resize-y min-h-[5rem]"
          />
        </section>

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2 border-t border-slate-100">
          <Link
            to="/tax-settlements"
            className="inline-flex justify-center px-4 py-2.5 rounded-full border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancelar
          </Link>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex justify-center items-center gap-2 px-6 py-2.5 rounded-full bg-primary-600 text-white text-sm font-semibold shadow-sm hover:bg-primary-700 disabled:opacity-50"
          >
            {saving ? <i className="fas fa-spinner fa-spin text-xs" /> : <i className="fas fa-save text-xs" />}
            Guardar borrador
          </button>
        </div>
      </form>

      <ProductPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="Agregar desde catálogo"
        onPick={(p: Product) => {
          const price = productUnitPrice(p);
          setLines((prev) => [
            ...prev,
            {
              key: `p-${p.id}-${Date.now()}`,
              line_type: 'adjustment',
              product_id: p.id,
              concept: productLabel(p),
              amount: price > 0 ? price.toFixed(2) : '',
              period_ym: liquidationPeriod,
            },
          ]);
          setPickerOpen(false);
        }}
      />
    </div>
  );
};

export default TaxSettlementNew;
