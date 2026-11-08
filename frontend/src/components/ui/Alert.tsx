import type { ReactNode } from 'react';

export type AlertVariant = 'error' | 'warning' | 'success' | 'info';

interface AlertProps {
  variant?: AlertVariant;
  children: ReactNode;
  /** Solo utilidades de layout (márgenes, ancho, flex…): el color, borde, radio y tamaño ya los define el componente. */
  className?: string;
}

const VARIANT: Record<AlertVariant, string> = {
  error: 'border-red-200 bg-red-50 text-red-800',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  info: 'border-sky-200 bg-sky-50 text-sky-900',
};

/**
 * Aviso en línea (error, advertencia, éxito o información). Antes cada pantalla armaba el suyo con ~10 combinaciones
 * distintas de color de texto (red-600/700/800), radio y relleno para lo mismo.
 * Los errores se anuncian a los lectores de pantalla (role="alert"); el éxito como estado (role="status").
 */
const Alert = ({ variant = 'info', children, className = '' }: AlertProps) => (
  <div
    role={variant === 'error' ? 'alert' : variant === 'success' ? 'status' : undefined}
    className={`rounded-lg border px-3 py-2 text-sm ${VARIANT[variant]}${className ? ` ${className}` : ''}`}
  >
    {children}
  </div>
);

export default Alert;
