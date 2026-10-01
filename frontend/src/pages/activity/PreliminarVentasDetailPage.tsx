import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { saveAs } from 'file-saver';
import {
  preliminarVentasStatusBadgeClass,
  preliminarVentasStatusLabel,
} from '../../components/activity/preliminarVentasConfig';
import LiquidacionIgvAplicableToggle from '../../components/supervisors/LiquidacionIgvAplicableToggle';
import Button from '../../components/ui/Button';
import MoneyField from '../../components/ui/MoneyField';
import { PAGE_WORKSPACE_CLASS } from '../../constants/pageLayout';
import { activitiesBasePath, workspaceHomePath, type ActivityWorkspace } from '../../navigation/activityRoutes';
import { auth } from '../../services/auth';
import { P } from '../../rbac/codes';
import { configService } from '../../services/config';
import {
  preliminarVentasService,
  type PreliminarVentasRecordInput,
  type PreliminarVentasSlotDetail,
} from '../../services/preliminarVentas';
import { generatePreliminarVentasPdfBlob, preliminarVentasPdfFilename } from '../../pdf/preliminarVentasPdf';
import { loadLogoPngBlobForPdf } from '../../utils/pdfLogo';
import { previousMonthPeriodYM } from '../../utils/supervisorLabels';
import { extractApiErrorMessage } from '../../utils/apiError';
import type { CompanyIgvRate } from '../../utils/companyIgv';

const EMPTY_RECORD: PreliminarVentasRecordInput = {
  igv_aplicable_18: true,
  igv_aplicable_105: false,
  facturas_base_18: 0,
  facturas_no_gravadas_18: 0,
  facturas_base_105: 0,
  facturas_no_gravadas_105: 0,
  boletas_base_18: 0,
  boletas_no_gravadas_18: 0,
  boletas_base_105: 0,
  boletas_no_gravadas_105: 0,
  notas_credito_base_18: 0,
  notas_credito_no_gravadas_18: 0,
  notas_credito_base_105: 0,
  notas_credito_no_gravadas_105: 0,
  compras_base: 0,
  credito_periodo_anterior_override: null,
  retencion_monto: 0,
  percepcion_monto: 0,
};

/** Concepto de Ventas × tasa IGV → las 2 keys editables (base/no gravadas) de ese par en
 * PreliminarVentasRecordInput — misma separación _18/_105 que usa Liquidación (ver
 * frontend/src/utils/companyIgv.ts, taxSettlementSections.ts). */
type VentasFieldPair = { baseKey: keyof PreliminarVentasRecordInput; noGravKey: keyof PreliminarVentasRecordInput };
const VENTAS_CONCEPTS: { label: string; fields: (rate: CompanyIgvRate) => VentasFieldPair }[] = [
  {
    label: 'Facturas Emitidas',
    fields: (rate) =>
      rate === 10.5
        ? { baseKey: 'facturas_base_105', noGravKey: 'facturas_no_gravadas_105' }
        : { baseKey: 'facturas_base_18', noGravKey: 'facturas_no_gravadas_18' },
  },
  {
    label: 'Boletas Emitidas',
    fields: (rate) =>
      rate === 10.5
        ? { baseKey: 'boletas_base_105', noGravKey: 'boletas_no_gravadas_105' }
        : { baseKey: 'boletas_base_18', noGravKey: 'boletas_no_gravadas_18' },
  },
  {
    label: '(-) Notas de Crédito',
    fields: (rate) =>
      rate === 10.5
        ? { baseKey: 'notas_credito_base_105', noGravKey: 'notas_credito_no_gravadas_105' }
        : { baseKey: 'notas_credito_base_18', noGravKey: 'notas_credito_no_gravadas_18' },
  },
];

const FIELD_INPUT =
  'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm text-right outline-none focus:ring-2 focus:ring-primary-500 disabled:bg-slate-50 disabled:text-slate-500';

/** Redondeo "half away from zero" — igual criterio que math.Round en Go (el backend usa esa misma
 * regla), a diferencia de Math.round de JS que en negativos redondea hacia +Infinito. */
