import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supervisorsService, type SupervisorPdtTypeSummary } from '../../services/supervisors';
import { auth } from '../../services/auth';
import { P } from '../../rbac/codes';
import { PAGE_WORKSPACE_CLASS } from '../../constants/pageLayout';
import { currentPeriodYM } from '../../utils/supervisorLabels';
import { extractApiErrorMessage } from '../../utils/apiError';
import { PdtSummarySection } from '../supervisors/SupervisorDashboard';

/**
 * Resumen PDT 601/621 del propio asistente (docs/diseno-estados-pdt601-pdt621-2026-09-16.md §12.2)
 * — mismo endpoint y mismo componente que ya usa el dashboard del supervisor
 * (`/supervisors/dashboard/pdt-summary`), sin mandar ningún parámetro de rol: el backend ya escopea
 * las empresas al usuario logueado vía `GetAllowedCompanyIDs` (ver AssignedCompaniesListPage.tsx
 * para el mismo patrón "un componente, dos rutas"). No incluye "Desempeño por asistente" — acá solo
 * hay una persona, el resumen general ya ES su desempeño.
 */
const AssistantDashboard = () => {
  const allowed = useMemo(() => auth.hasPermission(P.supervisorsDashboardView), []);
  const [periodYm, setPeriodYm] = useState(currentPeriodYM());
  const [pdtData, setPdtData] = useState<Record<'pdt_601' | 'pdt_621', SupervisorPdtTypeSummary> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    void supervisorsService
      .pdtDashboardSummary({ period_ym: periodYm })
      .then((res) => {
        if (!cancelled) setPdtData(res);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setPdtData(null);
        setError(extractApiErrorMessage(err, 'No se pudo cargar el resumen PDT 601/621.'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [allowed, periodYm]);

  if (!allowed) {
    return <p className="p-6 text-center text-slate-600">Sin permiso para ver este resumen.</p>;
  }

  return (
    <div className={PAGE_WORKSPACE_CLASS}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-800">Mi resumen PDT 601 / 621</h2>
          <p className="text-sm text-slate-500">Cómo vienen sus empresas asignadas en el período.</p>
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
        <Link to="/assistant" className="text-primary-700 font-medium">
          → Panel del asistente
        </Link>
      </div>

      <PdtSummarySection
        loading={loading}
        error={error}
        summary601={pdtData?.pdt_601}
        summary621={pdtData?.pdt_621}
        workspace="assistant"
      />
    </div>
  );
};

export default AssistantDashboard;
