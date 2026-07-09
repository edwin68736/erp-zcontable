import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { auth } from '../services/auth';
import { getHomeSections } from '../navigation/homeShortcuts';
import { PAGE_WORKSPACE_CLASS } from '../constants/pageLayout';

function greetingForHour(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Buenos días';
  if (h < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

const Home = () => {
  const user = auth.getUser();
  const displayName = user?.name?.trim() || user?.username?.trim() || 'Usuario';
  const sections = useMemo(() => getHomeSections(), []);

  return (
    <div className={PAGE_WORKSPACE_CLASS}>
      <div className="rounded-2xl border border-slate-200/80 bg-white/90 backdrop-blur-sm shadow-sm overflow-hidden">
        <div className="bg-gradient-to-br from-primary-700 via-primary-600 to-emerald-700 px-6 py-8 sm:px-8 text-white">
          <p className="text-sm font-medium text-white/80">{greetingForHour()}</p>
          <h1 className="mt-1 text-2xl sm:text-3xl font-bold tracking-tight">{displayName}</h1>
          <p className="mt-2 text-sm text-white/85 max-w-xl">
            Accesos rápidos a las áreas de ZContable según su rol. Solo verá las opciones para las que tiene permiso.
          </p>
        </div>
      </div>

      {sections.length === 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-6 text-sm text-amber-900">
          <p className="font-medium">Sin módulos asignados</p>
          <p className="mt-1 text-amber-800/90">
            Su usuario no tiene permisos de navegación configurados. Contacte al administrador del estudio para
            asignarle un rol.
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {sections.map((section) => (
            <section key={section.id} aria-labelledby={`home-${section.id}`}>
              <div className="flex items-center gap-2 mb-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-50 text-primary-700">
                  <i className={section.icon} aria-hidden />
                </span>
                <h2 id={`home-${section.id}`} className="text-lg font-semibold text-slate-800">
                  {section.label}
                </h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {section.items.map((item) => (
                  <Link
                    key={`${section.id}-${item.to}`}
                    to={item.to}
                    className="group flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-primary-200 hover:shadow-md transition-all"
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600 group-hover:bg-primary-50 group-hover:text-primary-700 transition-colors">
                      <i className={item.icon} aria-hidden />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-slate-800 group-hover:text-primary-800">
                        {item.label}
                      </span>
                      <span className="mt-0.5 block text-xs text-slate-500 truncate">{item.to}</span>
                    </span>
                    <i className="fas fa-chevron-right ml-auto mt-1 text-xs text-slate-300 group-hover:text-primary-500" />
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
};

export default Home;
