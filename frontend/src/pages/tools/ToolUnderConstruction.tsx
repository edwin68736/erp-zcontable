import { Link, Navigate, useParams } from 'react-router-dom';
import PageHeading from '../../components/ui/PageHeading';
import { TOOLS, findTool, toolPath } from '../../navigation/toolsConfig';

/**
 * Vista temporal de cada herramienta (`/tools/:slug`): "En construcción". Se reemplaza por la pantalla
 * real de cada herramienta cuando esté lista. Sin permisos por ahora.
 */
const ToolUnderConstruction = () => {
  const { slug } = useParams();
  const tool = findTool(slug);
  if (!tool) return <Navigate to={toolPath(TOOLS[0].slug)} replace />;

  return (
    <div className="space-y-6 pt-2">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-primary-700/90">Herramientas</p>
        <PageHeading className="mt-1">{tool.label}</PageHeading>
        <p className="text-slate-500 mt-1 text-sm font-medium">{tool.description}</p>
      </div>

      <div className="bg-white rounded-[2rem] p-8 shadow-sm border border-slate-100 flex items-center justify-center min-h-[16rem]">
        <div className="text-center max-w-md">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
            <i className="fas fa-person-digging text-3xl" aria-hidden />
          </div>
          <p className="text-base font-semibold text-slate-700">En construcción</p>
          <p className="text-sm text-slate-500 mt-2">
            Estamos preparando <strong>{tool.label}</strong>. Pronto podrás usarla desde aquí.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2" aria-label="Otras herramientas">
        {TOOLS.filter((t) => t.slug !== tool.slug).map((t) => (
          <Link
            key={t.slug}
            to={toolPath(t.slug)}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
          >
            <i className={`${t.icon} text-primary-700`} aria-hidden />
            {t.label}
          </Link>
        ))}
      </div>
    </div>
  );
};

export default ToolUnderConstruction;
