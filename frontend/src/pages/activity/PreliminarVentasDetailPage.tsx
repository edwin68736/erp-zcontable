import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { saveAs } from 'file-saver';
import {
  preliminarVentasStatusBadgeClass,
  preliminarVentasStatusLabel,
} from '../../components/activity/preliminarVentasConfig';
import Button from '../../components/ui/Button';
import { PAGE_WORKSPACE_CLASS } from '../../constants/pageLayout';
import { activitiesBasePath, workspaceHomePath, type ActivityWorkspace } from '../../navigation/activityRoutes';
import { auth } from '../../services/auth';
import { P } from '../../rbac/codes';
import { configService } from '../../services/config';
import {
  preliminarVentasService,
  type PreliminarVentasDetail,
  type PreliminarVentasRecordInput,
} from '../../services/preliminarVentas';
import { generatePreliminarVentasPdfBlob, preliminarVentasPdfFilename } from '../../pdf/preliminarVentasPdf';
import { loadLogoPngBlobForPdf } from '../../utils/pdfLogo';
import { previousMonthPeriodYM } from '../../utils/supervisorLabels';
import { extractApiErrorMessage } from '../../utils/apiError';

const EMPTY_RECORD: PreliminarVentasRecordInput = {
  facturas_base: 0,
  facturas_no_gravadas: 0,
  boletas_base: 0,
  boletas_no_gravadas: 0,
  notas_credito_base: 0,
  notas_credito_no_gravadas: 0,
  compras_base: 0,
};

const FIELD_INPUT =
  'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm text-right outline-none focus:ring-2 focus:ring-primary-500 disabled:bg-slate-50 disabled:text-slate-500';

