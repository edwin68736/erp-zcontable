import { Link } from 'react-router-dom';

type RowActionLinkProps = {
  to: string;
  /** Clase de ícono FontAwesome sin el prefijo `fas`, p.ej. `fa-pen`, `fa-eye`. */
  icon: string;
  /** Texto accesible (title + aria-label) — el botón solo muestra el ícono. */
  label: string;
};

/**
 * Botón de acción por fila (ver/editar detalle) para las tablas de Supervisor/Asistente:
 * ícono con fondo sólido en vez de un link de solo texto, más compacto y visualmente claro.
 * El texto se conserva como `title`/`aria-label` para accesibilidad y como tooltip nativo.
 */
export function RowActionLink({ to, icon, label }: RowActionLinkProps) {
  return (
    <Link
      to={to}
      title={label}
      aria-label={label}
      className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-primary-600 text-white shadow-sm hover:bg-primary-700 transition-colors"
    >
      <i className={`fas ${icon} text-xs`} aria-hidden />
    </Link>
  );
}
