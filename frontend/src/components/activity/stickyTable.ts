import type { CSSProperties } from 'react';

/**
 * Utilidades compartidas para tablas con encabezado y columnas fijas (sticky).
 *
 * Patrón usado en las tablas de Supervisor/Asistente (Control PDT 601, PDT 621,
 * Detracciones, Buzón SOL, Empresas): encabezado fijo al hacer scroll vertical +
 * columnas de identificación (Código…Asistente) fijas al hacer scroll horizontal.
 *
 * Requisitos para que funcione (ver Pdt601ListPage.tsx para el ejemplo completo):
 * 1. El contenedor de scroll debe ser `overflow-auto` con alto acotado (p.ej.
 *    `max-h-[65vh]`) en vez de `overflow-x-auto` sobre <main> — por una regla real
 *    de CSS, en cuanto un contenedor tiene `overflow-x` distinto de `visible`, el
 *    navegador también fuerza su `overflow-y` a comportarse como `auto`, y ESE
 *    contenedor (no <main>) pasa a ser el "containing block" de `position: sticky`.
 * 2. Toda celda congelada (header y body) debe tener fondo OPACO siempre — nunca
 *    con modificador de opacidad tipo `/80` — porque durante el scroll horizontal
 *    el contenido de las columnas no congeladas pasa visualmente por debajo de la
 *    celda fija; cualquier transparencia deja ver ese contenido "a través".
 * 3. z-index: cuerpo congelado (Z_BODY_FROZEN) < fila de encabezado (Z_HEAD_ROW) <
 *    esquina de encabezado congelada (Z_HEAD_FROZEN), que debe pintar por encima
 *    de ambas.
 * 4. Encabezado de 2 filas (p.ej. Pdt601ListPage, con subtítulos ONP/AFP/... en una 2ª
 *    fila): las celdas `rowSpan={2}` de la 1ª fila (columnas congeladas + "Estado" +
 *    "Fecha de entrega"...) se extienden visualmente HACIA ABAJO, dentro del rango
 *    vertical de la 2ª fila. Como cada `<tr>` es su propio `position: sticky` (su
 *    propio contexto de apilamiento), el z-index MÁS ALTO de una celda `rowSpan` NO
 *    le gana a la 2ª fila si la `<tr>` de la 2ª fila tiene el MISMO z-index que la
 *    1ª — al ir después en el DOM, la 2ª fila pintaría encima de TODA la 1ª,
 *    incluidas sus celdas congeladas (bleed-through). Por eso la `<tr>` de la 1ª fila
 *    debe usar `Z_HEAD_ROW1` (mayor que `Z_HEAD_ROW`, que usa la 2ª fila).
 */
export const Z_BODY_FROZEN = 10;
export const Z_HEAD_ROW = 20;
export const Z_HEAD_ROW1 = 25;
export const Z_HEAD_FROZEN = 30;

/** Anchos fijos de las columnas de identificación, compartidos entre todas las tablas. */
export const FROZEN_ID_COL_W = { code: 84, dig: 60, name: 208, ruc: 124, assistant: 116 } as const;

/** Calcula el `left` acumulado de cada columna congelada a partir de sus anchos fijos. */
export function buildFrozenLefts<K extends string>(widths: Record<K, number>): Record<K, number> {
  const lefts = {} as Record<K, number>;
  let acc = 0;
  for (const key of Object.keys(widths) as K[]) {
    lefts[key] = acc;
    acc += widths[key];
  }
  return lefts;
}

export const FROZEN_ID_LEFT = buildFrozenLefts(FROZEN_ID_COL_W);

/** width/minWidth/maxWidth fijos (mismo valor en header y body para que coincidan). */
export function frozenColWidthStyle(width: number): CSSProperties {
  return { width, minWidth: width, maxWidth: width };
}

/** Celda congelada del CUERPO: fija a la izquierda, fondo opaco (ver nota arriba). */
export function frozenBodyCellStyle(left: number, width: number): CSSProperties {
  return { ...frozenColWidthStyle(width), position: 'sticky', left, zIndex: Z_BODY_FROZEN };
}

/** Celda congelada del ENCABEZADO: fija arriba (heredado de la fila) Y a la izquierda. */
export function frozenHeadCellStyle(left: number, width: number): CSSProperties {
  return { ...frozenColWidthStyle(width), position: 'sticky', left, zIndex: Z_HEAD_FROZEN };
}

/** Atajos para las 5 columnas de identificación (Código, Dígito, Razón social, RUC, Asistente). */
export function frozenIdBodyCellStyle(col: keyof typeof FROZEN_ID_COL_W): CSSProperties {
  return frozenBodyCellStyle(FROZEN_ID_LEFT[col], FROZEN_ID_COL_W[col]);
}
export function frozenIdHeadCellStyle(col: keyof typeof FROZEN_ID_COL_W): CSSProperties {
  return frozenHeadCellStyle(FROZEN_ID_LEFT[col], FROZEN_ID_COL_W[col]);
}