function roundHalfAwayFromZero(v: number): number {
  return v >= 0 ? Math.round(v) : -Math.round(-v);
}
function round2(v: number): number {
  return v >= 0 ? Math.round(v * 100) / 100 : -Math.round(-v * 100) / 100;
}

type LocalVentasRow = {
  key: string;
  label: string;
  baseKey: keyof PreliminarVentasRecordInput;
  noGravKey: keyof PreliminarVentasRecordInput;
  base: number;
  noGravadas: number;
  igv: number;
  total: number;
};

type LocalSummary = {
  rows: LocalVentasRow[];
  totalRow: { label: string; base: number; noGravadas: number; igv: number; total: number };
  ratesAplicables: CompanyIgvRate[];
  igvResultante: number;
  igvAPagar: number;
  montoAproximadoIgv?: number;
  comprasIgv: number;
  comprasTotal: number;
  montoAproximadoRenta: number;
};

/** Recalcula Ventas/Compras/IGV/Renta EN VIVO en el navegador, en cada cambio del formulario — antes
 * de este cambio, la tabla dependía del último `summary` que mandó el backend (que solo se
 * actualiza al guardar), así que activar "ambos" en el selector de tasas no mostraba los 6 campos
 * hasta el siguiente Guardar (reportado por el usuario). Replica exactamente las mismas fórmulas que
 * computePreliminarVentasSummary en el backend (services/supervisor_preliminar_ventas_service.go) —
 * el Guardar sigue siendo la fuente de verdad que persiste y recalcula "oficialmente", esto solo
 * evita la espera para VER los campos/importes correctos mientras se edita. credito_periodo_anterior
 * (automático o el override del usuario) y renta_rate_pct no dependen de la tasa de IGV elegida, así
 * que se toman tal cual del último summary del backend en vez de recalcularse acá.
 */
function computeLocalVentasSummary(
  record: PreliminarVentasRecordInput,
  companyIgvRate: CompanyIgvRate,
  rentaRatePct: number,
  creditoEfectivo: number,
): LocalSummary {
  const selected: CompanyIgvRate[] = [
    ...(record.igv_aplicable_18 ? ([18] as CompanyIgvRate[]) : []),
    ...(record.igv_aplicable_105 ? ([10.5] as CompanyIgvRate[]) : []),
  ];
  const rates: CompanyIgvRate[] = selected.length ? selected : [companyIgvRate];
  const multiRate = rates.length > 1;

  const rows: LocalVentasRow[] = [];
  let totalBase = 0;
  let totalNoGravadas = 0;
  let totalIgv = 0;
  for (const rate of rates) {
    for (const concept of VENTAS_CONCEPTS) {
      const { baseKey, noGravKey } = concept.fields(rate);
      const base = Number(record[baseKey] ?? 0);
      const noGravadas = Number(record[noGravKey] ?? 0);
      const igv = round2((base * rate) / 100);
      const total = round2(base + noGravadas + igv);
      const sign = concept.label.startsWith('(-)') ? -1 : 1;
      totalBase += sign * base;
      totalNoGravadas += sign * noGravadas;
      totalIgv += sign * igv;
      rows.push({
        key: `${baseKey}`,
        label: multiRate ? `${concept.label} (${rate === 10.5 ? '10.5%' : '18%'})` : concept.label,
        baseKey,
        noGravKey,
        base,
        noGravadas,
        igv,
        total,
      });
    }
  }
  totalBase = round2(totalBase);
  totalNoGravadas = round2(totalNoGravadas);
  totalIgv = round2(totalIgv);
  const totalTotal = round2(totalBase + totalNoGravadas + totalIgv);

  const igvResultante = roundHalfAwayFromZero(totalIgv);
  // Retención/percepción restan igual que el crédito del período anterior — si el resultado da
  // negativo es saldo a favor (crédito fiscal), no "a pagar" (oculta la sección Compras más abajo).
  const retencionMonto = Number(record.retencion_monto ?? 0);
  const percepcionMonto = Number(record.percepcion_monto ?? 0);
  const igvAPagar = round2(igvResultante - creditoEfectivo - retencionMonto - percepcionMonto);
  const montoAproximadoIgv = igvAPagar > 0 ? roundHalfAwayFromZero(igvAPagar) : undefined;

  const comprasBase = Number(record.compras_base ?? 0);
  const comprasIgv = round2((comprasBase * companyIgvRate) / 100);
  const comprasTotal = round2(comprasBase + comprasIgv);

  const rentaBaseRaw = Math.max(totalBase + totalNoGravadas, 0);
  const rentaBase = round2(rentaBaseRaw);
  const montoAproximadoRenta =
    rentaRatePct > 0 && rentaBase > 0 ? roundHalfAwayFromZero(round2((rentaBase * rentaRatePct) / 100)) : 0;

  return {
    rows,
    totalRow: { label: 'TOTAL VENTAS', base: totalBase, noGravadas: totalNoGravadas, igv: totalIgv, total: totalTotal },
    ratesAplicables: rates,
    igvResultante,
    igvAPagar,
    montoAproximadoIgv,
    comprasIgv,
    comprasTotal,
    montoAproximadoRenta,
  };
}

