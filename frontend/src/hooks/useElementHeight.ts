import { useLayoutEffect, useRef, useState } from 'react';

/**
 * Mide el alto real (renderizado) de un elemento y lo mantiene actualizado si
 * cambia (fuente, zoom, contenido) usando ResizeObserver — evita adivinar un
 * alto fijo en píxeles. Usado para apilar una 2ª fila de encabezado sticky
 * justo debajo de la 1ª (ver Pdt601ListPage.tsx).
 */
export function useElementHeight<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setHeight(el.getBoundingClientRect().height);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, height] as const;
}
