import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { subscriptionPlansService } from '../services/subscriptionPlans';
import type { SubscriptionPlan } from '../types/dashboard';
import { auth } from '../services/auth';
import { P } from '../rbac/codes';
import PageHeading from '../components/ui/PageHeading';
import { notify } from '../utils/notify';

const SubscriptionPlansList = () => {
  const canEdit = useMemo(
    () => auth.hasPermission(P.subscriptionPlansCreate) || auth.hasPermission(P.subscriptionPlansUpdate),
    [],
  );
  const canLiquidate = useMemo(() => auth.hasPermission(P.liquidationRun), []);

  const [list, setList] = useState<SubscriptionPlan[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    void subscriptionPlansService
      .list()
      .then(setList)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const runLiq = async () => {
    try {
      const r = await subscriptionPlansService.runLiquidation();
      const summary = `${r.created_documents} cargo(s) generados, ${r.skipped} omitidos.`;
      const errs = r.errors ?? [];
      if (errs.length) void notify.warning('Liquidación con errores', `${summary} Errores: ${errs.join('; ')}`);
      else void notify.success('Liquidación ejecutada', summary);
    } catch {
      void notify.error('No se pudo ejecutar la liquidación');
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <PageHeading hint="Planes con tramos por facturación y precio mensual.">Planes de suscripción</PageHeading>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
          {canLiquidate ? (
            <button
              type="button"
              onClick={() => void runLiq()}
              className="w-full sm:w-auto px-4 py-2 rounded-lg border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <i className="fas fa-calendar-check mr-2 text-xs"></i>
              Ejecutar liquidación mensual
            </button>
          ) : null}
          {canEdit ? (
            <Link
              to="/subscription-plans/new"
              className="inline-flex w-full sm:w-auto items-center justify-center gap-2 px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium"
            >
              <i className="fas fa-plus text-xs"></i> Nuevo plan
            </Link>
          ) : null}
        </div>
      </div>
      {loading ? (
        <div className="text-sm text-slate-500">Cargando…</div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-500">
              <tr>
                <th className="text-left px-4 py-3">Plan</th>
                <th className="text-left px-4 py-3">Categoría</th>
                <th className="text-left px-4 py-3">Base liquidación</th>
                <th className="text-left px-4 py-3">Tramos</th>
                <th className="text-right px-4 py-3">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {list.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-3 font-medium">{p.name}</td>
                  <td className="px-4 py-3 text-slate-600">{p.plan_category?.name ?? '—'}</td>
                  <td className="px-4 py-3 text-xs font-mono">{p.billing_basis}</td>
                  <td className="px-4 py-3">{p.tiers?.length ?? 0}</td>
                  <td className="px-4 py-3 text-right">
                    {canEdit ? (
                      <Link to={`/subscription-plans/${p.id}/edit`} className="text-primary-700 text-xs font-medium">
                        Editar
                      </Link>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Link to="/plan-categories" className="text-sm text-primary-700 font-medium">
        ← Categorías de planes
      </Link>
    </div>
  );
};

export default SubscriptionPlansList;