function formatMoney(n: number | undefined): string {
  return (n ?? 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

type PreliminarVentasDetailPageProps = {
  workspace: ActivityWorkspace;
};

// Formulario simple (a diferencia de PDT 621: acá solo hay Ventas + Compras, sin IGV/Renta
// registrados a mano — se calculan solos, ver PreliminarVentasSummary en el backend). Módulo
// independiente de Liquidación: no se convierte en una ni la reemplaza.
const PreliminarVentasDetailPage = ({ workspace }: PreliminarVentasDetailPageProps) => {
  const { companyId: companyIdParam } = useParams();
  const companyId = Number(companyIdParam);
  const [searchParams] = useSearchParams();
  const periodYm = searchParams.get('period_ym') || previousMonthPeriodYM();
  const listPath = `${activitiesBasePath(workspace)}/preliminar-ventas?period_ym=${encodeURIComponent(periodYm)}`;
  const homePath = workspaceHomePath(workspace);

  const canUpdate = useMemo(() => auth.hasPermission(P.supervisorsDeclarationsUpdate), []);

  const [detail, setDetail] = useState<PreliminarVentasDetail | null>(null);
  const [record, setRecord] = useState<PreliminarVentasRecordInput>({ ...EMPTY_RECORD });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const [pdfBusy, setPdfBusy] = useState<'download' | 'view' | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!companyId) return;
    try {
      setLoading(true);
      setError('');
      const data = await preliminarVentasService.getDetail(companyId, periodYm);
      setDetail(data);
      setRecord(data.record);
    } catch (err) {
      setError(extractApiErrorMessage(err, 'No se pudo cargar el preliminar de ventas.'));
    } finally {
      setLoading(false);
    }
  }, [companyId, periodYm]);

  useEffect(() => {
    void load();
  }, [load]);

  const patchRecord = (patch: Partial<PreliminarVentasRecordInput>) => {
    setRecord((prev) => ({ ...prev, ...patch }));
  };

  const formLocked = !!detail?.control_suspendida;

  const handleSave = async () => {
    if (!canUpdate || formLocked) return;
    try {
      setSaving(true);
      setMsg('');
      setError('');
      const updated = await preliminarVentasService.saveRecord(companyId, periodYm, record);
      setDetail(updated);
      setRecord(updated.record);
      setMsg('Registro guardado correctamente.');
    } catch (err) {
      setError(extractApiErrorMessage(err, 'No se pudo guardar el registro.'));
    } finally {
      setSaving(false);
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

  const summary = detail.summary;

  return (
    <div className={PAGE_WORKSPACE_CLASS}>
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Preliminar de ventas — {detail.business_name}</h1>
          <p className="text-slate-500 mt-1 text-sm">
            Período {periodYm} · RUC {detail.ruc} · Código {detail.code} · Dígito {detail.dig} · Serie{' '}
            {detail.document_number}
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
              className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${preliminarVentasStatusBadgeClass(detail.declaration.status)}`}
            >
              {preliminarVentasStatusLabel(detail.declaration.status)}
            </span>
          </dd>
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
              <tr>
                <td className="py-2 pr-2 text-slate-700">Facturas Emitidas</td>
                <td className="py-2 px-2">
                  <input
                    type="number"
                    step="0.01"
                    disabled={!canUpdate || formLocked}
                    value={record.facturas_base}
                    onChange={(e) => patchRecord({ facturas_base: Number(e.target.value) || 0 })}
                    className={FIELD_INPUT}
                  />
                </td>
                <td className="py-2 px-2">
                  <input
                    type="number"
                    step="0.01"
                    disabled={!canUpdate || formLocked}
                    value={record.facturas_no_gravadas}
                    onChange={(e) => patchRecord({ facturas_no_gravadas: Number(e.target.value) || 0 })}
                    className={FIELD_INPUT}
                  />
                </td>
                <td className="py-2 px-2 text-right tabular-nums text-slate-500">{formatMoney(summary.rows[0]?.igv)}</td>
                <td className="py-2 pl-2 text-right tabular-nums text-slate-500">{formatMoney(summary.rows[0]?.total)}</td>
              </tr>
              <tr>
                <td className="py-2 pr-2 text-slate-700">Boletas Emitidas</td>
                <td className="py-2 px-2">
                  <input
                    type="number"
                    step="0.01"
                    disabled={!canUpdate || formLocked}
                    value={record.boletas_base}
                    onChange={(e) => patchRecord({ boletas_base: Number(e.target.value) || 0 })}
                    className={FIELD_INPUT}
                  />
                </td>
                <td className="py-2 px-2">
                  <input
                    type="number"
                    step="0.01"
                    disabled={!canUpdate || formLocked}
                    value={record.boletas_no_gravadas}
                    onChange={(e) => patchRecord({ boletas_no_gravadas: Number(e.target.value) || 0 })}
                    className={FIELD_INPUT}
                  />
                </td>
                <td className="py-2 px-2 text-right tabular-nums text-slate-500">{formatMoney(summary.rows[1]?.igv)}</td>
                <td className="py-2 pl-2 text-right tabular-nums text-slate-500">{formatMoney(summary.rows[1]?.total)}</td>
              </tr>
              <tr>
                <td className="py-2 pr-2 text-slate-700">(-) Notas de Crédito</td>
                <td className="py-2 px-2">
                  <input
                    type="number"
                    step="0.01"
                    disabled={!canUpdate || formLocked}
                    value={record.notas_credito_base}
                    onChange={(e) => patchRecord({ notas_credito_base: Number(e.target.value) || 0 })}
                    className={FIELD_INPUT}
                  />
                </td>
                <td className="py-2 px-2">
                  <input
                    type="number"
                    step="0.01"
                    disabled={!canUpdate || formLocked}
                    value={record.notas_credito_no_gravadas}
                    onChange={(e) => patchRecord({ notas_credito_no_gravadas: Number(e.target.value) || 0 })}
                    className={FIELD_INPUT}
                  />
                </td>
                <td className="py-2 px-2 text-right tabular-nums text-slate-500">{formatMoney(summary.rows[2]?.igv)}</td>
                <td className="py-2 pl-2 text-right tabular-nums text-slate-500">{formatMoney(summary.rows[2]?.total)}</td>
              </tr>
              <tr className="font-semibold border-t border-slate-200">
                <td className="py-2 pr-2 text-slate-800">TOTAL VENTAS</td>
                <td className="py-2 px-2 text-right tabular-nums text-slate-800">{formatMoney(summary.rows[3]?.base)}</td>
                <td className="py-2 px-2 text-right tabular-nums text-slate-800">{formatMoney(summary.rows[3]?.no_gravadas)}</td>
                <td className="py-2 px-2 text-right tabular-nums text-slate-800">{formatMoney(summary.rows[3]?.igv)}</td>
                <td className="py-2 pl-2 text-right tabular-nums text-slate-800">{formatMoney(summary.rows[3]?.total)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-2xs text-slate-400">
          I.G.V., totales y montos aproximados se recalculan al guardar (tasa IGV vigente de la empresa: {summary.igv_rate_pct}
          %).
        </p>

        <div className="grid gap-3 sm:grid-cols-3 pt-2 border-t border-slate-100">
          <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
            <p className="text-2xs font-semibold uppercase text-slate-500">I.G.V Resultante</p>
            <p className="text-sm font-semibold text-slate-800 tabular-nums">{formatMoney(summary.igv_resultante)}</p>
          </div>
          <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
            <p className="text-2xs font-semibold uppercase text-slate-500">(-) Crédito periodo anterior</p>
            <p className="text-sm font-semibold text-slate-800 tabular-nums">{formatMoney(summary.credito_periodo_anterior)}</p>
          </div>
          <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
            <p className="text-2xs font-semibold uppercase text-slate-500">I.G.V. A PAGAR</p>
            <p
              className={`text-sm font-semibold tabular-nums ${summary.igv_a_pagar > 0 ? 'text-red-700' : 'text-primary-700'}`}
            >
              {formatMoney(summary.igv_a_pagar)}
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm space-y-3">
        <h2 className="text-sm font-semibold text-slate-800">Compras</h2>
        <p className="text-xs text-slate-500">Importe aproximado a traer en facturas de compra (opcional).</p>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="block text-xs text-slate-500 mb-1">Base imponible</label>
            <input
              type="number"
              step="0.01"
              disabled={!canUpdate || formLocked}
              value={record.compras_base}
              onChange={(e) => patchRecord({ compras_base: Number(e.target.value) || 0 })}
              className={FIELD_INPUT}
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">I.G.V.</label>
            <p className="text-sm text-slate-500 tabular-nums px-3 py-2">{formatMoney(summary.compras_igv)}</p>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Total</label>
            <p className="text-sm text-slate-500 tabular-nums px-3 py-2">{formatMoney(summary.compras_total)}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl bg-white border border-slate-200 p-4 shadow-sm">
          <p className="text-2xs font-semibold uppercase text-slate-500">Monto aproximado a pagar en I.G.V.</p>
          <p className="text-lg font-semibold text-slate-800 tabular-nums">
            {summary.monto_aproximado_igv != null ? `S/ ${formatMoney(summary.monto_aproximado_igv)}` : '—'}
          </p>
        </div>
        <div className="rounded-xl bg-white border border-slate-200 p-4 shadow-sm">
          <p className="text-2xs font-semibold uppercase text-slate-500">Monto aproximado a pagar en Renta</p>
          <p className="text-lg font-semibold text-slate-800 tabular-nums">S/ {formatMoney(summary.monto_aproximado_renta)}</p>
        </div>
      </div>

      {canUpdate ? (
        <div className="flex justify-end">
          <Button disabled={saving || formLocked} onClick={() => void handleSave()}>
            {saving ? 'Guardando…' : 'Guardar registro'}
          </Button>
        </div>
      ) : null}

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
