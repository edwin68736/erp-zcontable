import { useCallback, useEffect, useState } from 'react';
import Button from '../../../components/ui/Button';
import Alert from '../../../components/ui/Alert';
import LongTaskPanel from '../../../components/LongTaskPanel';
import {
  CPE_KINDS,
  CPE_TIPOS,
  cpeFileName,
  cpeNumber,
  cpeTipoLabel,
  formatSirePeriod,
  saveBlobAs,
  sireCpeService,
  type SireApiError,
  type SireCpeItem,
  type SireCpeKind,
  type SireCpeStartResult,
  type SireDownloadItem,
} from '../../../services/sire';
import { taskKey, trackAsync } from '../../../utils/longTasks';
import { useTask } from '../../../utils/useLongTasks';
import { notify } from '../../../utils/notify';
import { formatDateTime } from '../../../utils/format';
import { timeAgo } from '../buzon/buzonUi';
import { Card, SireErrorBox } from './SireShared';
import { INPUT_CLS, SELECT_CLS } from './sireUi';
import SireCpeDialog, { CpeKindPicker } from './SireCpeDialog';

const TOOL = 'sire-cpe';

const STATUS_BADGE: Record<SireCpeItem['status'], { cls: string; label: string }> = {
  en_proceso: { cls: 'bg-amber-50 text-amber-700', label: 'Descargando' },
  listo: { cls: 'bg-green-50 text-green-700', label: 'Listo' },
  sin_cpe: { cls: 'bg-slate-100 text-slate-600', label: 'Sin archivos' },
  error: { cls: 'bg-red-50 text-red-700', label: 'Error' },
};

const KIND_BTN: { kind: SireCpeKind; label: string; icon: string; color: string; has: (c: SireCpeItem) => boolean }[] = [
  { kind: 'pdf', label: 'PDF', icon: 'fa-file-pdf', color: 'text-red-600', has: (c) => c.has_pdf },
  { kind: 'xml', label: 'XML', icon: 'fa-file-code', color: 'text-blue-700', has: (c) => c.has_xml },
  { kind: 'cdr', label: 'CDR', icon: 'fa-file-circle-check', color: 'text-green-700', has: (c) => c.has_cdr },
];

/**
 * Herramientas → SIRE → una empresa: descarga de los comprobantes electrónicos (PDF, XML y CDR) que SUNAT entrega por la
 * consulta de comprobantes de SOL. Se pueden bajar todos los de una propuesta SIRE ya lista o uno escrito a mano. La
 * descarga corre en el servidor (de a un comprobante, con pausa) y los archivos quedan guardados para volver a bajarlos.
 */
