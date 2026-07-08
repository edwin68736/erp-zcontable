import { Link } from 'react-router-dom';
import {
  activityHubItems,
  activitiesBasePath,
  type ActivityWorkspace,
} from '../../navigation/activityRoutes';

type ActivityHubNavProps = {
  workspace: ActivityWorkspace;
};

const ActivityHubNav = ({ workspace }: ActivityHubNavProps) => {
  const items = activityHubItems(workspace);
  const hubPath = activitiesBasePath(workspace);

  return (
    <section className="space-y-3" aria-label="Control de actividades">
      <div>
        <h3 className="text-sm font-semibold text-slate-800">Módulos de actividades</h3>
        <p className="text-xs text-slate-500 mt-0.5">
          Acceso a PDT y módulos operativos. El listado de controles mensuales permanece disponible mientras
          se completa la migración.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {items.map((item) => {
          const cardInner = (
            <>
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-700">
                <i className={item.icon} aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-800">{item.label}</p>
                <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{item.description}</p>
                {!item.available && item.phaseLabel ? (
                  <span className="inline-block mt-2 text-[10px] font-semibold uppercase tracking-wide text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">
                    {item.phaseLabel}
                  </span>
                ) : null}
              </div>
              <i className="fas fa-chevron-right text-xs text-slate-300 shrink-0 self-center" aria-hidden />
            </>
          );

          return (
            <Link
              key={item.id}
              to={item.to}
              className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 transition-colors hover:border-primary-200 hover:bg-primary-50/30"
            >
              {cardInner}
            </Link>
          );
        })}
      </div>
      <p className="text-xs text-slate-400">
        Hub:{' '}
        <Link to={hubPath} className="text-primary-700 font-medium hover:underline">
          {hubPath}
        </Link>
      </p>
    </section>
  );
};

export default ActivityHubNav;
