import { useState } from 'react';
import { configService } from '../services/config';
import { fiscalReceiptsService } from '../services/fiscalReceipts';
import { downloadFiscalReceiptPdf } from '../pdf/fiscalReceiptPdf';
import FiscalReceiptPdfViewerModal from './FiscalReceiptPdfViewerModal';

type Props = {
  receiptId: number;
  compact?: boolean;
};

const FiscalReceiptPdfActions = ({ receiptId, compact }: Props) => {
  const [busy, setBusy] = useState<'a4' | 'ticket' | null>(null);
  const [viewer, setViewer] = useState<{ open: boolean; format: 'a4' | 'ticket' }>({
    open: false,
    format: 'a4',
  });

  const runDownload = async (format: 'a4' | 'ticket') => {
    try {
      setBusy(format);
      const [receipt, firm] = await Promise.all([
        fiscalReceiptsService.getDetail(receiptId),
        configService.getFirmBranding(),
      ]);
      await downloadFiscalReceiptPdf(receipt, firm, undefined, format);
    } catch (e) {
      console.error(e);
      window.dispatchEvent(
        new CustomEvent('miweb:toast', {
          detail: { type: 'error', message: 'No se pudo descargar el PDF' },
        }),
      );
    } finally {
      setBusy(null);
    }
  };

  const btnClass = compact
    ? 'inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50'
    : 'inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50';

  return (
    <>
      <div className={`flex flex-wrap items-center gap-1.5 ${compact ? '' : 'gap-2'}`}>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => setViewer({ open: true, format: 'ticket' })}
          className={btnClass}
          title="Ver ticket 80 mm"
        >
          <i className="fas fa-receipt text-[10px]" />
          {busy === 'ticket' ? '…' : compact ? 'Ticket' : 'Ver ticket'}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => setViewer({ open: true, format: 'a4' })}
          className={btnClass}
          title="Ver PDF A4"
        >
          <i className="fas fa-file-pdf text-[10px] text-red-600" />
          {busy === 'a4' ? '…' : compact ? 'A4' : 'Ver A4'}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void runDownload('ticket')}
          className={btnClass}
          title="Descargar ticket (NV01-00000001.pdf)"
        >
          <i className="fas fa-download text-[10px]" />
          {compact ? '' : 'Desc. ticket'}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void runDownload('a4')}
          className={btnClass}
          title="Descargar A4 (NV01-00000001.pdf)"
        >
          <i className="fas fa-file-download text-[10px] text-red-600" />
          {compact ? '' : 'Desc. A4'}
        </button>
      </div>

      <FiscalReceiptPdfViewerModal
        open={viewer.open}
        receiptId={receiptId}
        initialFormat={viewer.format}
        onClose={() => setViewer((v) => ({ ...v, open: false }))}
      />
    </>
  );
};

export default FiscalReceiptPdfActions;
