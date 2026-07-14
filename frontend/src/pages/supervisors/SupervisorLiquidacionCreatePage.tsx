import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { auth } from '../../services/auth';
import { P } from '../../rbac/codes';
import { PAGE_WORKSPACE_CLASS } from '../../constants/pageLayout';
import { companiesService } from '../../services/companies';
import { companyAccessCredentialsService } from '../../services/companyAccessCredentials';
import { supervisorTaxSettlementsService } from '../../services/supervisorTaxSettlements';
import type { Company } from '../../types/dashboard';
import { extractApiErrorMessage } from '../../utils/apiError';
import SupervisorTaxSectionsForm from '../../components/supervisors/SupervisorTaxSectionsForm';
import LiquidacionIgvAplicableToggle from '../../components/supervisors/LiquidacionIgvAplicableToggle';
import LiquidacionRentaRegimenSelect from '../../components/supervisors/LiquidacionRentaRegimenSelect';
import SupervisorLiquidacionPreviewModal from '../../components/supervisors/SupervisorLiquidacionPreviewModal';
import { TaxSettlementSectionsSummary } from '../../components/taxSettlements/TaxSettlementSectionsSummary';
import {
  defaultLiquidationPeriodYM,
  isValidLiquidationPeriodYM,
  periodLabelFromYM,
  previousMonthYMFromDate,
  settlementStatusBadgeClass,
  settlementStatusLabel,
} from '../../utils/liquidationPeriod';
import {
  clearPdt621IgvRateRows,
  computeTaxSettlementSections,
  defaultTaxSections,
  normalizePdt621IgvVentas,
  parseTaxSectionsJson,
  type TaxSettlementSectionsPayload,
} from '../../utils/taxSettlementSections';
import {
  defaultLiquidationIgvRates,
  formatCompanyIgvRateLabel,
  LIQUIDATION_IGV_RATES,
  parseCompanyIgvRate,
  type CompanyIgvRate,
} from '../../utils/companyIgv';
import {
  defaultLiquidationRentaRegime,
  formatLiquidationRentaRegimeLabel,
  formatRentaRateLabel,
  getRentaMensualRatePct,
  parseCompanyTaxRegime,
  type CompanyTaxRegime,
  type LiquidationRentaRegime,
} from '../../utils/companyTaxRegime';

const pad2 = (n: number) => String(n).padStart(2, '0');
const formatDateInput = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

function issueDateFromSettlement(raw?: string): string {
  if (!raw) return formatDateInput(new Date());
  if (raw.length >= 10) return raw.slice(0, 10);
  return raw;
}

function focusNextEditableFormInput(form: HTMLFormElement, current: HTMLInputElement) {
  const focusables = Array.from(
    form.querySelectorAll<HTMLInputElement>(
      'input:not([disabled]):not([type="hidden"]):not([type="checkbox"]):not([type="submit"]):not([type="button"]):not([readonly])'
    )
  ).filter((el) => el.getClientRects().length > 0);

  const idx = focusables.indexOf(current);
  if (idx < 0 || idx >= focusables.length - 1) return;
  const next = focusables[idx + 1];
  next.focus();
  if (next.type === 'text' || next.type === 'number') {
    next.select();
  }
}

function handleLiquidacionFormEnterKey(e: React.KeyboardEvent<HTMLFormElement>) {
  if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
  const target = e.target;
  if (!(target instanceof HTMLInputElement)) return;
  if (['submit', 'button', 'checkbox', 'hidden', 'file'].includes(target.type)) return;
  e.preventDefault();
  focusNextEditableFormInput(e.currentTarget, target);
}

