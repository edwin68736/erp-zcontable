import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { auth } from '../../services/auth';
import { P } from '../../rbac/codes';
import { controlStatusLabel, currentPeriodYM } from '../../utils/supervisorLabels';
import {
  fetchPdtWorkspaceData,
  formatPdtMetricsLine,
  pdtRowStatusLabel,
  pdtRowTypeLabel,
  type PdtWorkspaceData,
} from '../../utils/pdtClientAggregation';

/** Panel operativo del asistente: ejecuta tareas sobre empresas asignadas (vía AccessService). */
const AssistantWorkspace = () => {
  const allowed = useMemo(() => auth.hasPermission(P.supervisorsControlsView), []);
  const [periodYm, setPeriodYm] = useState(currentPeriodYM());
  const [pdtData, setPdtData] = useState<PdtWorkspaceData | null>(null);
  const [loading, setLoading] = useState(true);

  const list = pdtData?.controls ?? [];

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setPdtData(await fetchPdtWorkspaceData(periodYm));
    } catch {
      setPdtData(null);
    } finally {
      setLoading(false);
    }
  }, [periodYm]);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  const kpiPendientes = useMemo(
    () => list.filter((c) => c.general_status === 'pendiente').length,
    [list],
  );
  const kpiObservadas = useMemo(
    () => list.filter((c) => c.general_status === 'observado').length,
    [list],
  );
  const kpiVencidas = useMemo(
    () => list.filter((c) => c.general_status === 'vencido').length,
    [list],
  );
  const kpiCompletadas = useMemo(
    () => list.filter((c) => c.general_status === 'al_dia' || c.general_status === 'cerrado').length,
    [list],
  );

  const actionControls = useMemo(
    () =>
      list.filter(
        (c) =>
          c.general_status === 'pendiente' ||
          c.general_status === 'observado' ||
          c.general_status === 'vencido',
      ),
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
        <Link to="/assistant/activities/pdt-601" className="text-primary-700 font-medium">
          → PDT 601
        </Link>
        <Link to="/assistant/activities/pdt-621" className="text-primary-700 font-medium">
          → PDT 621
        </Link>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="Pendientes" value={kpiPendientes} tone="amber" />
        <Stat label="Observadas" value={kpiObservadas} tone="orange" />
        <Stat label="Vencidas" value={kpiVencidas} tone="red" />
        <Stat label="Completadas" value={kpiCompletadas} tone="emerald" />
      </div>

      {pdtData?.metrics ? (
        <p className="text-[10px] text-slate-400 font-mono" title="Métricas agregación PDT">
          {formatPdtMetricsLine(pdtData.metrics)}
          {pdtData.metrics.isPartialSample ? ' · muestra parcial (máx. 200 controles)' : ''}
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-slate-500">Cargando…</p>
      ) : (
        <>
          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-800">Controles que requieren acción</h3>
            <p className="text-xs text-slate-500">Empresas con control pendiente, observado o vencido en el período.</p>
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
                  {actionControls.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-4 py-8 text-center text-slate-500">
                        No hay controles que requieran acción en este período.
                      </td>
                    </tr>
                  ) : (
                    actionControls.map((row) => (
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
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-800">PDT 601 y PDT 621 — pendientes u observadas</h3>
            <p className="text-xs text-slate-500">
              Declaraciones que requieren trabajo operativo (incluye vencidas por fecha).
            </p>
            <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="text-left px-4 py-3">Empresa</th>
                    <th className="text-left px-4 py-3">PDT</th>
                    <th className="text-left px-4 py-3">Estado</th>
                    <th className="text-right px-4 py-3">Avance</th>
                    <th className="text-right px-4 py-3">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(pdtData?.actionRows.length ?? 0) === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                        No hay declaraciones PDT pendientes u observadas.
                      </td>
                    </tr>
                  ) : (
                    pdtData!.actionRows.map((row) => (
                      <tr key={`${row.controlId}-${row.declarationType}`}>
                        <td className="px-4 py-3">
                          <p className="font-medium">{row.companyName}</p>
                          {row.companyRuc ? <p className="text-xs text-slate-500">{row.companyRuc}</p> : null}
                        </td>
                        <td className="px-4 py-3">{pdtRowTypeLabel(row.declarationType)}</td>
                        <td className="px-4 py-3">
                          {pdtRowStatusLabel(row.status)}
                          {row.isOverdue ? (
                            <span className="ml-1 text-[10px] font-semibold text-red-600 uppercase">Vencida</span>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-right">{row.progressPct}%</td>
                        <td className="px-4 py-3 text-right">
                          <Link
                            to={`/assistant/controls/${row.controlId}`}
                            className="text-primary-700 text-xs font-medium"
                          >
                            Trabajar
                          </Link>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
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
        : tone === 'orange'
          ? 'text-orange-800 bg-orange-50'
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
