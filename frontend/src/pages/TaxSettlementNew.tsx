import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useMatch, useNavigate, useSearchParams } from 'react-router-dom';
import SearchableSelect from '../components/SearchableSelect';
import { companiesService } from '../services/companies';
import { taxSettlementsService } from '../services/taxSettlements';
import { stripLegacyMigrationNotes } from '../utils/documentDebtUi';
import type { Company, SettlementPreviewLine } from '../types/dashboard';
import { auth } from '../services/auth';
import { P } from '../rbac/codes';
import ProductPickerModal, { productLabel, productUnitPrice } from '../components/ProductPickerModal';
import type { Product } from '../services/products';
import SupervisorFiscalDataPanel from '../components/taxSettlements/SupervisorFiscalDataPanel';
import { hasTaxSectionsData } from '../components/taxSettlements/TaxSettlementSectionsSummary';

const pad2 = (n: number) => String(n).padStart(2, '0');
const formatDateInput = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/** YYYY-MM del mes calendario anterior al mes de `d` (hora local). Ej.: 22-abr-2026 → 2026-03. */
function previousMonthYMFromDate(d: Date): string {
  const prev = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  return `${prev.getFullYear()}-${pad2(prev.getMonth() + 1)}`;
}

/** Mes calendario siguiente a `YYYY-MM`. Ej.: 2026-05 → 2026-06; 2026-12 → 2027-01. */
function nextMonthYM(ym: string): string {
  if (!/^\d{4}-\d{2}$/.test(ym)) return ym;
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7));
  if (!Number.isFinite(y) || !Number.isFinite(m)) return ym;
  const d = new Date(y, m - 1 + 1, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

/**
 * Periodo sugerido por línea (productos / conceptos) según ciclo de cobro de la empresa.
 * - fin de mes (`end_month`): mismo mes que el periodo de liquidación (comportamiento histórico).
 * - inicio de mes (`start_month`): mes siguiente al periodo liquidado (servicio facturado corresponde al mes entrante).
 */
function defaultLinePeriodForLiquidation(liquidationYM: string, billingCycle?: string): string {
  const c = (billingCycle ?? '').trim().toLowerCase();
  if (c === 'start_month') {
    return nextMonthYM(liquidationYM);
  }
  return liquidationYM;
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

/** Solo dígitos y un separador decimal (. o ,). */
function sanitizeAmountInput(raw: string): string {
  let out = '';
  let hasSep = false;
  for (const ch of raw) {
    if (ch >= '0' && ch <= '9') {
      out += ch;
      continue;
    }
    if ((ch === '.' || ch === ',') && !hasSep) {
      out += ch;
      hasSep = true;
    }
  }
  return out;
}

function parseLineAmount(raw: string): number {
  const normalized = raw.trim().replace(',', '.');
  if (!normalized) return 0;
  const n = Number(normalized);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}


function formatAmountOnBlur(raw: string): string {
  const t = raw.trim();
  if (!t) return '';
  return parseLineAmount(t).toFixed(2);
}
const CANONICAL_PERIOD_YM = /^\d{4}-\d{2}$/;

function isCanonicalPeriodYm(s: string): boolean {
  return CANONICAL_PERIOD_YM.test((s ?? '').trim());

}

type LineRow = {
  key: string;
  line_type: 'document_ref' | 'tax_manual' | 'adjustment';
  document_id?: number;
  product_id?: number;
  concept: string;
  amount: string;
  /** En modo mes: `AAAA-MM`. En modo manual: texto libre (ej. año). */
  period_ym: string;
  /** false = selector mes; true = texto libre (no usar input type="month"). */
  period_manual?: boolean;
};

const TaxSettlementNew = () => {
  const navigate = useNavigate();
  const editMatch = useMatch('/tax-settlements/:id/edit');
  const editId = editMatch ? Number(editMatch.params.id) : 0;
  const isEdit = Number.isFinite(editId) && editId > 0;
  const [searchParams] = useSearchParams();
  const allowed = useMemo(
    () => auth.hasPermission(isEdit ? P.taxSettlementsUpdate : P.taxSettlementsCreate),
    [isEdit],
  );

  const [loadingEdit, setLoadingEdit] = useState(isEdit);
  const editLoadedRef = useRef(false);

  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [pendingFromClosedCount, setPendingFromClosedCount] = useState(0);
  const [issueDate, setIssueDate] = useState(() => formatDateInput(new Date()));
  const [liquidationPeriod, setLiquidationPeriod] = useState(() => previousMonthYMFromDate(new Date()));
  const liquidationPeriodManualRef = useRef(false);
  const [notes, setNotes] = useState('');
  const [supervisorPdt621Json, setSupervisorPdt621Json] = useState('');
  const [settlementCompany, setSettlementCompany] = useState<Company | null>(null);
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

  const selectedCompany = useMemo(
    () => companies.find((c) => String(c.id) === companyId.trim()),
    [companies, companyId],
  );

  const companyPlanName =
    settlementCompany?.subscription_plan?.name ?? selectedCompany?.subscription_plan?.name ?? '';

  /** Al cambiar la fecha de emisión, sugerir el mes calendario anterior al de esa fecha como periodo liquidado (si el usuario no lo fijó a mano). */
  useEffect(() => {
    if (liquidationPeriodManualRef.current) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(issueDate)) return;
    const [yy, mo, dd] = issueDate.split('-').map((x) => Number(x));
    if (!Number.isFinite(yy) || !Number.isFinite(mo) || !Number.isFinite(dd)) return;
    const d = new Date(yy, mo - 1, dd);
    setLiquidationPeriod(previousMonthYMFromDate(d));
  }, [issueDate]);

  /** Si cambia el periodo cabecera, propagar a líneas que aún coincidían con el periodo sugerido anterior (según ciclo de cobro). */
  useEffect(() => {
    const prev = prevLiquidationPeriodRef.current;
    if (prev === liquidationPeriod) {
      prevLiquidationPeriodRef.current = liquidationPeriod;
      return;
    }
    const bc = selectedCompany?.billing_cycle;
    const prevDefault = defaultLinePeriodForLiquidation(prev, bc);
    const newDefault = defaultLinePeriodForLiquidation(liquidationPeriod, bc);
    setLines((rows) =>
      rows.map((l) => {
        if (l.period_manual) return l;
        if (!l.period_ym || l.period_ym === prevDefault) {
          return { ...l, period_ym: newDefault };
        }
        return l;
      }),
    );
    prevLiquidationPeriodRef.current = liquidationPeriod;
  }, [liquidationPeriod, selectedCompany?.billing_cycle]);

  useEffect(() => {
    const cid = searchParams.get('company_id')?.trim() ?? '';
    if (cid && /^\d+$/.test(cid) && !isEdit) setCompanyId(cid);
  }, [searchParams, isEdit]);

  useEffect(() => {
    if (!isEdit) return;
    let cancelled = false;
    void (async () => {
      try {
        setLoadingEdit(true);
        setError('');
        const ts = await taxSettlementsService.get(editId);
        if (cancelled) return;
        if (ts.status !== 'borrador') {
          setError('Solo se pueden editar liquidaciones en borrador. Use Editar desde el detalle si estaba emitida.');
          return;
        }
        editLoadedRef.current = true;
        setCompanyId(String(ts.company_id));
        setIssueDate((ts.issue_date ?? '').slice(0, 10) || formatDateInput(new Date()));
        setLiquidationPeriod((ts.liquidation_period ?? '').trim() || previousMonthYMFromDate(new Date()));
        liquidationPeriodManualRef.current = true;
        setNotes(ts.notes ?? '');
        setSupervisorPdt621Json((ts.pdt621_json ?? '').trim());
        setSettlementCompany(ts.company ?? null);
        setLines(
          (ts.lines ?? []).map((ln, i) => {
            const pym = (ln.period_ym ?? '').trim();
            const pd = ln.period_date ? String(ln.period_date).slice(0, 10) : '';
            let period_ym = pym;
            let period_manual = false;
            if (!isCanonicalPeriodYm(pym)) {
              if (pym) {
                period_ym = pym;
                period_manual = true;
              } else if (pd.length >= 7) {
                period_ym = pd.slice(0, 7);
              }
            }
            return {
              key: `ln-${ln.id}-${i}`,
              line_type: ln.line_type as LineRow['line_type'],
              document_id: ln.document_id ?? undefined,
              product_id: ln.product_id ?? undefined,
              concept: ln.concept ?? '',
              amount: Number.isFinite(ln.amount) ? ln.amount.toFixed(2) : '',
              period_ym,
              period_manual,
            };
          }),
        );
      } catch {
        if (!cancelled) setError('No se pudo cargar la liquidación para editar');
      } finally {
        if (!cancelled) setLoadingEdit(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isEdit, editId]);

  const loadPreviewForCompany = useCallback(async (id: number, opts?: { silent?: boolean }) => {
    if (!id) return;
    if (!opts?.silent) setError('');
    setLoadingPreview(true);
    try {
      const data: SettlementPreviewLine[] = await taxSettlementsService.preview(id);
      const co = companies.find((c) => c.id === id);
      const ymFallback = defaultLinePeriodForLiquidation(liquidationPeriodRef.current, co?.billing_cycle);
      setLines(
        data.map((row, i) => {
          const ap = (row.accounting_period ?? '').trim();
          let lineYm: string;
          let period_manual = false;
          if (isCanonicalPeriodYm(ap)) {
            lineYm = ap;
          } else if (ap) {
            lineYm = ap;
            period_manual = true;
          } else {
            lineYm = ymFallback;
          }
          return {
            key: `d-${row.document_id}-${i}`,
            line_type: 'document_ref' as const,
            document_id: row.document_id,
            concept: stripLegacyMigrationNotes(row.concept || '') || `Deuda ${row.document_id}`,
            amount: Number.isFinite(row.amount) && row.amount > 0 ? row.amount.toFixed(2) : '',
            period_ym: lineYm,
            period_manual,
          };
        }),
      );
    } catch {
      if (!opts?.silent) setError('No se pudo cargar el saldo de deudas');
    } finally {
      setLoadingPreview(false);
    }
  }, [companies]);

  useEffect(() => {
    if (isEdit) return;
    const id = Number(companyId);
    if (!Number.isFinite(id) || id <= 0) {
      setLines([]);
      setPendingFromClosedCount(0);
      return;
    }
    const t = window.setTimeout(() => {
      void loadPreviewForCompany(id, { silent: true });
      void taxSettlementsService.pendingFromClosed(id).then((r) => setPendingFromClosedCount(r.count)).catch(() => setPendingFromClosedCount(0));
    }, 450);
    return () => window.clearTimeout(t);
  }, [companyId, loadPreviewForCompany, isEdit]);

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
    const pym = defaultLinePeriodForLiquidation(liquidationPeriod, selectedCompany?.billing_cycle);
    setLines((prev) => [
      ...prev,
      {
        key: `manual-${Date.now()}`,
        line_type: 'adjustment',
        concept: '',
        amount: '',
        period_ym: pym,
        period_manual: false,
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
    if (!CANONICAL_PERIOD_YM.test(lp)) {
      setError('Seleccione el periodo de la liquidación (año y mes)');
      return;
    }
    const billingCo = companies.find((c) => c.id === id);
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
      const amountRaw = l.amount.trim();
      if (!amountRaw) {
        setError('Indique el monto de cada línea');
        return;
      }
      const amt = parseLineAmount(amountRaw);
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
      let pym = (l.period_ym || '').trim();
      if (l.period_manual) {
        if (!pym) {
          setError('Complete el periodo en texto en las líneas con «Texto libre» activado');
          return;
        }
        if (pym.length > 64) {
          setError('El periodo manual no puede superar 64 caracteres por línea');
          return;
        }
      } else {
        if (!isCanonicalPeriodYm(pym)) {
          pym = defaultLinePeriodForLiquidation(lp, billingCo?.billing_cycle);
        }
        if (!isCanonicalPeriodYm(pym)) {
          setError('Cada línea en modo mes requiere periodo AAAA-MM');
          return;
        }
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
      if (isEdit) {
        const updated = await taxSettlementsService.update(editId, {
          issue_date: `${issueDate}T12:00:00Z`,
          liquidation_period: lp,
          period_label: periodLabelFromYM(lp) || lp,
          notes: notes.trim(),
          lines: payloadLines,
          ...(supervisorPdt621Json.trim() ? { pdt621_json: supervisorPdt621Json.trim() } : {}),
        });
        window.dispatchEvent(new CustomEvent('miweb:toast', { detail: { type: 'success', message: 'Liquidación actualizada.' } }));
        navigate(`/tax-settlements/${updated.id}`);
        return;
      }
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
        No tiene permiso para {isEdit ? 'editar' : 'crear'} liquidaciones.
      </div>
    );
  }

  if (loadingEdit) {
    return (
      <div className="w-full min-w-0 max-w-full text-slate-500 text-sm py-12 text-center">
        <i className="fas fa-spinner fa-spin mr-2" />
        Cargando liquidación…
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 max-w-full space-y-4 sm:space-y-6">
      <div>
        <Link
          to={isEdit ? `/tax-settlements/${editId}` : '/tax-settlements'}
          className="text-sm text-primary-700 hover:text-primary-800 font-medium"
        >
          ← {isEdit ? 'Volver al detalle' : 'Volver al listado'}
        </Link>
        <h2 className="text-xl font-semibold text-slate-800 mt-2">
          {isEdit ? `Editar liquidación #${editId}` : 'Nueva liquidación'}
        </h2>
        {isEdit ? (
          <p className="mt-1 text-sm text-slate-500">
            Modifique líneas y datos generales. Al guardar se mantiene en borrador; deberá emitir nuevamente.
          </p>
        ) : null}
      </div>

      {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

      {!isEdit && pendingFromClosedCount > 0 ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <i className="fas fa-exclamation-triangle mr-2 text-amber-600" aria-hidden />
          Hay <strong>{pendingFromClosedCount}</strong> deuda(s) pendiente(s) de liquidaciones cerradas anteriores. No se importan automáticamente: después de crear el borrador, incorpórelas desde el detalle de la liquidación.
        </div>
      ) : null}

      {isEdit && hasTaxSectionsData(supervisorPdt621Json) ? (
        <SupervisorFiscalDataPanel pdt621Json={supervisorPdt621Json} />
      ) : null}

      <form
        onSubmit={(e) => void submit(e)}
        className="w-full min-w-0 space-y-8 bg-white rounded-xl border border-slate-200 p-4 sm:p-6 md:p-8 shadow-sm"
      >
        <section className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-2 border-b border-slate-100 pb-2">
            <h3 className="text-sm font-semibold text-slate-800">Datos generales (Finanzas)</h3>
            {isEdit && hasTaxSectionsData(supervisorPdt621Json) ? (
              <p className="text-[11px] text-slate-500">Los montos fiscales del supervisor no se modifican aquí.</p>
            ) : null}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="min-w-0">
              <label className="block text-xs font-medium text-slate-600 mb-1">Empresa</label>
              <SearchableSelect
                value={companyId}
                onChange={setCompanyId}
                placeholder="Seleccione…"
                disabled={isEdit}
                options={companies.map((c) => ({ value: String(c.id), label: `${c.business_name} (${c.ruc})` }))}
              />
              {isEdit ? (
                <p className="mt-1 text-[11px] text-slate-500">La empresa no se puede cambiar al editar un borrador.</p>
              ) : null}
              {companyPlanName ? (
                <p className="mt-1 text-[11px] text-slate-500">
                  Plan: <span className="font-medium text-slate-700">{companyPlanName}</span>
                </p>
              ) : null}
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
              {selectedCompany &&
              String(selectedCompany.billing_cycle ?? '').toLowerCase() === 'start_month' ? (
                <p className="mt-1.5 text-[11px] text-slate-500 leading-snug">
                  Ciclo de cobro <span className="font-medium text-slate-600">inicio de mes</span>: el periodo sugerido en
                  líneas de conceptos/catálogo será el{' '}
                  <span className="font-medium text-slate-700">mes siguiente</span> al periodo liquidado (
                  {defaultLinePeriodForLiquidation(liquidationPeriod, selectedCompany.billing_cycle)}).
                </p>
              ) : selectedCompany ? (
                <p className="mt-1.5 text-[11px] text-slate-500 leading-snug">
                  Ciclo <span className="font-medium text-slate-600">fin de mes</span>: las líneas nuevas usan el mismo
                  periodo que la liquidación.
                </p>
              ) : null}
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 pb-2">
            <h3 className="text-sm font-semibold text-slate-800">Líneas de liquidación (Finanzas)</h3>
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
                    <th className="px-3 py-3 whitespace-nowrap min-w-[14rem] text-left">
                      Periodo{' '}
                      <span className="font-normal text-slate-400 normal-case">(mes · texto libre)</span>
                    </th>
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
                        <td className="px-3 py-2.5 align-middle">
                          <div className="flex flex-nowrap items-center gap-2 min-w-[12rem]">
                            <label
                              className="inline-flex items-center gap-1.5 shrink-0 cursor-pointer select-none text-[11px] text-slate-600"
                              title="Permite escribir el periodo a mano (ej. año) en lugar del selector de mes"
                            >
                              <input
                                type="checkbox"
                                checked={Boolean(l.period_manual)}
                                onChange={(e) => {
                                  const manual = e.target.checked;
                                  const def = defaultLinePeriodForLiquidation(
                                    liquidationPeriod,
                                    selectedCompany?.billing_cycle,
                                  );
                                  updateLine(l.key, {
                                    period_manual: manual,
                                    period_ym: manual
                                      ? isCanonicalPeriodYm(l.period_ym)
                                        ? ''
                                        : (l.period_ym ?? '').trim()
                                      : isCanonicalPeriodYm(l.period_ym)
                                        ? l.period_ym
                                        : def,
                                  });
                                }}
                                className="rounded border-slate-300 text-primary-600 focus:ring-primary-500 h-3.5 w-3.5"
                              />
                              <span className="whitespace-nowrap">Texto libre</span>
                            </label>
                            <div className="flex-1 min-w-0 border-l border-slate-200 pl-2">
                              {l.period_manual ? (
                                <input
                                  type="text"
                                  value={l.period_ym}
                                  onChange={(e) => updateLine(l.key, { period_ym: e.target.value })}
                                  maxLength={64}
                                  placeholder="ej. 2025"
                                  className="w-full px-2 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-800 focus:ring-2 focus:ring-primary-500/25 focus:border-primary-400 outline-none"
                                />
                              ) : (
                                <input
                                  type="month"
                                  value={
                                    isCanonicalPeriodYm(l.period_ym)
                                      ? l.period_ym
                                      : defaultLinePeriodForLiquidation(
                                          liquidationPeriod,
                                          selectedCompany?.billing_cycle,
                                        )
                                  }
                                  onChange={(e) =>
                                    updateLine(l.key, { period_ym: e.target.value, period_manual: false })
                                  }
                                  className="w-full min-w-0 max-w-full px-2 py-1.5 rounded-lg border border-slate-200 text-xs tabular-nums focus:ring-2 focus:ring-primary-500/25 focus:border-primary-400 outline-none"
                                />
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center justify-end gap-1 rounded-lg border border-slate-200 bg-white focus-within:ring-2 focus-within:ring-primary-500/25 focus-within:border-primary-400">
                            <span className="pl-2 text-xs font-medium text-slate-500">S/</span>
                            <input
                              type="text"
                              inputMode="decimal"
                              autoComplete="off"
                              value={l.amount}
                              onChange={(e) => updateLine(l.key, { amount: sanitizeAmountInput(e.target.value) })}
                              onBlur={(e) => updateLine(l.key, { amount: formatAmountOnBlur(e.target.value) })}
                              className="w-full min-w-0 py-2 pr-2 rounded-r-lg border-0 text-sm text-right tabular-nums outline-none [appearance:textfield]"
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
            to={isEdit ? `/tax-settlements/${editId}` : '/tax-settlements'}
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
            {isEdit ? 'Guardar cambios' : 'Guardar borrador'}
          </button>
        </div>
      </form>

      <ProductPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="Agregar desde catálogo"
        onPick={(p: Product) => {
          const price = productUnitPrice(p);
          const pym = defaultLinePeriodForLiquidation(liquidationPeriod, selectedCompany?.billing_cycle);
          setLines((prev) => [
            ...prev,
            {
              key: `p-${p.id}-${Date.now()}`,
              line_type: 'adjustment',
              product_id: p.id,
              concept: productLabel(p),
              amount: price > 0 ? price.toFixed(2) : '',
              period_ym: pym,
              period_manual: false,
            },
          ]);
          setPickerOpen(false);
        }}
      />
    </div>
  );
};

export default TaxSettlementNew;
