import { forwardRef, useEffect, useRef, useState, type ChangeEvent, type FocusEvent } from 'react';

/**
 * Campo de monto: reemplaza `<input type="number">` en formularios de dinero.
 *
 * Por qué: un `<input type="number">` controlado por un `value` numérico (que arranca en 0) no deja
 * borrar ese 0 con naturalidad — al vaciar el campo `e.target.value` es `""`, `Number("") || 0`
 * vuelve a dar 0, y React repinta el input con el mismo "0" que el usuario acababa de borrar. Acá el
 * campo es de texto (sin las flechitas nativas de number, que tampoco se querían) y separa los
 * miles con coma en vivo mientras se escribe, con hasta 2 decimales separados por punto — mismo
 * formato que ya se usa para mostrar montos en toda la app (4,363.85). En 0 se muestra vacío, no
 * "0", así que no hay nada que "no se deja borrar".
 */

function formatIntWithCommas(intDigits: string): string {
  if (!intDigits) return '';
  return intDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Cuenta dígitos + el punto decimal (si aparece) antes de `pos` en `raw`. El punto cuenta como un
 * carácter "significativo" más (igual que un dígito) porque, si no, un cursor recién puesto después
 * del "." que el usuario acaba de escribir queda indistinguible de uno puesto justo antes — y al
 * recolocar el cursor en el texto reformateado termina ANTES del punto, no después. Eso hace que los
 * dígitos que el usuario escribe a continuación (los decimales) se inserten en la parte entera en vez
 * de la decimal (bug real: "1,500.00" terminaba en "15,000,000").
 */
function significantCountBefore(raw: string, pos: number): number {
  let n = 0;
  let sawDot = false;
  for (let i = 0; i < pos && i < raw.length; i++) {
    const c = raw[i];
    if (/\d/.test(c)) n++;
    else if (c === '.' && !sawDot) {
      n++;
      sawDot = true;
    }
  }
  return n;
}

/** Posición en `formatted` justo después de encontrar `count` caracteres significativos (dígitos + punto). */
function posAfterSignificant(formatted: string, count: number): number {
  if (count <= 0) return 0;
  let n = 0;
  let sawDot = false;
  for (let i = 0; i < formatted.length; i++) {
    const c = formatted[i];
    if (/\d/.test(c)) {
      n++;
      if (n === count) return i + 1;
    } else if (c === '.' && !sawDot) {
      n++;
      sawDot = true;
      if (n === count) return i + 1;
    }
  }
  return formatted.length;
}

/** Limpia texto libre a "solo dígitos + a lo más un punto decimal, 2 decimales". */
function sanitizeMoneyText(raw: string): string {
  let cleaned = raw.replace(/[^\d.]/g, '');
  const firstDot = cleaned.indexOf('.');
  if (firstDot !== -1) {
    cleaned = cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '');
  }
  const [intPart, decPart] = cleaned.split('.');
  const dec = decPart != null ? decPart.slice(0, 2) : undefined;
  return dec != null ? `${intPart}.${dec}` : (intPart ?? '');
}

function formatMoneyText(cleaned: string): string {
  const [intPart, decPart] = cleaned.split('.');
  const formattedInt = formatIntWithCommas(intPart || '');
  return decPart != null ? `${formattedInt}.${decPart}` : formattedInt;
}

function formatValueForDisplay(n: number | null | undefined): string {
  if (!n) return '';
  const [intPart, decPart] = Math.abs(n).toFixed(2).split('.');
  const formattedInt = formatIntWithCommas(intPart);
  return decPart === '00' ? formattedInt : `${formattedInt}.${decPart}`;
}

type MoneyFieldProps = {
  value: number | null | undefined;
  onChange: (value: number) => void;
  disabled?: boolean;
  className?: string;
  id?: string;
  placeholder?: string;
  /** Si true, un campo vacío llama onChangeNullable(null) en vez de onChange(0) — para campos donde
   * "vacío" y "cero" significan cosas distintas (p. ej. "usar el valor sugerido" vs "override en 0"). */
  nullable?: boolean;
  onChangeNullable?: (value: number | null) => void;
};

const MoneyField = forwardRef<HTMLInputElement, MoneyFieldProps>(
  ({ value, onChange, onChangeNullable, nullable, disabled, className = '', id, placeholder }, forwardedRef) => {
    const innerRef = useRef<HTMLInputElement | null>(null);
    const [text, setText] = useState(() => formatValueForDisplay(value));
    const [focused, setFocused] = useState(false);

    // Si el valor externo cambia (carga del registro, "usar sugerido", etc.) y el campo no está en
    // edición activa, resincroniza el texto mostrado.
    useEffect(() => {
      if (!focused) setText(formatValueForDisplay(value));
    }, [value, focused]);

    const setRefs = (el: HTMLInputElement | null) => {
      innerRef.current = el;
      if (typeof forwardedRef === 'function') forwardedRef(el);
      else if (forwardedRef) (forwardedRef as { current: HTMLInputElement | null }).current = el;
    };

    const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
      const el = e.target;
      const rawBefore = el.value;
      const cursorBefore = el.selectionStart ?? rawBefore.length;
      const significantBeforeCursor = significantCountBefore(rawBefore, cursorBefore);

      const cleaned = sanitizeMoneyText(rawBefore);
      const newText = formatMoneyText(cleaned);
      const newPos = posAfterSignificant(newText, significantBeforeCursor);

      // Corrige el DOM ya mismo, en el mismo evento (sin esperar el próximo repintado React) — si
      // el ajuste del cursor se deja para un requestAnimationFrame posterior, tipeos rápidos
      // seguidos alcanzan a pisarse entre sí (el segundo carácter se lee con el cursor todavía sin
      // corregir) y el texto termina duplicado/desordenado.
      el.value = newText;
      el.setSelectionRange(newPos, newPos);

      setText(newText);
      const isEmpty = cleaned === '' || cleaned === '.';
      if (isEmpty && nullable) {
        onChangeNullable?.(null);
      } else {
        const numeric = Number(isEmpty ? '0' : cleaned);
        onChange(Number.isFinite(numeric) ? numeric : 0);
      }
    };

    const handleFocus = () => setFocused(true);
    const handleBlur = (e: FocusEvent<HTMLInputElement>) => {
      setFocused(false);
      // Al salir, "4363." o "4363" quedan igual re-formateados a partir del valor numérico real.
      setText(formatValueForDisplay(value));
      e.target.setSelectionRange(0, 0);
    };

    return (
      <input
        ref={setRefs}
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        disabled={disabled}
        value={text}
        placeholder={placeholder ?? '0.00'}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onChange={handleChange}
        className={className}
      />
    );
  },
);

MoneyField.displayName = 'MoneyField';

export default MoneyField;
