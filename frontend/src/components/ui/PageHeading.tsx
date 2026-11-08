import type { ReactNode } from 'react';
import HintTip from './HintTip';

interface PageHeadingProps {
  children: ReactNode;
  className?: string;
  /** Explicación de la pantalla: se muestra como un icono ⓘ junto al título, sin ocupar una línea propia. */
  hint?: string;
}

/**
 * Título de página único (siempre <h1>): antes cada pantalla mezclaba
 * <h1>/<h2> y hasta 4 tamaños/pesos distintos para el mismo rol.
 * `className` solo debe llevar utilidades de layout (flex, gap, margin),
 * nunca tamaño/peso/color de texto — eso ya lo define este componente.
 * El título es compacto (20 px) para dejar la altura a la información de la vista;
 * las explicaciones largas van en `hint`, no en un párrafo debajo.
 */
const PageHeading = ({ children, className = '', hint }: PageHeadingProps) => {
  const h1 = (
    <h1 className={`text-xl font-bold text-slate-800 tracking-tight leading-7${className ? ` ${className}` : ''}`}>
      {children}
    </h1>
  );
  if (!hint) return h1;
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      {h1}
      <HintTip text={hint} />
    </div>
  );
};

export default PageHeading;
