import { Navigate, useParams } from 'react-router-dom';
import { isComingSoonSlug, PLACEHOLDER_PAGE_COPY } from '../navigation/sidebarConfig';

/**
 * Vista temporal para módulos operativos reservados (rutas `/m/:slug`).
 * Sustituir por layout del módulo cuando se implemente.
 */
const ModuleComingSoon = () => {
  const { slug } = useParams();

  if (!slug || !isComingSoonSlug(slug)) {
    return <Navigate to="/dashboard" replace />;
  }

  const copy = PLACEHOLDER_PAGE_COPY[slug];

  return (
    <div className="space-y-6 pt-2">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700/90">Módulo en preparación</p>
          <h1 className="text-3xl font-bold text-slate-800 tracking-tight mt-1">{copy.title}</h1>
          <p className="text-slate-500 mt-1 text-sm font-medium">{copy.subtitle}</p>
        </div>
      </div>

      <div className="bg-white rounded-[2rem] p-8 shadow-sm border border-slate-100 flex items-center justify-center min-h-[14rem]">
        <div className="text-center text-slate-400 max-w-md">
          <i className="fas fa-drafting-compass text-4xl mb-4 text-slate-300" aria-hidden />
          <p className="text-sm text-slate-600 font-medium">Próximamente</p>
          <p className="text-xs text-slate-500 mt-2">
            El menú lateral ya reserva este módulo; aquí se cargarán las pantallas cuando estén listas.
          </p>
        </div>
      </div>
    </div>
  );
};

export default ModuleComingSoon;
