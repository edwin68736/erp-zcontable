import { useState } from 'react';
import { P } from '../../rbac/codes';
import { auth } from '../../services/auth';
import { companySuspensionService } from '../../services/companySuspension';
import { extractApiErrorMessage } from '../../utils/apiError';

type Props = {
  companyId: number;
  companyName: string;
  periodYm: string;
  suspendida: boolean;
  /** Se llama tras cambiar la marca, para que la lista se recargue. */
  onChanged: () => void;
};

const toast = (type: 'success' | 'error', message: string) =>
  window.dispatchEvent(new CustomEvent('miweb:toast', { detail: { type, message } }));

/**
 * Botón de fila para marcar o quitar la SUSPENSIÓN de una empresa en el período, disponible en todos los
 * módulos de actividades (Buzón SOL, Preliminar, Detracciones, PDT 601/621, informes…). La marca es una sola
 * por empresa y período: al suspenderla en un módulo queda suspendida en todos. La empresa sigue activa.
 */
export default function SuspendCompanyAction({ companyId, companyName, periodYm, suspendida, onChanged }: Props) {
  const [saving, setSaving] = useState(false);
  // Mismo permiso que exige el servidor para marcar la suspensión.
  if (!auth.hasPermission(P.supervisorsAttachmentsUpload)) return null;

  const label = suspendida ? 'Quitar suspensión' : 'Suspender empresa en este período';

  const handleClick = async () => {
    if (saving) return;
    const next = !suspendida;
    const ok = window.confirm(
      next
        ? `¿Marcar a ${companyName || 'la empresa'} como SUSPENDIDA en ${periodYm}?\n\nQuedará suspendida en todos los módulos de este período (Buzón SOL, Preliminar de ventas, Detracciones, PDT 601/621…) y exenta de plazos. Puedes quitar la suspensión cuando quieras.`
        : `¿Quitar la suspensión de ${companyName || 'la empresa'} en ${periodYm}?\n\nVolverá a contar en todos los módulos de este período.`,
    );
    if (!ok) return;
    try {
      setSaving(true);
      await companySuspensionService.set(companyId, periodYm, next);
      toast('success', next ? 'Empresa suspendida en este período.' : 'Suspensión quitada.');
      onChanged();
    } catch (err) {
      toast('error', extractApiErrorMessage(err, 'No se pudo cambiar la suspensión.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void handleClick()}
      disabled={saving}
      title={label}
      aria-label={label}
      aria-pressed={suspendida}
      className={`inline-flex items-center justify-center w-8 h-8 rounded-full shadow-sm transition-colors disabled:opacity-50 ${
        suspendida ? 'bg-purple-600 text-white hover:bg-purple-700' : 'bg-white border border-purple-300 text-purple-700 hover:bg-purple-50'
      }`}
    >
      <i className={`fas ${saving ? 'fa-spinner fa-spin' : suspendida ? 'fa-play' : 'fa-pause'} text-xs`} aria-hidden />
    </button>
  );
}