function formatMoney(n: number | undefined): string {
  return (n ?? 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(iso?: string): string {
  if (!iso) return 'sin fecha configurada';
  // El backend manda un time.Time de Go serializado en RFC3339 completo (con hora/offset), no una
  // fecha suelta — parsearlo directo, sin concatenarle "Txx:xx:xx" (eso lo dejaba inválido).
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'sin fecha configurada';
  return d.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatDateTime(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

type PreliminarVentasDetailPageProps = {
  workspace: ActivityWorkspace;
};

// Formulario simple (a diferencia de PDT 621: acá solo hay Ventas + Compras, sin IGV/Renta
// registrados a mano — se calculan solos, ver PreliminarVentasSummary en el backend). Módulo
// independiente de Liquidación: no se convierte en una ni la reemplaza. El estudio envía el
// Preliminar de Ventas 2 veces al mes — esta página edita UNA entrega puntual (slotIndex 1 o 2).
const PreliminarVentasDetailPage = ({ workspace }: PreliminarVentasDetailPageProps) => {
  const { companyId: companyIdParam, slotIndex: slotIndexParam } = useParams();
  const companyId = Number(companyIdParam);
  const slotIndex = Number(slotIndexParam) === 2 ? 2 : 1;
  const [searchParams] = useSearchParams();
  const periodYm = searchParams.get('period_ym') || previousMonthPeriodYM();
  const listPath = `${activitiesBasePath(workspace)}/preliminar-ventas?period_ym=${encodeURIComponent(periodYm)}`;
  const homePath = workspaceHomePath(workspace);

  const canUpdate = useMemo(() => auth.hasPermission(P.supervisorsDeclarationsUpdate), []);

  const [detail, setDetail] = useState<PreliminarVentasSlotDetail | null>(null);
  const [record, setRecord] = useState<PreliminarVentasRecordInput>({ ...EMPTY_RECORD });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const [markingSent, setMarkingSent] = useState(false);
  const [pdfBusy, setPdfBusy] = useState<'download' | 'view' | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!companyId) return;
    try {
      setLoading(true);
      setError('');
      const data = await preliminarVentasService.getSlotDetail(companyId, periodYm, slotIndex);
      setDetail(data);
      setRecord(data.record);
    } catch (err) {
      setError(extractApiErrorMessage(err, 'No se pudo cargar el preliminar de ventas.'));
    } finally {
      setLoading(false);
    }
  }, [companyId, periodYm, slotIndex]);

  useEffect(() => {
    void load();
  }, [load]);

  const patchRecord = (patch: Partial<PreliminarVentasRecordInput>) => {
    setRecord((prev) => ({ ...prev, ...patch }));
  };

  const formLocked = !!detail?.control_suspendida;
  const canMarkSent = detail?.status === 'registrado' || detail?.status === 'enviado';

  const handleSave = async () => {
    if (!canUpdate || formLocked) return;
    try {
      setSaving(true);
      setMsg('');
      setError('');
      const updated = await preliminarVentasService.saveSlotRecord(companyId, periodYm, slotIndex, record);
      setDetail(updated);
      setRecord(updated.record);
      setMsg('Registro guardado correctamente.');
    } catch (err) {
      setError(extractApiErrorMessage(err, 'No se pudo guardar el registro.'));
    } finally {
      setSaving(false);
    }
  };

  const handleMarkSent = async () => {
    if (!canUpdate || formLocked || !canMarkSent) return;
    try {
      setMarkingSent(true);
      setMsg('');
      setError('');
      const updated = await preliminarVentasService.markSlotSent(companyId, periodYm, slotIndex);
      setDetail(updated);
      setMsg('Entrega marcada como enviada.');
    } catch (err) {
      setError(extractApiErrorMessage(err, 'No se pudo marcar como enviada.'));
    } finally {
      setMarkingSent(false);
    }
  };

  const buildPdfBlob = async () => {
    if (!detail) return null;
    const firm = await configService.getFirmBranding();
    const logoPng = await loadLogoPngBlobForPdf(firm?.logo_url);
    return generatePreliminarVentasPdfBlob(detail, firm, logoPng);
  };

  const handleDownloadPdf = async () => {
    if (!detail || pdfBusy) return;
    try {
      setPdfBusy('download');
      setError('');
      const blob = await buildPdfBlob();
      if (blob) saveAs(blob, preliminarVentasPdfFilename(detail));
    } catch (err) {
      setError(extractApiErrorMessage(err, 'No se pudo generar el PDF.'));
    } finally {
      setPdfBusy(null);
    }
  };

  const handleViewPdf = async () => {
    if (!detail || pdfBusy) return;
    try {
      setPdfBusy('view');
      setError('');
      const blob = await buildPdfBlob();
      // Se muestra en un modal con <iframe> (en vez de window.open) porque el navegador puede
      // bloquear la ventana emergente al no considerarla ya "gesto directo del usuario" — la
      // generación del PDF es asíncrona y para cuando termina, ya pasó ese margen.
      if (blob) setPreviewUrl(URL.createObjectURL(blob));
    } catch (err) {
      setError(extractApiErrorMessage(err, 'No se pudo generar el PDF.'));
    } finally {
      setPdfBusy(null);
    }
  };

  if (!companyId) {
    return (
      <div className={PAGE_WORKSPACE_CLASS}>
        <Link to={homePath} className="text-primary-700 text-sm font-medium hover:underline">
          ← Volver
        </Link>
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm mt-3">Empresa inválida.</div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className={PAGE_WORKSPACE_CLASS}>
        <p className="text-sm text-slate-500">
          <i className="fas fa-spinner fa-spin mr-2" aria-hidden />
          Cargando…
        </p>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className={PAGE_WORKSPACE_CLASS}>
        <Link to={listPath} className="text-primary-700 text-sm font-medium hover:underline">
          ← Volver al listado
        </Link>
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm mt-3">
          {error || 'No se pudo cargar la empresa.'}
        </div>
      </div>
    );
  }

  const companyIgvRate: CompanyIgvRate = detail.company_igv_rate === 10.5 ? 10.5 : 18;
  const rateSelection: CompanyIgvRate[] = [
    ...(record.igv_aplicable_18 ? ([18] as CompanyIgvRate[]) : []),
    ...(record.igv_aplicable_105 ? ([10.5] as CompanyIgvRate[]) : []),
  ];
  // credito_periodo_anterior_auto y renta_rate_pct no dependen de la tasa de IGV elegida — se toman
  // tal cual del último cálculo del backend (no hace falta recalcularlos en vivo).
  const creditoAuto = detail.summary.credito_periodo_anterior_auto;
  const creditoEfectivo = record.credito_periodo_anterior_override ?? creditoAuto;
  const summary = computeLocalVentasSummary(record, companyIgvRate, detail.summary.renta_rate_pct, creditoEfectivo);

  return (
    <div className={PAGE_WORKSPACE_CLASS}>
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight">
            Preliminar de ventas — {detail.business_name} · Entrega {slotIndex}
          </h1>
          <p className="text-slate-500 mt-1 text-sm">
            Período {periodYm} · RUC {detail.ruc} · Código {detail.code} · Dígito {detail.dig} · Serie{' '}
            {detail.document_number} · Vence {formatDate(detail.due_date)}
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            disabled={!!pdfBusy}
            onClick={() => void handleViewPdf()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <i className="fas fa-eye" aria-hidden />
            {pdfBusy === 'view' ? 'Generando…' : 'Ver PDF'}
          </button>
          <button
            type="button"
            disabled={!!pdfBusy}
            onClick={() => void handleDownloadPdf()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
          >
            <i className="fas fa-download" aria-hidden />
            {pdfBusy === 'download' ? 'Generando…' : 'Descargar PDF'}
          </button>
          <Link to={listPath} className="text-primary-700 text-sm font-medium hover:underline whitespace-nowrap">
            ← Volver al listado
          </Link>
        </div>
      </div>

      {error ? <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">{error}</div> : null}
      {msg ? (
        <div className="p-3 bg-primary-50 border border-primary-200 rounded-lg text-sm text-primary-800">{msg}</div>
      ) : null}

      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm space-y-3">
        <h2 className="text-sm font-semibold text-slate-800">Empresa</h2>
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 text-sm">
          <dt className="text-slate-500">Asistente</dt>
          <dd className="text-slate-800">{detail.assistant_username || '—'}</dd>
          <dt className="text-slate-500">Estado</dt>
          <dd>
            <span
              className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${preliminarVentasStatusBadgeClass(detail.status)}`}
            >
              {preliminarVentasStatusLabel(detail.status)}
            </span>
          </dd>
          {detail.status === 'enviado' ? (
            <>
              <dt className="text-slate-500">Enviado</dt>
              <dd className="text-slate-800">{formatDateTime(detail.sent_at)}</dd>
            </>
          ) : null}
        </dl>
        {formLocked ? (
          <p className="flex items-start gap-2 text-sm text-slate-500">
            <i className="fas fa-ban mt-0.5 text-purple-600" aria-hidden />
            Esta empresa está marcada "Suspendida" en este período (desde Control de Detracciones) — no se puede editar.
          </p>
        ) : null}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm space-y-3">
        <h2 className="text-sm font-semibold text-slate-800">Ventas</h2>

        <div>
          <p className="text-xs font-medium text-slate-500 mb-1">Tasa(s) de IGV aplicable(s)</p>
          <LiquidacionIgvAplicableToggle
            rates={rateSelection}
            companyIgvRate={companyIgvRate}
            onChange={(next) => patchRecord({ igv_aplicable_18: next.includes(18), igv_aplicable_105: next.includes(10.5) })}
          />
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-xs font-semibold uppercase text-slate-500">
                <th className="text-left py-1.5 pr-2">Concepto</th>
                <th className="text-right py-1.5 px-2">Base imponible</th>
                <th className="text-right py-1.5 px-2">No gravadas</th>
                <th className="text-right py-1.5 px-2">I.G.V.</th>
                <th className="text-right py-1.5 pl-2">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {summary.rows.map(({ key, label, baseKey, noGravKey, igv, total }) => (
                <tr key={key}>
                  <td className="py-2 pr-2 text-slate-700">{label}</td>
                  <td className="py-2 px-2">
                    <MoneyField
                      disabled={!canUpdate || formLocked}
                      value={record[baseKey] as number}
                      onChange={(v) => patchRecord({ [baseKey]: v } as Partial<PreliminarVentasRecordInput>)}
                      className={FIELD_INPUT}
                    />
                  </td>
                  <td className="py-2 px-2">
                    <MoneyField
                      disabled={!canUpdate || formLocked}
                      value={record[noGravKey] as number}
                      onChange={(v) => patchRecord({ [noGravKey]: v } as Partial<PreliminarVentasRecordInput>)}
                      className={FIELD_INPUT}
                    />
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums text-slate-500">{formatMoney(igv)}</td>
                  <td className="py-2 pl-2 text-right tabular-nums text-slate-500">{formatMoney(total)}</td>
                </tr>
              ))}
              <tr className="font-semibold border-t border-slate-200">
                <td className="py-2 pr-2 text-slate-800">{summary.totalRow.label}</td>
                <td className="py-2 px-2 text-right tabular-nums text-slate-800">{formatMoney(summary.totalRow.base)}</td>
                <td className="py-2 px-2 text-right tabular-nums text-slate-800">{formatMoney(summary.totalRow.noGravadas)}</td>
                <td className="py-2 px-2 text-right tabular-nums text-slate-800">{formatMoney(summary.totalRow.igv)}</td>
                <td className="py-2 pl-2 text-right tabular-nums text-slate-800">{formatMoney(summary.totalRow.total)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-2xs text-slate-400">
          Tasa(s) IGV aplicada(s): {summary.ratesAplicables.map((r) => (r === 10.5 ? '10.5%' : '18%')).join(' y ')}.
        </p>

        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 pt-2 border-t border-slate-100">
          <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
            <p className="text-2xs font-semibold uppercase text-slate-500">I.G.V Resultante</p>
            <p className="text-sm font-semibold text-slate-800 tabular-nums">{formatMoney(summary.igvResultante)}</p>
          </div>
          <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
            <label className="block text-2xs font-semibold uppercase text-slate-500 mb-1">
              (-) Crédito periodo anterior
            </label>
            <MoneyField
              nullable
              disabled={!canUpdate || formLocked}
              value={record.credito_periodo_anterior_override}
              onChange={(v) => patchRecord({ credito_periodo_anterior_override: v })}
              onChangeNullable={(v) => patchRecord({ credito_periodo_anterior_override: v })}
              placeholder={formatMoney(creditoAuto)}
              className="w-full px-2 py-1 rounded-md border border-slate-300 text-sm text-right tabular-nums outline-none focus:ring-2 focus:ring-primary-500 disabled:bg-slate-100 disabled:text-slate-500"
            />
            <div className="flex items-center justify-between mt-1">
              <span className="text-2xs text-slate-400">Sugerido: {formatMoney(creditoAuto)}</span>
              {record.credito_periodo_anterior_override != null && !formLocked && canUpdate ? (
                <button
                  type="button"
                  onClick={() => patchRecord({ credito_periodo_anterior_override: null })}
                  className="text-2xs text-primary-700 font-medium hover:underline"
                >
                  Usar sugerido
                </button>
              ) : null}
            </div>
          </div>
          <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
            <label className="block text-2xs font-semibold uppercase text-slate-500 mb-1">(-) Retención</label>
            <MoneyField
              disabled={!canUpdate || formLocked}
              value={record.retencion_monto}
              onChange={(v) => patchRecord({ retencion_monto: v })}
              className="w-full px-2 py-1 rounded-md border border-slate-300 text-sm text-right tabular-nums outline-none focus:ring-2 focus:ring-primary-500 disabled:bg-slate-100 disabled:text-slate-500"
            />
          </div>
          <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
            <label className="block text-2xs font-semibold uppercase text-slate-500 mb-1">(-) Percepción</label>
            <MoneyField
              disabled={!canUpdate || formLocked}
              value={record.percepcion_monto}
              onChange={(v) => patchRecord({ percepcion_monto: v })}
              className="w-full px-2 py-1 rounded-md border border-slate-300 text-sm text-right tabular-nums outline-none focus:ring-2 focus:ring-primary-500 disabled:bg-slate-100 disabled:text-slate-500"
            />
          </div>
          <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
            <p className="text-2xs font-semibold uppercase text-slate-500">I.G.V. A PAGAR</p>
            <p
              className={`text-sm font-semibold tabular-nums ${summary.igvAPagar > 0 ? 'text-red-700' : 'text-primary-700'}`}
            >
              {formatMoney(summary.igvAPagar)}
            </p>
          </div>
        </div>
      </div>

      {summary.igvAPagar > 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm space-y-3">
          <h2 className="text-sm font-semibold text-slate-800">Compras</h2>
          <p className="text-xs text-slate-500">Importe aproximado a traer en facturas de compra (opcional).</p>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="block text-xs text-slate-500 mb-1">Base imponible</label>
              <MoneyField
                disabled={!canUpdate || formLocked}
                value={record.compras_base}
                onChange={(v) => patchRecord({ compras_base: v })}
                className={FIELD_INPUT}
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">I.G.V.</label>
              <p className="text-sm text-slate-500 tabular-nums px-3 py-2">{formatMoney(summary.comprasIgv)}</p>
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Total</label>
              <p className="text-sm text-slate-500 tabular-nums px-3 py-2">{formatMoney(summary.comprasTotal)}</p>
            </div>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl bg-white border border-slate-200 p-4 shadow-sm">
          <p className="text-2xs font-semibold uppercase text-slate-500">Monto aproximado a pagar en I.G.V.</p>
          <p className="text-lg font-semibold text-slate-800 tabular-nums">
            {summary.montoAproximadoIgv != null ? `S/ ${formatMoney(summary.montoAproximadoIgv)}` : '—'}
          </p>
        </div>
        <div className="rounded-xl bg-white border border-slate-200 p-4 shadow-sm">
          <p className="text-2xs font-semibold uppercase text-slate-500">Monto aproximado a pagar en Renta</p>
          <p className="text-lg font-semibold text-slate-800 tabular-nums">S/ {formatMoney(summary.montoAproximadoRenta)}</p>
        </div>
      </div>

      <div className="flex flex-wrap justify-end gap-3">
        {canUpdate ? (
          <button
            type="button"
            disabled={markingSent || formLocked || !canMarkSent || detail.status === 'enviado'}
            onClick={() => void handleMarkSent()}
            title={!canMarkSent ? 'Primero guarde el registro de esta entrega' : undefined}
            className="px-4 py-2 rounded-lg border border-primary-300 bg-primary-50 text-primary-800 text-sm font-medium hover:bg-primary-100 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {markingSent ? 'Marcando…' : detail.status === 'enviado' ? 'Ya enviado' : 'Marcar como enviado'}
          </button>
        ) : null}
        {canUpdate ? (
          <Button disabled={saving || formLocked} onClick={() => void handleSave()}>
            {saving ? 'Guardando…' : 'Guardar registro'}
          </Button>
        ) : null}
      </div>

      {previewUrl
        ? createPortal(
            <div className="fixed inset-0 z-dialog flex items-center justify-center p-4">
              <button
                type="button"
                aria-label="Cerrar vista previa"
                onClick={() => setPreviewUrl(null)}
                className="absolute inset-0 bg-slate-900/50 backdrop-blur-[1px]"
              />
              <div
                role="dialog"
                aria-modal="true"
                aria-label="Preliminar de ventas"
                className="relative flex w-full max-w-4xl max-h-[min(92vh,900px)] flex-col rounded-xl bg-white shadow-xl border border-slate-200 overflow-hidden"
              >
                <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-3 border-b border-slate-200">
                  <div className="min-w-0 text-sm font-semibold text-slate-800 truncate">Preliminar de ventas</div>
                  <button
                    type="button"
                    onClick={() => setPreviewUrl(null)}
                    className="inline-flex items-center justify-center w-9 h-9 rounded-full hover:bg-slate-100 text-slate-600"
                    aria-label="Cerrar"
                  >
                    <i className="fas fa-times" aria-hidden />
                  </button>
                </div>
                <div className="min-h-0 flex-1 overflow-auto p-3 bg-slate-50">
                  <iframe
                    title="Preliminar de ventas"
                    src={previewUrl}
                    className="w-full h-[min(80vh,820px)] rounded-lg bg-white border border-slate-200"
                  />
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
};

export default PreliminarVentasDetailPage;
