import type { ReactNode } from 'react';

interface PageHeadingProps {
  children: ReactNode;
  className?: string;
}

/**
 * Título de página único (siempre <h1>): antes cada pantalla mezclaba
 * <h1>/<h2> y hasta 4 tamaños/pesos distintos para el mismo rol.
 * `className` solo debe llevar utilidades de layout (flex, gap, margin),
 * nunca tamaño/peso/color de texto — eso ya lo define este componente.
 */
const PageHeading = ({ children, className = '' }: PageHeadingProps) => (
  <h1 className={`text-2xl font-bold text-slate-800 tracking-tight${className ? ` ${className}` : ''}`}>
    {children}
  </h1>
);

export default PageHeading;
