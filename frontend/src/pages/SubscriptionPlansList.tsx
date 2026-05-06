import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { subscriptionPlansService } from '../services/subscriptionPlans';
import type { SubscriptionPlan } from '../types/dashboard';
import { auth } from '../services/auth';

const SubscriptionPlansList = () => {
  const role = auth.getRole() ?? '';
  const canEdit = role === 'Administrador' || role === 'Supervisor';
  const canLiquidate = ['Administrador', 'Supervisor', 'Contador'].includes(role);

  const [list, setList] = useState<SubscriptionPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [liqMsg, setLiqMsg] = useState('');

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
      setLiqMsg('');
      const r = await subscriptionPlansService.runLiquidation();
      setLiqMsg(`Liquidación: ${r.created_documents} cargo(s) generados, ${r.skipped} omitidos.`);
      const errs = r.errors ?? [];
      if (errs.length) setLiqMsg((m) => m + ' Errores: ' + errs.join('; '));
    } catch {
      setLiqMsg('Error al ejecutar liquidación');
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-800">Planes de suscripción</h2>
          <p className="text-sm text-slate-500">Planes con tramos por facturación y precio mensual.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canLiquidate ? (
            <button
              type="button"
              onClick={() => void runLiq()}
              className="px-4 py-2 rounded-full border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <i className="fas fa-calendar-check mr-2 text-xs"></i>
              Ejecutar liquidación mensual
            </button>
          ) : null}
          {canEdit ? (
            <Link
              to="/subscription-plans/new"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary-600 text-white text-sm font-medium"
            >
              <i className="fas fa-plus text-xs"></i> Nuevo plan
            </Link>
          ) : null}
        </div>
      </div>
      {liqMsg ? <div className="text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-4 py-2">{liqMsg}</div> : null}
      {loading ? (
        <div className="text-sm text-slate-500">Cargando…</div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50">
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
