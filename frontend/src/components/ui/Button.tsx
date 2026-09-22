import { forwardRef } from 'react';
import type { ButtonHTMLAttributes } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger';
}

const VARIANT_CLASSES: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary: 'bg-primary-600 text-white hover:bg-primary-700',
  secondary: 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50',
  danger: 'bg-red-600 text-white hover:bg-red-700',
};

/**
 * Botón de acción único: antes cada pantalla copiaba a mano la misma clase
 * con derivas (rounded-lg vs rounded-full, py-2 vs py-2.5, disabled:opacity-50
 * vs -60). `className` agrega utilidades puntuales (iconos, ancho); no
 * reescribe color/radio/relleno base.
 */
const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', className = '', type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none ${VARIANT_CLASSES[variant]} ${className}`.trim()}
      {...props}
    />
  ),
);

Button.displayName = 'Button';

export default Button;
