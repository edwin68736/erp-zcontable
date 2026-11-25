import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { P } from '../../rbac/codes';
import { auth } from '../../services/auth';
import { notApplicableService, type NotApplicableActivity, type NotApplicableCarryOver as CarryOver } from '../../services/notApplicable';
import { extractApiErrorMessage } from '../../utils/apiError';
import { notify } from '../../utils/notify';
import Alert from '../ui/Alert';
import Button from '../ui/Button';
import { NOT_APPLICABLE_ACTIVITY_LABEL, notApplicableMarkLabel } from './notApplicableConfig';

type Props = {
  activity: NotApplicableActivity;
  periodYm: string;
  /** Se llama tras aplicar la decisión, para que la lista se recargue. */
  onApplied: () => void;
  /** Espera (no se muestra) mientras haya otra ventana abierta, p. ej. la de suspendidas. */
  hold?: boolean;
};

/**
 * Arrastre de «No corresponde»: al entrar a un periodo, pregunta qué empresas marcadas el periodo anterior mantienen la marca.
 * La marca no pasa sola de un mes a otro. «Decidir después» no guarda nada y se vuelve a preguntar.
 */
export default function NotApplicableCarryOver({ activity, periodYm, onApplied, hold }: Props) {
  const allowed = auth.hasPermission(P.supervisorsDetraccionesMarkStatus);
  const [data, setData] = useState<{ periodYm: string; status: CarryOver } | null>(null);
  const [keep, setKeep] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    notApplicableService
      .carryOver(activity, periodYm)
      .then((status) => {
        if (cancelled) return;
        setData({ periodYm, status });
        setKeep(new Set((status.companies ?? []).map((c) => c.company_id)));
        setSearch('');
        setError('');
      })
      .catch((err: unknown) => {
        // Silencioso: no bloquea el uso normal del listado si esta consulta falla.
        console.error(err);
      });
    return () => {
      cancelled = true;
    };
  }, [activity, periodYm, allowed]);

  const open = !hold && !!data && data.periodYm === periodYm && data.status.pending;
  const close = useCallback(() => setData(null), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, saving, close]);

  if (!open || !data) return null;

  const companies = data.status.companies;
  const mark = notApplicableMarkLabel(activity);
  const term = search.trim().toLowerCase();
  const visible = term
    ? companies.filter((c) => `${c.business_name} ${c.ruc} ${c.code}`.toLowerCase().includes(term))
    : companies;

  const toggle = (id: number, checked: boolean) => {
    setKeep((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const applyDecision = async () => {
    try {
      setSaving(true);
      setError('');
      const res = await notApplicableService.applyCarryOver(
        activity,
        periodYm,
        Array.from(keep),
        companies.map((c) => c.company_id),
      );
      close();
      onApplied();
      if (res.skipped.length > 0) {
        void notify.warning('Algunas no se marcaron', res.skipped.slice(0, 8).join('\n'));
      } else {
        void notify.success('Decisión aplicada');
      }
    } catch (err) {
      setError(extractApiErrorMessage(err, 'No se pudo aplicar la decisión.'));
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-dialog flex items-center justify-center p-4">
      <button type="button" aria-label="Cerrar" disabled={saving} onClick={close} className="absolute inset-0 bg-slate-900/50 backdrop-blur-[1px]" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="na-carryover-title"
        className="relative bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-lg p-5 space-y-3"
      >
        <div>
          <h2 id="na-carryover-title" className="text-lg font-semibold text-slate-800">
            «{mark}» del periodo anterior
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            {NOT_APPLICABLE_ACTIVITY_LABEL[activity]}:{' '}
            {companies.length === 1 ? 'esta empresa estaba' : `estas ${companies.length} empresas estaban`} marcada
            {companies.length === 1 ? '' : 's'} en {data.status.previous_period_ym}. Deje marcadas las que siguen igual en {periodYm}; las
            demás se evaluarán con normalidad.
          </p>
        </div>

        {error ? <Alert variant="error">{error}</Alert> : null}

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por razón social, RUC o código…"
            className="flex-1 min-w-[12rem] px-3 py-2 rounded-lg border border-slate-300 text-sm outline-none focus:ring-2 focus:ring-primary-500"
          />
          <button type="button" disabled={saving} onClick={() => setKeep(new Set(companies.map((c) => c.company_id)))} className="text-xs font-medium text-primary-700 hover:underline">
            Todas
          </button>
          <button type="button" disabled={saving} onClick={() => setKeep(new Set())} className="text-xs font-medium text-primary-700 hover:underline">
            Ninguna
          </button>
        </div>

        <ul className="max-h-72 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-lg">
          {visible.length === 0 ? <li className="px-3 py-4 text-sm text-slate-500 text-center">Sin coincidencias.</li> : null}
          {visible.map((c) => (
            <li key={c.company_id}>
              <label className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-slate-50">
                <input
                  type="checkbox"
                  disabled={saving}
                  checked={keep.has(c.company_id)}
                  onChange={(e) => toggle(c.company_id, e.target.checked)}
                  className="rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-slate-800 truncate">{c.business_name || '—'}</span>
                  <span className="block text-xs text-slate-500">
                    {c.code ? `${c.code} · ` : ''}
                    {c.ruc}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <p className="text-xs text-slate-500">
            {keep.size} de {companies.length} mantienen la marca
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={close}
              className="px-4 py-2 rounded-lg border border-slate-300 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Decidir después
            </button>
            <Button disabled={saving} onClick={() => void applyDecision()}>
              {saving ? 'Guardando…' : 'Confirmar'}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