export default function SireCpePanel({
  companyId,
  companyName,
  ruc,
  dialogFor,
  onDialogClose,
}: {
  companyId: number;
  companyName: string;
  ruc: string;
  /** Consulta del historial cuya «Descarga CPE» está abierta (null = cerrada). */
  dialogFor: SireDownloadItem | null;
  onDialogClose: () => void;
}) {
  const [items, setItems] = useState<SireCpeItem[]>([]);
  const [error, setError] = useState<SireApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [manualKinds, setManualKinds] = useState<SireCpeKind[]>(CPE_KINDS.map((k) => k.value));
  const [manual, setManual] = useState({ ruc: '', tipo: '01', serie: '', numero: '' });
  const [fileBusy, setFileBusy] = useState('');


  const load = useCallback(async () => {
    try {
      setItems(await sireCpeService.list(companyId));
      setError(null);
    } catch (e) {
      setError(e as SireApiError);
    }
  }, [companyId]);
  useEffect(() => {
    void load();
  }, [load]);

  // El registro global sigue la descarga: avisa en la cabecera aunque la persona cambie de pantalla.
  const task = useTask(taskKey(TOOL, companyId));
  const runningKey = items.filter((i) => i.status === 'en_proceso').map((i) => `${i.id}@${i.created_at}`).join(',');
  useEffect(() => {
    if (!runningKey || task?.status === 'running') return;
    const running = runningKey.split(',').map((p) => ({ id: Number(p.split('@')[0]), created_at: p.split('@')[1] }));
    const ids = new Set(running.map((i) => i.id));
    const oldest = Math.min(...running.map((i) => Date.parse(i.created_at) || Date.now()));
    trackAsync(
      {
        tool: TOOL,
        toolLabel: 'Comprobantes SIRE',
        companyId,
        companyName: companyName || `Empresa ${companyId}`,
        detail: `${running.length} ${running.length === 1 ? 'comprobante' : 'comprobantes'}`,
        href: `/tools/sire/${companyId}`,
        startedAt: oldest,
      },
      async () => {
        const rows = (await sireCpeService.list(companyId)).filter((i) => ids.has(i.id));
        setItems((cur) => cur.map((c) => rows.find((r) => r.id === c.id) ?? c));
        if (rows.some((i) => i.status === 'en_proceso')) return { status: 'running' };
        const ok = rows.filter((i) => i.status === 'listo').length;
        const failed = rows.filter((i) => i.status === 'error');
        if (failed.length > 0) return { status: 'error', message: `${failed.length} de ${rows.length} no se pudieron consultar. ${failed[0].error_message ?? ''}`.trim() };
        void load();
        return { status: 'done', summary: `${ok} de ${rows.length} descargados` };
      },
      3000,
    );
  }, [runningKey, task?.status, companyId, companyName, load]);
  // Al terminar, la lista se vuelve a leer completa.
  useEffect(() => {
    if (task?.status === 'done' || task?.status === 'error') void load();
  }, [task?.status, load]);

  const report = (r: SireCpeStartResult) => {
    setItems((cur) => {
      const byId = new Map(r.items.map((i) => [i.id, i]));
      const merged = cur.map((c) => byId.get(c.id) ?? c);
      return [...r.items.filter((i) => !cur.some((c) => c.id === i.id)), ...merged];
    });
    const pending = r.items.filter((i) => i.status === 'en_proceso').length;
    const extra = [r.ready > 0 ? `${r.ready} ya estaban descargados` : '', r.skipped > 0 ? `${r.skipped} filas no son comprobantes descargables` : ''].filter(Boolean).join(' · ');
    if (pending > 0) void notify.success('Descarga iniciada', `${pending} ${pending === 1 ? 'comprobante' : 'comprobantes'} en proceso.${extra ? ` ${extra}.` : ''}`);
    else void notify.success('Ya estaban descargados', extra || undefined);
  };

  const startManual = async () => {
    setBusy(true);
    setError(null);
    try {
      report(await sireCpeService.startItems(companyId, [{ ruc: manual.ruc.trim() || ruc, tipo: manual.tipo, serie: manual.serie.trim(), numero: manual.numero.trim() }], manualKinds));
      setManual((m) => ({ ...m, serie: '', numero: '' }));
    } catch (e) {
      setError(e as SireApiError);
    } finally {
      setBusy(false);
    }
  };

  const retry = async (c: SireCpeItem) => {
    setBusy(true);
    setError(null);
    try {
      report(await sireCpeService.startItems(companyId, [{ ruc: c.ruc, tipo: c.tipo, serie: c.serie, numero: c.numero }], undefined));
    } catch (e) {
      setError(e as SireApiError);
    } finally {
      setBusy(false);
    }
  };

  const saveFile = async (c: SireCpeItem, kind: SireCpeKind) => {
    setFileBusy(`${c.id}:${kind}`);
    setError(null);
    try {
      saveBlobAs(await sireCpeService.fileBlob(companyId, c.id, kind), cpeFileName(c, kind));
    } catch (e) {
      setError(e as SireApiError);
    } finally {
      setFileBusy('');
    }
  };

  const saveZip = async () => {
    setFileBusy('zip');
    setError(null);
    try {
      saveBlobAs(await sireCpeService.zipBlob(companyId), `${ruc}-comprobantes.zip`);
      void notify.success('ZIP descargado');
    } catch (e) {
      setError(e as SireApiError);
    } finally {
      setFileBusy('');
    }
  };

  const remove = async (c: SireCpeItem) => {
    try {
      await sireCpeService.remove(companyId, c.id);
      setItems((cur) => cur.filter((i) => i.id !== c.id));
      void notify.success('Comprobante quitado');
    } catch (e) {
      setError(e as SireApiError);
    }
  };

  const readyCount = items.filter((i) => i.status === 'listo').length;
  const manualOk = /^[A-Za-z0-9]{4}$/.test(manual.serie.trim()) && /^\d{1,8}$/.test(manual.numero.trim()) && (manual.ruc.trim() === '' || /^\d{11}$/.test(manual.ruc.trim()));

  return (
    <div className="space-y-4">
      <Card
        title="Comprobantes electrónicos (PDF, XML y CDR)"
        subtitle="SUNAT entrega el PDF, el XML firmado y la constancia (CDR) de cada factura, boleta y nota. Se piden de a uno, con la clave SOL de la empresa."
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Para bajar los comprobantes de una propuesta, pulse <strong>«Descarga CPE»</strong> en su fila del historial: se abre la lista para elegir los formatos (PDF, XML, CDR).
          </p>
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Un comprobante</p>
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-xs text-slate-600">
                RUC del emisor
                <input className={`${INPUT_CLS} mt-0.5 block w-32`} inputMode="numeric" maxLength={11} placeholder={ruc} value={manual.ruc} onChange={(e) => setManual({ ...manual, ruc: e.target.value.replace(/\D/g, '') })} />
              </label>
              <label className="text-xs text-slate-600">
                Tipo
                <select className={`${SELECT_CLS} mt-0.5 block`} value={manual.tipo} onChange={(e) => setManual({ ...manual, tipo: e.target.value })}>
                  {CPE_TIPOS.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-slate-600">
                Serie
                <input className={`${INPUT_CLS} mt-0.5 block w-20 uppercase`} maxLength={4} placeholder="F001" value={manual.serie} onChange={(e) => setManual({ ...manual, serie: e.target.value.toUpperCase() })} />
              </label>
              <label className="text-xs text-slate-600">
                Número
                <input className={`${INPUT_CLS} mt-0.5 block w-28`} inputMode="numeric" maxLength={8} placeholder="123" value={manual.numero} onChange={(e) => setManual({ ...manual, numero: e.target.value.replace(/\D/g, '') })} />
              </label>
              <Button variant="secondary" disabled={busy || !manualOk || manualKinds.length === 0} onClick={() => void startManual()}>
                Descargar
              </Button>
            </div>
            <CpeKindPicker value={manualKinds} onChange={setManualKinds} disabled={busy} />
            <p className="text-xs text-slate-400">Si deja el RUC vacío se usa el de la empresa (comprobante emitido por ella).</p>
          </div>
        </div>
      </Card>

      {dialogFor ? <SireCpeDialog companyId={companyId} ruc={ruc} download={dialogFor} onClose={onDialogClose} onStarted={report} /> : null}

      <LongTaskPanel task={task} title="Descargando comprobantes de SUNAT" hint="Se bajan de a uno, con una pausa, para no saturar la sesión SOL. Puede seguir usando el sistema; los archivos aparecen abajo al terminar." />

      <Card
        title="Comprobantes descargados"
        subtitle="Quedan guardados: puede volver a bajar los archivos sin consultar otra vez a SUNAT."
        actions={
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{items.length}</span>
            {readyCount >= 1 ? (
              <Button variant="secondary" className="!px-3 !py-1.5 text-xs" disabled={fileBusy === 'zip'} onClick={() => void saveZip()} title="Un ZIP con el PDF, el XML y el CDR de todos los comprobantes listos">
                <i className={`fas ${fileBusy === 'zip' ? 'fa-spinner fa-spin' : 'fa-file-zipper'} mr-1.5`} aria-hidden />
                Bajar todo (ZIP)
              </Button>
            ) : null}
          </div>
        }
      >
        {error ? (
          <div className="mb-3">
            <SireErrorBox error={error} onRetry={() => void load()} />
          </div>
        ) : null}
        {items.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">Aún no hay comprobantes descargados.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-2 pr-3 font-semibold">Comprobante</th>
                  <th className="py-2 pr-3 font-semibold">Emisor</th>
                  <th className="py-2 pr-3 font-semibold">Estado</th>
                  <th className="py-2 pr-3 font-semibold">Archivos</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {items.map((c) => {
                  const badge = STATUS_BADGE[c.status];
                  return (
                    <tr key={c.id} className="border-b border-slate-100 align-top">
                      <td className="py-2 pr-3">
                        <div className="font-semibold text-slate-800">{cpeNumber(c)}</div>
                        <div className="text-xs text-slate-500">
                          {cpeTipoLabel(c.tipo)}
                          {c.period ? ` · ${c.libro === 'ventas' ? 'Ventas' : 'Compras'} ${formatSirePeriod(c.period)}` : ''}
                        </div>
                      </td>
                      <td className="py-2 pr-3 text-xs text-slate-600">
                        {c.ruc}
                        <div className="text-slate-400">{c.lado === 'emisor' ? 'Emitido por la empresa' : 'Recibido'}</div>
                      </td>
                      <td className="py-2 pr-3">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badge.cls}`}>{badge.label}</span>
                        {c.status === 'en_proceso' ? <i className="fas fa-spinner fa-spin ml-1.5 text-xs text-amber-600" aria-hidden /> : null}
                        {c.status !== 'listo' && c.status !== 'en_proceso' && c.error_message ? <p className="mt-1 max-w-xs text-xs text-slate-500">{c.error_message}</p> : null}
                        <div className="mt-0.5 text-2xs text-slate-400" title={formatDateTime(c.finished_at ?? c.created_at)}>
                          {timeAgo(c.finished_at ?? c.created_at)}
                        </div>
                      </td>
                      <td className="py-2 pr-3">
                        {c.status === 'listo' ? (
                          <div className="flex flex-wrap gap-1.5">
                            {KIND_BTN.map((k) =>
                              k.has(c) ? (
                                <button
                                  key={k.kind}
                                  type="button"
                                  disabled={fileBusy === `${c.id}:${k.kind}`}
                                  onClick={() => void saveFile(c, k.kind)}
                                  className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                                >
                                  <i className={`fas ${fileBusy === `${c.id}:${k.kind}` ? 'fa-spinner fa-spin' : k.icon} mr-1 ${k.color}`} aria-hidden />
                                  {k.label}
                                </button>
                              ) : null,
                            )}
                          </div>
                        ) : null}
                      </td>
                      <td className="py-2 text-right">
                        {c.status === 'error' || c.status === 'sin_cpe' ? (
                          <button type="button" disabled={busy} onClick={() => void retry(c)} className="mr-1 rounded-lg px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100">
                            <i className="fas fa-rotate-right mr-1" aria-hidden />
                            Reintentar
                          </button>
                        ) : null}
                        {c.status !== 'en_proceso' ? (
                          <button type="button" onClick={() => void remove(c)} title="Quitar" aria-label="Quitar" className="rounded-lg px-2 py-1 text-slate-400 hover:bg-red-50 hover:text-red-600">
                            <i className="fas fa-trash-can" aria-hidden />
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {items.some((i) => i.status === 'sin_cpe') ? (
          <div className="mt-3">
            <Alert variant="info">«Sin archivos» significa que SUNAT no tiene ese comprobante como electrónico para esta empresa (por ejemplo, un ticket o un comprobante físico).</Alert>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
