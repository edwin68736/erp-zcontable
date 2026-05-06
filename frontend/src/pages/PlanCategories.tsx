import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { planCategoriesService } from '../services/planCategories';
import type { PlanCategory } from '../types/dashboard';
import { auth } from '../services/auth';

const PlanCategories = () => {
  const canEdit = auth.getRole() === 'Administrador' || auth.getRole() === 'Supervisor';
  const [list, setList] = useState<PlanCategory[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void planCategoriesService.list().then(setList).finally(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-800">Categorías de planes</h2>
          <p className="text-sm text-slate-500">Agrupadores comerciales (ej. clientes legacy, nuevos).</p>
        </div>
        {canEdit ? (
          <Link
            to="/plan-categories/new"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary-600 text-white text-sm font-medium"
          >
            <i className="fas fa-plus text-xs"></i> Nueva categoría
          </Link>
        ) : null}
      </div>
      {loading ? (
        <div className="text-sm text-slate-500">Cargando…</div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left px-4 py-3">Código</th>
                <th className="text-left px-4 py-3">Nombre</th>
                <th className="text-left px-4 py-3">Orden</th>
                <th className="text-left px-4 py-3">Activo</th>
                <th className="text-right px-4 py-3">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {list.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-3 font-mono text-xs">{c.code}</td>
                  <td className="px-4 py-3 font-medium">{c.name}</td>
                  <td className="px-4 py-3">{c.sort_order}</td>
                  <td className="px-4 py-3">{c.active ? 'Sí' : 'No'}</td>
                  <td className="px-4 py-3 text-right">
                    {canEdit ? (
                      <Link to={`/plan-categories/${c.id}/edit`} className="text-primary-700 text-xs font-medium">
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
      <Link to="/subscription-plans" className="text-sm text-primary-700 font-medium">
        → Ver planes de suscripción
      </Link>
    </div>
  );
};

export default PlanCategories;
