import { useCallback, useEffect, useState } from 'react';
import { PAGE_WORKSPACE_CLASS } from '../../constants/pageLayout';
import { usePermission } from '../../rbac/access';
import { P } from '../../rbac/codes';
import {
  sunatDueDatesService,
  type SunatDueDateRow,
  type SunatDueDateUpdateInput,
} from '../../services/sunatDueDates';
import { extractApiErrorMessage } from '../../utils/apiError';

const MONTH_LABELS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];
const MONTH_SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Set', 'Oct', 'Nov', 'Dic'];
const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

/** "2026-02-09" → "9-Feb" (mismo formato del cronograma oficial SUNAT). */
function formatDueDateShort(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
  if (!m) return '—';
  const day = Number(m[3]);
  const monthIdx = Number(m[2]) - 1;
  return `${day}-${MONTH_SHORT[monthIdx] ?? m[2]}`;
}

type EditableRows = Record<number, SunatDueDateRow['dates']>;

function toEditable(rows: SunatDueDateRow[]): EditableRows {
  const out: EditableRows = {};
  for (const r of rows) out[r.month] = [...r.dates] as SunatDueDateRow['dates'];
  return out;
}

const TH = 'px-3 py-2.5 text-center text-xs font-semibold uppercase tracking-wide text-white';
const TD = 'px-3 py-2 text-sm text-slate-700 border-t border-slate-100 text-center';

const SunatDueDatesCalendar = () => {
  const canView = usePermission(P.financeSunatDueDatesView);
  const canManage = usePermission(P.financeSunatDueDatesManage);

  const [rows, setRows] = useState<SunatDueDateRow[]>([]);
  const [editing, setEditing] = useState<EditableRows | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const data = await sunatDueDatesService.list();
      setRows(data);
    } catch (err) {
      setError(extractApiErrorMessage(err, 'No se pudo cargar el cronograma de vencimientos.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const startEditing = () => setEditing(toEditable(rows));
  const cancelEditing = () => setEditing(null);

  const patchCell = (month: number, digit: number, value: string) => {
    setEditing((prev) => {
      if (!prev) return prev;
      const next = { ...prev };
      const dates = [...next[month]] as SunatDueDateRow['dates'];
      dates[digit] = value;
      next[month] = dates;
      return next;
    });
  };

  const handleSave = async () => {
    if (!editing) return;
    try {
      setSaving(true);
      setError('');
      const payload: SunatDueDateUpdateInput[] = Object.entries(editing).map(([month, dates]) => ({
        month: Number(month),
        dates,
      }));
      const updated = await sunatDueDatesService.update(payload);
      setRows(updated);
      setEditing(null);
      window.dispatchEvent(
        new CustomEvent('miweb:toast', { detail: { type: 'success', message: 'Cronograma actualizado.' } }),
      );
    } catch (err) {
      setError(extractApiErrorMessage(err, 'No se pudo guardar el cronograma.'));
      window.dispatchEvent(
        new CustomEvent('miweb:toast', { detail: { type: 'error', message: 'No se pudo guardar el cronograma.' } }),
      );
    } finally {
      setSaving(false);
    }
  };

  if (!canView) {
    return (
      <div className={PAGE_WORKSPACE_CLASS}>
        <div className="p-6 bg-white rounded-xl border border-slate-200 text-center text-slate-500">
          No tienes permiso para ver esta información.
        </div>
      </div>
    );
  }

  return (
    <div className={PAGE_WORKSPACE_CLASS}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Vencimientos SUNAT</h1>
          <p className="text-slate-500 mt-1 text-sm max-w-2xl">
            Cronograma de obligaciones tributarias mensuales de SUNAT: para cada periodo, la fecha
            límite según el último dígito del RUC. Referencia del estudio — se edita cuando SUNAT
            publica el cronograma del nuevo año; no se crean calendarios nuevos.
          </p>
        </div>
        {canManage ? (
          editing ? (
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={cancelEditing}
                disabled={saving}
                className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving}
                className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
              >
                <i className={`fas ${saving ? 'fa-spinner fa-spin' : 'fa-save'} mr-2`} aria-hidden />
                {saving ? 'Guardando…' : 'Guardar cambios'}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={startEditing}
              disabled={loading}
              className="shrink-0 px-4 py-2 rounded-lg bg-slate-800 text-white text-sm font-medium hover:bg-slate-900 disabled:opacity-50"
            >
              <i className="fas fa-pen mr-2" aria-hidden />
              Editar cronograma
            </button>
          )
        ) : null}
      </div>

      {error ? (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">{error}</div>
      ) : null}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full w-full border-collapse">
            <thead>
              <tr className="bg-primary-700">
                <th className={`${TH} text-left`}>Periodo</th>
                {DIGITS.map((d) => (
                  <th key={d} className={TH}>
                    {d}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={11} className="px-4 py-8 text-center text-slate-500 text-sm">
                    <i className="fas fa-spinner fa-spin mr-2" aria-hidden />
                    Cargando…
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const dates = editing ? editing[row.month] : row.dates;
                  return (
                    <tr key={row.month} className="hover:bg-slate-50/80">
                      <td className={`${TD} text-left font-semibold text-slate-800 whitespace-nowrap`}>
                        {MONTH_LABELS[row.month - 1] ?? row.month}
                      </td>
                      {DIGITS.map((d) => (
                        <td key={d} className={`${TD} whitespace-nowrap`}>
                          {editing ? (
                            <input
                              type="date"
                              value={dates[d] || ''}
                              onChange={(e) => patchCell(row.month, d, e.target.value)}
                              className="w-full min-w-[120px] px-1.5 py-1 rounded border border-slate-300 text-xs outline-none focus:ring-2 focus:ring-primary-500"
                            />
                          ) : (
                            <span className={dates[d] ? '' : 'text-slate-300'}>
                              {dates[d] ? formatDueDateShort(dates[d]) : '—'}
                            </span>
                          )}
                        </td>
                      ))}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default SunatDueDatesCalendar;
