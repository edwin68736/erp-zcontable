import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supervisorsService, type SupervisorMonthlyControl } from '../../services/supervisors';
import { auth } from '../../services/auth';
import { P } from '../../rbac/codes';
import { controlStatusLabel, currentPeriodYM } from '../../utils/supervisorLabels';

/** Panel operativo del asistente: ejecuta tareas sobre empresas asignadas (vía AccessService). */
const AssistantWorkspace = () => {
  const allowed = useMemo(() => auth.hasPermission(P.supervisorsControlsView), []);
  const [periodYm, setPeriodYm] = useState(currentPeriodYM());
  const [list, setList] = useState<SupervisorMonthlyControl[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await supervisorsService.listControls({
        period_ym: periodYm,
        per_page: 50,
        page: 1,
      });
      setList(Array.isArray(res.items) ? res.items : []);
    } catch {
      setList([]);
    } finally {
      setLoading(false);
    }
  }, [periodYm]);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  const pending = useMemo(
    () => list.filter((c) => c.general_status === 'pendiente' || c.general_status === 'observado' || c.general_status === 'vencido'),
    [list],
  );

  if (!allowed) {
    return <p className="p-6 text-center text-slate-600">Sin permiso para el panel de asistente.</p>;
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-800">Panel del asistente</h2>
          <p className="text-sm text-slate-500">
            Registre avance, suba documentos y complete tareas. El supervisor revisará y aprobará.
          </p>
        </div>
        <label className="text-sm text-slate-600">
          Período
          <input
            type="month"
            value={periodYm}
            onChange={(e) => setPeriodYm(e.target.value)}
            className="block mt-1 border border-slate-200 rounded-lg px-3 py-1.5"
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-3 text-sm">
        <Link to="/finance/calendar" className="text-primary-700 font-medium">
          → Calendario global
        </Link>
        <Link to="/assistant/controls" className="text-primary-700 font-medium">
          → Todas mis tareas
        </Link>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="Empresas en período" value={list.length} />
        <Stat label="Pendientes / observadas" value={pending.length} tone="amber" />
        <Stat label="Al día" value={list.filter((c) => c.general_status === 'al_dia').length} tone="emerald" />
        <Stat label="Vencidas" value={list.filter((c) => c.general_status === 'vencido').length} tone="red" />
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Cargando…</p>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left px-4 py-3">Empresa</th>
                <th className="text-left px-4 py-3">Estado</th>
                <th className="text-right px-4 py-3">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pending.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-8 text-center text-slate-500">
                    No hay tareas pendientes en sus empresas asignadas.
                  </td>
                </tr>
              ) : (
                pending.map((row) => (
                  <tr key={row.id}>
                    <td className="px-4 py-3 font-medium">{row.company?.business_name ?? `#${row.company_id}`}</td>
                    <td className="px-4 py-3">{controlStatusLabel(row.general_status)}</td>
                    <td className="px-4 py-3 text-right">
                      <Link to={`/assistant/controls/${row.id}`} className="text-primary-700 text-xs font-medium">
                        Trabajar
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  const cls =
    tone === 'emerald'
      ? 'text-emerald-800 bg-emerald-50'
      : tone === 'amber'
        ? 'text-amber-800 bg-amber-50'
        : tone === 'red'
          ? 'text-red-800 bg-red-50'
          : 'text-slate-800 bg-white';
  return (
    <div className={`rounded-xl border border-slate-200 p-4 ${cls}`}>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-2xl font-semibold">{value}</p>
    </div>
  );
}

export default AssistantWorkspace;
