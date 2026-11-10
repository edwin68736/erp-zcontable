import { useCallback, useEffect, useState } from 'react';
import { PAGE_WORKSPACE_CLASS } from '../../constants/pageLayout';
import { usePermission } from '../../rbac/hooks';
import { P } from '../../rbac/codes';
import {
  sunatDueDatesService,
  sunatOfficialDueDatesService,
  type DueDatesApi,
  type SunatDueDateRow,
  type SunatDueDateUpdateInput,
} from '../../services/sunatDueDates';
import { extractApiErrorMessage } from '../../utils/apiError';
import Button from '../../components/ui/Button';
import PageHeading from '../../components/ui/PageHeading';
import Alert from '../../components/ui/Alert';
import { notify } from '../../utils/notify';

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

const TH = 'px-3 py-2.5 text-center text-xs font-semibold uppercase tracking-wide text-slate-500';
const TD = 'px-3 py-2 text-sm text-slate-700 border-t border-slate-100 text-center';

type TabKey = 'estudio' | 'sunat';

const TABS: {
  key: TabKey;
  label: string;
  api: DueDatesApi;
  editLabel: string;
  savedMessage: string;
  errorMessage: string;
  description: string;
}[] = [
  {
    key: 'estudio',
    label: 'Vencimientos del estudio',
    api: sunatDueDatesService,
    editLabel: 'Editar vencimientos del estudio',
    savedMessage: 'Vencimientos del estudio actualizados',
    errorMessage: 'No se pudieron guardar los vencimientos del estudio',
    description:
      'Las fechas internas con las que trabaja el estudio para cada periodo y último dígito del RUC (por ejemplo, para evaluar las declaraciones PDT 621). Pueden ser anteriores a las de SUNAT. Las que difieren del cronograma de SUNAT se marcan con un punto ámbar.',
  },
  {
    key: 'sunat',
    label: 'Vencimientos SUNAT',
    api: sunatOfficialDueDatesService,
    editLabel: 'Editar cronograma de SUNAT',
    savedMessage: 'Cronograma de SUNAT actualizado',
    errorMessage: 'No se pudo guardar el cronograma de SUNAT',
    description:
      'El «Cronograma de Obligaciones Tributarias Mensuales» que publica SUNAT: la fecha límite de cada periodo según el último dígito del RUC. Se edita cuando SUNAT publica el cronograma del nuevo año; no se crean calendarios nuevos.',
  },
];