const SupervisorLiquidacionCreatePage = () => {
  const { companyId: companyIdParam, settlementId: settlementIdParam } = useParams();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const settlementId = settlementIdParam ? Number(settlementIdParam) : null;
  const isView = location.pathname.includes('/liquidaciones/ver/');
  const isEdit = location.pathname.includes('/liquidaciones/editar/');
  const companyIdFromRoute = companyIdParam ? Number(companyIdParam) : null;
  const navigate = useNavigate();
  const canView = useMemo(() => auth.hasPermission(P.supervisorsLiquidationsView), []);
  const canCreate = useMemo(() => auth.hasPermission(P.supervisorsLiquidationsCreate), []);
  const canUpdate = useMemo(() => auth.hasPermission(P.supervisorsLiquidationsUpdate), []);
  const canSubmit = !isView && (isEdit ? canUpdate : canCreate);
  const periodFromList = useMemo(() => {
    const raw = (searchParams.get('period') ?? '').trim();
    return isValidLiquidationPeriodYM(raw) ? raw : '';
  }, [searchParams]);
  const listBackTo = `/supervisors/liquidaciones${periodFromList ? `?period=${encodeURIComponent(periodFromList)}` : ''}`;

  const [companyId, setCompanyId] = useState<number | null>(companyIdFromRoute);
  const [company, setCompany] = useState<Company | null>(null);
  const [assistantName, setAssistantName] = useState('—');
  const [loadingCompany, setLoadingCompany] = useState(true);
  const [issueDate, setIssueDate] = useState(() => formatDateInput(new Date()));
  const [liquidationPeriod, setLiquidationPeriod] = useState(() => periodFromList || defaultLiquidationPeriodYM());
  const liquidationPeriodManualRef = useRef(Boolean(periodFromList));
  const [settlementStatus, setSettlementStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [error, setError] = useState('');
  const [taxSections, setTaxSections] = useState<TaxSettlementSectionsPayload>(() => defaultTaxSections(new Date().getFullYear()));
  const [settlementNumber, setSettlementNumber] = useState('');
  const currentYear = new Date().getFullYear();
  const companyIgvRate = useMemo(() => parseCompanyIgvRate(company?.igv_rate), [company?.igv_rate]);
  const companyTaxRegime = useMemo((): CompanyTaxRegime => parseCompanyTaxRegime(company?.tax_regime) ?? 'mype', [company?.tax_regime]);
  const igvConfigured = companyIgvRate != null;
  const companyFiscalInitializedRef = useRef(false);

  useEffect(() => {
    if (!companyIgvRate || companyFiscalInitializedRef.current) return;
    companyFiscalInitializedRef.current = true;
    setTaxSections((prev) => {
      const base621 = prev.pdt621 ?? defaultTaxSections(currentYear).pdt621!;
      const normalized = normalizePdt621IgvVentas(
        {
          ...base621,
          igv_aplicable_ventas: base621.igv_aplicable_ventas?.length
            ? base621.igv_aplicable_ventas
            : defaultLiquidationIgvRates(companyIgvRate),
          renta_regimen: base621.renta_regimen ?? defaultLiquidationRentaRegime(companyTaxRegime),
          renta_coeficiente_pct: base621.renta_coeficiente_pct ?? 0,
        },
        companyIgvRate,
      );
      return computeTaxSettlementSections({ ...prev, pdt621: normalized });
    });
  }, [companyIgvRate, companyTaxRegime, currentYear]);

  const taxSectionsComputed = useMemo(() => computeTaxSettlementSections(taxSections), [taxSections]);
  const igvAplicableVentas = useMemo((): CompanyIgvRate[] => {
    const rates = taxSectionsComputed.pdt621?.igv_aplicable_ventas;
    if (rates?.length) return rates;
    return companyIgvRate ? defaultLiquidationIgvRates(companyIgvRate) : [18];
  }, [taxSectionsComputed.pdt621?.igv_aplicable_ventas, companyIgvRate]);

  const patchIgvAplicableVentas = (nextRates: CompanyIgvRate[]) => {
    if (!companyIgvRate) return;
    setTaxSections((prev) => {
      const base621 = prev.pdt621 ?? defaultTaxSections(currentYear).pdt621!;
      let next621: TaxSettlementSectionsPayload['pdt621'] = {
        ...normalizePdt621IgvVentas(base621, companyIgvRate),
        igv_aplicable_ventas: nextRates,
      };
      for (const rate of LIQUIDATION_IGV_RATES) {
        if (!nextRates.includes(rate)) {
          next621 = clearPdt621IgvRateRows(next621, rate);
        }
      }
      return computeTaxSettlementSections({ ...prev, pdt621: next621 });
    });
  };

  const rentaRegimen = useMemo((): LiquidationRentaRegime => {
    const r = taxSectionsComputed.pdt621?.renta_regimen;
    return r ?? defaultLiquidationRentaRegime(companyTaxRegime);
  }, [taxSectionsComputed.pdt621?.renta_regimen, companyTaxRegime]);

  const rentaCoeficientePct = taxSectionsComputed.pdt621?.renta_coeficiente_pct ?? 0;

  const numeroTrabajadores = taxSectionsComputed.numero_trabajadores ?? 0;

  const patchNumeroTrabajadores = (n: number) => {
    const safe = Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
    setTaxSections((prev) => computeTaxSettlementSections({ ...prev, numero_trabajadores: safe }));
  };

  const patchRentaRegimen = (regimen: LiquidationRentaRegime) => {
    setTaxSections((prev) => {
      const base621 = prev.pdt621 ?? defaultTaxSections(currentYear).pdt621!;
      return computeTaxSettlementSections({
        ...prev,
        pdt621: {
          ...base621,
          renta_regimen: regimen,
          renta_coeficiente_pct: regimen === 'coeficiente' ? base621.renta_coeficiente_pct ?? 0 : 0,
        },
      });
    });
  };

  const patchRentaCoeficiente = (pct: number) => {
    setTaxSections((prev) => {
      const base621 = prev.pdt621 ?? defaultTaxSections(currentYear).pdt621!;
      return computeTaxSettlementSections({
        ...prev,
        pdt621: { ...base621, renta_coeficiente_pct: pct },
      });
    });
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        setLoadingCompany(true);
        setError('');

        let coId: number;
        if ((isEdit || isView) && settlementId) {
          const settlement = await supervisorTaxSettlementsService.get(settlementId);
          if (cancelled) return;
          if (!isView && settlement.status !== 'borrador') {
            setError('Esta liquidación ya no está en borrador y no puede editarse desde Supervisores.');
            setCompany(null);
            return;
          }
          coId = settlement.company_id;
          setCompanyId(coId);
          setSettlementNumber(settlement.number || `#${settlement.id}`);
          setSettlementStatus(settlement.status || '');
          setIssueDate(issueDateFromSettlement(settlement.issue_date));
          setLiquidationPeriod(settlement.liquidation_period || defaultLiquidationPeriodYM());
          liquidationPeriodManualRef.current = true;
          const parsed = parseTaxSectionsJson(settlement.pdt621_json);
          if (parsed) {
            setTaxSections({
              version: parsed.version,
              pdt621: parsed.pdt621,
              pdt601: parsed.pdt601,
              itan: parsed.itan,
              pdt617: parsed.pdt617,
              bolsas_plasticas: parsed.bolsas_plasticas,
              pdt710: parsed.pdt710,
              grand_total_impuesto_a_pagar: parsed.grand_total_impuesto_a_pagar,
            });
          }
        } else if (Number.isFinite(companyIdFromRoute) && companyIdFromRoute && companyIdFromRoute > 0) {
          coId = companyIdFromRoute;
          setCompanyId(coId);
        } else {
          setError('Empresa inválida');
          setCompany(null);
          return;
        }

        const [co, cred] = await Promise.all([
          companiesService.get(coId),
          companyAccessCredentialsService.get(coId).catch(() => null),
        ]);
        if (cancelled) return;
        setCompany(co);
        setAssistantName(
          co.assistant?.name?.trim() ||
            co.assistant?.username?.trim() ||
            cred?.assistant_username?.trim() ||
            '—',
        );
      } catch (err) {
        if (!cancelled) {
          setError(extractApiErrorMessage(err, isEdit ? 'No se pudo cargar la liquidación.' : 'No se pudo cargar la empresa.'));
          setCompany(null);
        }
      } finally {
        if (!cancelled) setLoadingCompany(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [companyIdFromRoute, isEdit, isView, settlementId]);

  useEffect(() => {
    if (isEdit || isView || liquidationPeriodManualRef.current) return;
    const raw = (searchParams.get('period') ?? '').trim();
    if (isValidLiquidationPeriodYM(raw)) {
      setLiquidationPeriod(raw);
      liquidationPeriodManualRef.current = true;
    }
  }, [isEdit, isView, searchParams]);

  useEffect(() => {
    if (isEdit) return;
    if (liquidationPeriodManualRef.current) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(issueDate)) return;
    const [yy, mo, dd] = issueDate.split('-').map((x) => Number(x));
    if (!Number.isFinite(yy) || !Number.isFinite(mo) || !Number.isFinite(dd)) return;
    const d = new Date(yy, mo - 1, dd);
    setLiquidationPeriod(previousMonthYMFromDate(d));
  }, [issueDate, isEdit]);

  const saveLiquidacion = async () => {
    if (!company || !companyId || companyId <= 0) return false;
    if (!companyIgvRate) {
      setError('Configure el IGV de la empresa antes de guardar la liquidación.');
      return false;
    }
    if (rentaRegimen === 'coeficiente' && rentaCoeficientePct <= 0) {
      setError('Indique el porcentaje de coeficiente para calcular la renta mensual.');
      return false;
    }
    const lp = liquidationPeriod.trim();
    if (!/^\d{4}-\d{2}$/.test(lp)) {
      setError('Indique un periodo válido (AAAA-MM)');
      return false;
    }
    setError('');
    setSaving(true);
    try {
      const payload = {
        issue_date: `${issueDate}T12:00:00Z`,
        liquidation_period: lp,
        period_label: periodLabelFromYM(lp) || lp,
        tax_sections: taxSectionsComputed,
      };
      if (isEdit && settlementId) {
        const updated = await supervisorTaxSettlementsService.update(settlementId, payload);
        window.dispatchEvent(
          new CustomEvent('miweb:toast', {
            detail: {
              type: 'success',
              message: `Liquidación ${updated.number || `#${updated.id}`} actualizada.`,
            },
          }),
        );
      } else {
        const created = await supervisorTaxSettlementsService.create({
          company_id: companyId,
          ...payload,
        });
        window.dispatchEvent(
          new CustomEvent('miweb:toast', {
            detail: {
              type: 'success',
              message: `Liquidación ${created.number || `#${created.id}`} creada en borrador. Finanzas puede continuar el proceso.`,
            },
          }),
        );
      }
      setPreviewOpen(false);
      navigate(listBackTo);
      return true;
    } catch (err) {
      setError(extractApiErrorMessage(err, isEdit ? 'No se pudo actualizar la liquidación.' : 'No se pudo crear la liquidación.'));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    await saveLiquidacion();
  };

  const periodLabelPreview = useMemo(
    () => periodLabelFromYM(liquidationPeriod.trim()) || liquidationPeriod,
    [liquidationPeriod],
  );

  if (isView && !canView) {
    return (
      <div className={PAGE_WORKSPACE_CLASS}>
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-sm">
          No tiene permiso para visualizar liquidaciones.
        </div>
      </div>
    );
  }

  if (!isView && !canSubmit) {
    return (
      <div className={PAGE_WORKSPACE_CLASS}>
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-sm">
          No tiene permiso para {isEdit ? 'editar' : 'crear'} liquidaciones.
        </div>
      </div>
    );
  }

  if (loadingCompany) {
    return (
      <div className={`${PAGE_WORKSPACE_CLASS} text-center text-slate-500 text-sm py-12`}>
        <i className="fas fa-spinner fa-spin mr-2" aria-hidden />
        Cargando…
      </div>
    );
  }

  if (!company) {
    return (
      <div className={PAGE_WORKSPACE_CLASS}>
        <Link to={listBackTo} className="text-sm text-primary-700 hover:text-primary-800 font-medium">
          ← Volver al listado
        </Link>
        <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
          {error || 'Empresa no encontrada o sin acceso.'}
        </div>
      </div>
    );
  }

  return (
    <div className={`${PAGE_WORKSPACE_CLASS} w-full min-w-0 max-w-full`}>
      <div>
        <Link to={listBackTo} className="text-sm text-primary-700 hover:text-primary-800 font-medium">
          ← Volver al listado
        </Link>
        <h1 className="text-2xl font-bold text-slate-800 tracking-tight mt-2">
          {isView ? 'Ver liquidación' : isEdit ? 'Editar liquidación' : 'Crear liquidación'}
        </h1>
        <p className="text-slate-500 mt-1 text-sm max-w-3xl">
          {isView ? (
            <>
              Liquidación{' '}
              <span className="font-medium text-slate-700">{settlementNumber}</span> de{' '}
              <span className="font-medium text-slate-700">{company.business_name}</span> en modo solo lectura.
              {settlementStatus ? (
                <>
                  {' '}
                  Estado:{' '}
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-md border text-[11px] font-medium align-middle ${settlementStatusBadgeClass(settlementStatus)}`}
                  >
                    {settlementStatusLabel(settlementStatus)}
                  </span>
                </>
              ) : null}
            </>
          ) : isEdit ? (
            <>
              Actualice la información fiscal de la liquidación{' '}
              <span className="font-medium text-slate-700">{settlementNumber}</span> para{' '}
              <span className="font-medium text-slate-700">{company.business_name}</span>. Solo editable mientras esté
              en borrador.
            </>
          ) : (
            <>
              Registro inicial para <span className="font-medium text-slate-700">{company.business_name}</span>. Indique
              fecha, periodo y las secciones fiscales que correspondan; Finanzas completará deudas y emisión.
            </>
          )}
        </p>
      </div>

      {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

      <section className="w-full min-w-0 bg-white rounded-xl border border-slate-200 shadow-sm p-4 sm:p-5 md:p-6">
        <h2 className="text-sm font-semibold text-slate-800">Empresa</h2>
        <dl className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-4 lg:gap-6 text-sm">
          <div className="min-w-0 sm:col-span-2 lg:col-span-5">
            <dt className="text-xs font-medium text-slate-500 uppercase tracking-wide">Razón social</dt>
            <dd className="mt-1 font-medium text-slate-800 leading-snug">{company.business_name}</dd>
          </div>
          <div className="min-w-0 lg:col-span-2">
            <dt className="text-xs font-medium text-slate-500 uppercase tracking-wide">RUC</dt>
            <dd className="mt-1 font-mono text-slate-800">{company.ruc || '—'}</dd>
          </div>
          <div className="min-w-0 lg:col-span-2">
            <dt className="text-xs font-medium text-slate-500 uppercase tracking-wide">Código interno</dt>
            <dd className="mt-1 font-mono text-slate-800">{company.code || '—'}</dd>
          </div>
          <div className="min-w-0 sm:col-span-2 lg:col-span-3">
            <dt className="text-xs font-medium text-slate-500 uppercase tracking-wide">Asistente asignado</dt>
            <dd className="mt-1 text-slate-800">{assistantName}</dd>
          </div>
        </dl>

        {igvConfigured && companyIgvRate ? (
          <div className="mt-5 pt-5 border-t border-slate-100 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 lg:gap-8">
            <div className="min-w-0">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">IGV aplicable</p>
              <div className="mt-2">
                {isView ? (
                  <p className="text-sm text-slate-800">
                    {igvAplicableVentas.map((r) => formatCompanyIgvRateLabel(r)).join(' · ') || '—'}
                  </p>
                ) : (
                  <LiquidacionIgvAplicableToggle
                    rates={igvAplicableVentas}
                    companyIgvRate={companyIgvRate}
                    onChange={patchIgvAplicableVentas}
                  />
                )}
              </div>
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Régimen renta</p>
              <div className="mt-2">
                {isView ? (
                  <p className="text-sm text-slate-800">
                    {formatLiquidationRentaRegimeLabel(rentaRegimen)}
                    {' · '}
                    {formatRentaRateLabel(getRentaMensualRatePct(rentaRegimen, rentaCoeficientePct, companyTaxRegime))}
                  </p>
                ) : (
                  <LiquidacionRentaRegimenSelect
                    regimen={rentaRegimen}
                    companyTaxRegime={companyTaxRegime}
                    coeficientePct={rentaCoeficientePct}
                    onRegimenChange={patchRentaRegimen}
                    onCoeficienteChange={patchRentaCoeficiente}
                  />
                )}
              </div>
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">N° de trabajadores</p>
              <div className="mt-2">
                {isView ? (
                  <p className="text-sm text-slate-800">{numeroTrabajadores}</p>
                ) : (
                  <input
                    type="number"
                    min={0}
                    step={1}
                    inputMode="numeric"
                    value={numeroTrabajadores === 0 ? '' : numeroTrabajadores}
                    onChange={(e) => patchNumeroTrabajadores(Number(e.target.value))}
                    placeholder="0"
                    className="w-full max-w-xs px-3 py-2 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500 outline-none bg-white"
                    aria-label="Número de trabajadores"
                  />
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-5 pt-5 border-t border-slate-100">
            <p className="text-sm text-slate-600">IGV aplicable: <span className="text-slate-800">Sin configurar</span></p>
          </div>
        )}
      </section>

      {!igvConfigured ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-950">
          <p className="font-medium">Esta empresa no tiene IGV configurado.</p>
          <p className="mt-1 text-amber-900/90">
            Debe registrar la tasa IGV en los datos de la empresa antes de guardar la liquidación.
          </p>
          <Link
            to={`/companies/${company.id}/edit`}
            className="inline-flex items-center gap-1.5 mt-3 text-sm font-semibold text-primary-800 hover:text-primary-900 underline-offset-2 hover:underline"
          >
            <i className="fas fa-building text-xs" aria-hidden />
            Configurar IGV en la empresa
          </Link>
        </div>
      ) : null}

      {isView ? (
        <section className="w-full min-w-0 bg-white rounded-xl border border-slate-200 shadow-sm p-4 sm:p-5 md:p-6 space-y-5">
          <h2 className="text-sm font-semibold text-slate-800 border-b border-slate-100 pb-2">Datos de la liquidación</h2>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:max-w-2xl text-sm">
            <div>
              <dt className="text-xs font-medium text-slate-500">Fecha de emisión</dt>
              <dd className="mt-1 text-slate-800">{issueDate}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-500">Periodo liquidado</dt>
              <dd className="mt-1 text-slate-800">
                {periodLabelPreview} <span className="font-mono text-slate-500">({liquidationPeriod})</span>
              </dd>
            </div>
          </dl>
          {igvConfigured ? (
            <div className="pt-4 border-t border-slate-100">
              <TaxSettlementSectionsSummary sections={taxSectionsComputed} />
            </div>
          ) : null}
          <div className="pt-2 border-t border-slate-100">
            <Link
              to={listBackTo}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Volver al listado
            </Link>
          </div>
        </section>
      ) : (
      <form
        onSubmit={(e) => void submit(e)}
        onKeyDown={handleLiquidacionFormEnterKey}
        className="w-full min-w-0 bg-white rounded-xl border border-slate-200 shadow-sm p-4 sm:p-5 md:p-6 space-y-5"
      >
        <h2 className="text-sm font-semibold text-slate-800 border-b border-slate-100 pb-2">Datos de la liquidación</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:max-w-2xl">
          <div className="min-w-0">
            <label className="block text-xs font-medium text-slate-600 mb-1" htmlFor="sup-liq-issue-date">
              Fecha de emisión
            </label>
            <input
              id="sup-liq-issue-date"
              type="date"
              value={issueDate}
              onChange={(e) => setIssueDate(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500 outline-none"
              required
            />
          </div>
          <div className="min-w-0">
            <label className="block text-xs font-medium text-slate-600 mb-1" htmlFor="sup-liq-period">
              Periodo de la liquidación (año-mes)
            </label>
            <input
              id="sup-liq-period"
              type="month"
              value={liquidationPeriod}
              onChange={(e) => {
                liquidationPeriodManualRef.current = true;
                setLiquidationPeriod(e.target.value);
              }}
              className="w-full px-3 py-2.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500 outline-none"
              required
            />
            {!isEdit ? (
              <p className="mt-1.5 text-[11px] text-slate-500 leading-snug max-w-md">
                Al cambiar la fecha de emisión se sugiere el mes calendario anterior como periodo liquidado, salvo que
                lo modifique manualmente.
              </p>
            ) : null}
          </div>
        </div>

        {igvConfigured ? (
          <div className="pt-4 border-t border-slate-100 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">Secciones fiscales</h3>
              <p className="text-xs text-slate-500 mt-1">
                Active solo las secciones que va a registrar. En ventas y notas de crédito puede elegir IGV al 18 % y/o
                10.5 % (por defecto el de la empresa); las compras se calculan al 10.5 % o 18 % según corresponda.
              </p>
            </div>
            <SupervisorTaxSectionsForm
              value={taxSections}
              onChange={setTaxSections}
              currentYear={currentYear}
              companyIgvRate={companyIgvRate}
              companyTaxRegime={companyTaxRegime}
              igvAplicableVentas={igvAplicableVentas}
              rentaRegimen={rentaRegimen}
            />
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-slate-100">
          <button
            type="submit"
            disabled={saving || !igvConfigured}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
          >
            {saving ? <i className="fas fa-spinner fa-spin text-xs" aria-hidden /> : null}
            {isEdit ? 'Guardar cambios' : 'Crear liquidación'}
          </button>
          <button
            type="button"
            disabled={saving || !igvConfigured}
            onClick={() => setPreviewOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-primary-200 bg-primary-50 text-primary-800 text-sm font-medium hover:bg-primary-100 disabled:opacity-50"
          >
            <i className="fas fa-eye text-xs" aria-hidden />
            Vista previa
          </button>
          <Link
            to={listBackTo}
            className="px-4 py-2.5 rounded-lg border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancelar
          </Link>
        </div>
      </form>
      )}

      {!isView && company && igvConfigured && companyIgvRate ? (
        <SupervisorLiquidacionPreviewModal
          open={previewOpen}
          saving={saving}
          isEdit={isEdit}
          company={company}
          issueDate={issueDate}
          liquidationPeriod={liquidationPeriod}
          periodLabel={periodLabelPreview}
          igvAplicableVentas={igvAplicableVentas}
          rentaRegimen={rentaRegimen}
          rentaCoeficientePct={rentaCoeficientePct}
          companyTaxRegime={companyTaxRegime}
          taxSections={taxSectionsComputed}
          onClose={() => setPreviewOpen(false)}
          onSave={() => void saveLiquidacion()}
        />
      ) : null}
    </div>
  );
};

export default SupervisorLiquidacionCreatePage;
