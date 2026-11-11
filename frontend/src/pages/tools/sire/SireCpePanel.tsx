import { useCallback } from 'react';
import { sireCpeService, type SireCpeStartResult, type SireDownloadItem } from '../../../services/sire';
import { trackAsync } from '../../../utils/longTasks';
import { notify } from '../../../utils/notify';
import SireCpeDialog from './SireCpeDialog';

const TOOL = 'sire-cpe';

/**
 * «Descarga CPE» de una consulta del historial: solo muestra el modal. Cuando se inicia una descarga deja el seguimiento en
 * el registro global (indicador de la cabecera), para que se vea el avance aunque se cierre el modal o se cambie de pantalla.
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
  const onStarted = useCallback(
    (r: SireCpeStartResult) => {
      const running = r.items.filter((i) => i.status === 'en_proceso');
      const extra = r.ready > 0 ? ` ${r.ready} ya estaban descargados.` : '';
      if (running.length === 0) return;
      void notify.success('Descarga iniciada', `${running.length} ${running.length === 1 ? 'comprobante' : 'comprobantes'} en proceso.${extra}`);
      const ids = new Set(running.map((i) => i.id));
      trackAsync(
        {
          tool: TOOL,
          toolLabel: 'Comprobantes SIRE',
          companyId,
          companyName: companyName || `Empresa ${companyId}`,
          detail: `${running.length} ${running.length === 1 ? 'comprobante' : 'comprobantes'}`,
          href: `/tools/sire/${companyId}`,
        },
        async () => {
          const rows = (await sireCpeService.list(companyId)).filter((i) => ids.has(i.id));
          if (rows.some((i) => i.status === 'en_proceso')) return { status: 'running' };
          const failed = rows.filter((i) => i.status === 'error');
          if (failed.length > 0) return { status: 'error', message: `${failed.length} de ${rows.length} no se pudieron consultar. ${failed[0].error_message ?? ''}`.trim() };
          return { status: 'done', summary: `${rows.filter((i) => i.status === 'listo').length} de ${rows.length} descargados` };
        },
        3000,
      );
    },
    [companyId, companyName],
  );

  return dialogFor ? <SireCpeDialog companyId={companyId} ruc={ruc} download={dialogFor} onClose={onDialogClose} onStarted={onStarted} /> : null;
}