/** Una tabla de 12 meses × 10 dígitos, con su propia edición (solo quien puede administrar). */
const DueDatesTable = ({
  tab,
  canManage,
  compareWith,
  onSaved,
}: {
  tab: (typeof TABS)[number];
  canManage: boolean;
  /** Solo en la pestaña del estudio: el cronograma de SUNAT, para marcar las fechas que difieren. */
  compareWith?: SunatDueDateRow[];
  onSaved?: () => void;
}) => {
  const [rows, setRows] = useState<SunatDueDateRow[]>([]);
  const [editing, setEditing] = useState<EditableRows | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      setRows(await tab.api.list());
    } catch (err) {
      setError(extractApiErrorMessage(err, 'No se pudo cargar el cronograma de vencimientos.'));
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    void load();
  }, [load]);

  const patchCell = (month: number, digit: number, value: string) => {
    setEditing((prev) => {
      if (!prev) return prev;
      const dates = [...prev[month]] as SunatDueDateRow['dates'];
      dates[digit] = value;
      return { ...prev, [month]: dates };
    });
  };

  const handleSave = async () => {
    if (!editing) return;
    try {
      setSaving(true);
      setError('');
      const payload: SunatDueDateUpdateInput[] = Object.entries(editing).map(([month, dates]) => ({ month: Number(month), dates }));
      setRows(await tab.api.update(payload));
      setEditing(null);
      notify.success(tab.savedMessage);
      onSaved?.();
    } catch (err) {
      notify.error(tab.errorMessage, extractApiErrorMessage(err, 'Intente de nuevo.'));
    } finally {
      setSaving(false);
    }
  };

  const otherOf = (month: number, digit: number): string | undefined => compareWith?.find((r) => r.month === month)?.dates[digit];

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <p className="max-w-3xl text-sm text-slate-600">{tab.description}</p>
        {canManage ? (
          editing ? (
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:shrink-0 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={() => setEditing(null)}
                disabled={saving}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancelar
              </button>
              <Button onClick={() => void handleSave()} disabled={saving}>
                <i className={`fas ${saving ? 'fa-spinner fa-spin' : 'fa-save'} mr-2`} aria-hidden />
                {saving ? 'Guardando…' : 'Guardar cambios'}
              </Button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setEditing(toEditable(rows))}
              disabled={loading}
              className="shrink-0 rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-900 disabled:opacity-50"
            >
              <i className="fas fa-pen mr-2" aria-hidden />
              {tab.editLabel}
            </button>
          )
        ) : null}
      </div>

      {error ? <Alert variant="error">{error}</Alert> : null}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-full border-collapse">
            <thead>
              <tr className="bg-slate-50">
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
                  <td colSpan={11} className="px-4 py-8 text-center text-sm text-slate-500">
                    <i className="fas fa-spinner fa-spin mr-2" aria-hidden />
                    Cargando…
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const dates = editing ? editing[row.month] : row.dates;
                  return (
                    <tr key={row.month} className="hover:bg-slate-50/80">
                      <td className={`${TD} whitespace-nowrap text-left font-semibold text-slate-800`}>{MONTH_LABELS[row.month - 1] ?? row.month}</td>
                      {DIGITS.map((d) => {
                        const other = otherOf(row.month, d);
                        const differs = !editing && other !== undefined && !!dates[d] && !!other && other !== dates[d];
                        return (
                          <td key={d} className={`${TD} whitespace-nowrap`}>
                            {editing ? (
                              <input
                                type="date"
                                value={dates[d] || ''}
                                onChange={(e) => patchCell(row.month, d, e.target.value)}
                                className="w-full min-w-[120px] rounded border border-slate-300 px-1.5 py-1 text-xs outline-none focus:ring-2 focus:ring-primary-500"
                              />
                            ) : (
                              <span className={`${dates[d] ? '' : 'text-slate-300'} ${differs ? 'font-semibold text-slate-900' : ''}`} title={differs ? `SUNAT: ${formatDueDateShort(other)}` : undefined}>
                                {dates[d] ? formatDueDateShort(dates[d]) : '—'}
                                {differs ? <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-amber-500 align-middle" aria-label={`Difiere de SUNAT (${formatDueDateShort(other)})`} /> : null}
                              </span>
                            )}
                          </td>
                        );
                      })}
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

/**
 * Recursos → Vencimientos: los vencimientos INTERNOS del estudio (con los que trabaja el estudio) y el cronograma
 * OFICIAL de SUNAT, en pestañas. Son calendarios distintos; el administrador edita los dos.
 */
const SunatDueDatesCalendar = () => {
  const canView = usePermission(P.financeSunatDueDatesView);
  const canManage = usePermission(P.financeSunatDueDatesManage);
  const [tab, setTab] = useState<TabKey>('estudio');
  const [official, setOfficial] = useState<SunatDueDateRow[] | undefined>(undefined);

  const loadOfficial = useCallback(async () => {
    try {
      setOfficial(await sunatOfficialDueDatesService.list());
    } catch {
      setOfficial(undefined); // sin comparación: no impide ver ni editar el del estudio
    }
  }, []);

  useEffect(() => {
    if (canView) void loadOfficial();
  }, [canView, loadOfficial]);

  if (!canView) {
    return (
      <div className={PAGE_WORKSPACE_CLASS}>
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-slate-500">No tiene permiso para ver esta información.</div>
      </div>
    );
  }

  const current = TABS.find((t) => t.key === tab) ?? TABS[0];

  return (
    <div className={PAGE_WORKSPACE_CLASS}>
      <div>
        <PageHeading hint="Fecha límite de cada periodo según el último dígito del RUC. «Vencimientos del estudio» son las fechas internas con las que trabaja el estudio; «Vencimientos SUNAT» es el cronograma oficial. Son calendarios distintos y el administrador puede editar ambos; no se crean calendarios nuevos.">
          Vencimientos
        </PageHeading>
      </div>

      <div role="tablist" aria-label="Calendario de vencimientos" className="flex gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold transition-colors ${
              tab === t.key ? 'border-primary-600 text-primary-700' : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <DueDatesTable
        key={current.key}
        tab={current}
        canManage={canManage}
        compareWith={current.key === 'estudio' ? official : undefined}
        onSaved={current.key === 'sunat' ? () => void loadOfficial() : undefined}
      />
    </div>
  );
};

export default SunatDueDatesCalendar;
