import { forwardRef, useId } from 'react';
import type { InputHTMLAttributes } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  containerClassName?: string;
}

/**
 * Campo de texto único: reemplaza las variantes de radio/relleno/borde
 * que antes se repetían a mano en cada formulario (CompanyForm, UserForm,
 * ProductForm, PaymentForm, DocumentForm…). `className` agrega utilidades
 * puntuales (p. ej. font-mono, resize-y); no reescribe radio/padding/borde base.
 */
const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className = '', containerClassName = '', id, ...props }, ref) => {
    const generatedId = useId();
    const inputId = id ?? generatedId;

    return (
      <div className={containerClassName}>
        {label ? (
          <label htmlFor={inputId} className="block text-sm font-medium text-slate-700 mb-1">
            {label}
          </label>
        ) : null}
        <input
          id={inputId}
          ref={ref}
          className={`w-full px-3 py-2.5 rounded-lg border text-sm outline-none transition-colors disabled:opacity-60 disabled:bg-slate-50 ${
            error
              ? 'border-red-300 focus:ring-2 focus:ring-red-500 focus:border-red-500'
              : 'border-slate-300 focus:ring-2 focus:ring-primary-500 focus:border-primary-500'
          } ${className}`.trim()}
          aria-invalid={error ? true : undefined}
          {...props}
        />
        {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
      </div>
    );
  },
);

Input.displayName = 'Input';

export default Input;
