import { createPortal } from 'react-dom';
import type { TukifacReceiptViewLinks } from '../utils/tukifacReceiptLinks';

type Props = {
  open: boolean;
  links: TukifacReceiptViewLinks | null;
  onContinue: () => void;
  continueLabel?: string;
};

/**
 * Tras emitir en Tukifac, muestra enlaces a vista ticket y PDF (A4) guardados en el sistema.
 */
export default function TukifacIssueLinksDialog({ open, links, onContinue, continueLabel = 'Continuar' }: Props) {
  if (!open || !links) return null;
  const ticket = links.print_ticket_url?.trim();
  const pdf = links.pdf_url?.trim();
  if (!ticket && !pdf) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tukifac-links-title"
    >
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-xl p-5 space-y-4">
        <div>
          <h2 id="tukifac-links-title" className="text-lg font-semibold text-slate-800">
            Comprobante en Tukifac
          </h2>
          {links.number ? (
            <p className="mt-1 text-sm text-slate-600">
              Número: <span className="font-mono font-medium text-slate-800">{links.number}</span>
            </p>
          ) : null}
          <p className="mt-2 text-sm text-slate-600">Abra el formato que necesite; las URLs quedaron guardadas en comprobantes.</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          {ticket ? (
            <a
              href={ticket}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex flex-1 items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-slate-800 text-white text-sm font-medium hover:bg-slate-900"
            >
              <i className="fas fa-receipt text-xs" aria-hidden />
              Ver ticket
            </a>
          ) : null}
          {pdf ? (
            <a
              href={pdf}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex flex-1 items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-slate-300 bg-white text-slate-800 text-sm font-medium hover:bg-slate-50"
            >
              <i className="fas fa-file-pdf text-xs text-red-600" aria-hidden />
              Ver PDF (A4)
            </a>
          ) : null}
        </div>
        <div className="pt-1 flex justify-end">
          <button
            type="button"
            onClick={onContinue}
            className="px-4 py-2 rounded-lg text-sm font-medium text-primary-700 hover:bg-primary-50"
          >
            {continueLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
