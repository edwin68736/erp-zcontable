import { Link, useLocation } from 'react-router-dom';
import {
  activityModuleMeta,
  resolveActivityWorkspace,
  workspaceHomePath,
} from '../../navigation/activityRoutes';

/** Placeholder temporal de navegación (F1b). Sustituido por el módulo real en fases F3–F6. */
const ActivityModulePlaceholder = () => {
  const location = useLocation();
  const workspace = resolveActivityWorkspace(location.pathname);
  const homePath = workspaceHomePath(workspace);
  const segment = location.pathname.split('/').filter(Boolean).pop() ?? '';
  const item = activityModuleMeta(segment);

  const title = item?.label ?? 'Módulo de actividades';
  const phase = item?.phaseLabel ?? 'Próximamente';

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <Link to={homePath} className="text-sm text-primary-700 hover:underline">
          ← Volver
        </Link>
        <h2 className="text-xl font-semibold text-slate-800 mt-2">{title}</h2>
        <p className="text-sm text-slate-500 mt-1">
          {item?.description ?? 'Este módulo se implementará en una fase posterior del plan aprobado.'}
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
        <span className="inline-block text-[10px] font-semibold uppercase tracking-wide text-amber-700 bg-amber-50 px-3 py-1 rounded-full mb-4">
          {phase}
        </span>
        <i className={`${item?.icon ?? 'fas fa-drafting-compass'} text-4xl text-slate-300 block mb-3`} aria-hidden />
        <p className="text-sm font-medium text-slate-700">En preparación</p>
        <p className="text-xs text-slate-500 mt-2 max-w-md mx-auto">
          La navegación ya está disponible. El listado de empresas y el detalle operativo se habilitarán en la fase
          correspondiente.
        </p>
      </div>
    </div>
  );
};

export default ActivityModulePlaceholder;
