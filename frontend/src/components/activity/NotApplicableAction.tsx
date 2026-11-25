import { useState } from 'react';
import { P } from '../../rbac/codes';
import { auth } from '../../services/auth';
import { notApplicableService, type NotApplicableActivity } from '../../services/notApplicable';
import { extractApiErrorMessage } from '../../utils/apiError';
import { notify } from '../../utils/notify';
import { NOT_APPLICABLE_ACTIVITY_LABEL, notApplicableMarkLabel } from './notApplicableConfig';

type Props = {
  activity: NotApplicableActivity;
  companyId: number;
  companyName: string;
  periodYm: string;
  marked: boolean;
  /** Se llama tras cambiar la marca, para que la pantalla se recargue. */
  onChanged: () => void;
};

/**
 * Botón de fila para marcar o quitar «No corresponde» de UNA actividad en el periodo: la empresa deja de evaluarse en esa
 * actividad (en las demás sigue igual). Al mes siguiente el módulo pregunta si se mantiene.
 */
export default function NotApplicableAction({ activity, companyId, companyName, periodYm, marked, onChanged }: Props) {
  const [saving, setSaving] = useState(false);
  // Mismo permiso que exige el servidor.
  if (!auth.hasPermission(P.supervisorsDetraccionesMarkStatus)) return null;

  const mark = notApplicableMarkLabel(activity);
  const label = marked ? `Quitar la marca «${mark}»` : `Marcar «${mark}»`;
  const name = companyName || 'la empresa';
  const module = NOT_APPLICABLE_ACTIVITY_LABEL[activity];

  const handleClick = async () => {
    if (saving) return;
    const ok = await notify.confirm({
      title: marked ? `¿Quitar «${mark}»?` : `¿Marcar «${mark}»?`,
      message: marked
        ? `${name} volverá a evaluarse en ${module} en ${periodYm}.`
        : `${name} no se evaluará en ${module} en ${periodYm}: no contará como pendiente ni como incumplimiento. Las demás actividades no cambian.`,
      confirmLabel: marked ? 'Quitar marca' : 'Marcar',
    });
    if (!ok) return;
    try {
      setSaving(true);
      await notApplicableService.set(activity, companyId, periodYm, !marked);
      void notify.success(marked ? 'Marca quitada' : `Marcada «${mark}»`);
      onChanged();
    } catch (err) {
      void notify.error('No se pudo cambiar la marca', extractApiErrorMessage(err, 'Intente nuevamente.'));
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
      aria-pressed={marked}
      className={`inline-flex shrink-0 items-center justify-center w-8 h-8 rounded-full shadow-sm transition-colors disabled:opacity-50 ${
        marked ? 'bg-slate-600 text-white hover:bg-slate-700' : 'bg-white border border-slate-300 text-slate-600 hover:bg-slate-50'
      }`}
    >
      <i className={`fas ${saving ? 'fa-spinner fa-spin' : marked ? 'fa-rotate-left' : 'fa-ban'} text-xs`} aria-hidden />
    </button>
  );
}
