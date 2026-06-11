/** Paleta pastel predefinida para filas de claves SOL por dígito. */
export const CLAVES_SOL_PASTEL_PALETTE = [
  { id: 'sky', label: 'Azul cielo', swatch: 'bg-sky-300', row: 'bg-sky-100/95 hover:bg-sky-200/85' },
  { id: 'emerald', label: 'Verde', swatch: 'bg-emerald-300', row: 'bg-emerald-100/95 hover:bg-emerald-200/85' },
  { id: 'amber', label: 'Ámbar', swatch: 'bg-amber-300', row: 'bg-amber-100/95 hover:bg-amber-200/85' },
  { id: 'violet', label: 'Violeta', swatch: 'bg-violet-300', row: 'bg-violet-100/95 hover:bg-violet-200/85' },
  { id: 'rose', label: 'Rosa', swatch: 'bg-rose-300', row: 'bg-rose-100/95 hover:bg-rose-200/85' },
  { id: 'teal', label: 'Turquesa', swatch: 'bg-teal-300', row: 'bg-teal-100/95 hover:bg-teal-200/85' },
  { id: 'indigo', label: 'Índigo', swatch: 'bg-indigo-300', row: 'bg-indigo-100/95 hover:bg-indigo-200/85' },
  { id: 'lime', label: 'Lima', swatch: 'bg-lime-300', row: 'bg-lime-100/95 hover:bg-lime-200/85' },
  { id: 'orange', label: 'Naranja', swatch: 'bg-orange-300', row: 'bg-orange-100/95 hover:bg-orange-200/85' },
  { id: 'cyan', label: 'Cian', swatch: 'bg-cyan-300', row: 'bg-cyan-100/95 hover:bg-cyan-200/85' },
  { id: 'fuchsia', label: 'Fucsia', swatch: 'bg-fuchsia-300', row: 'bg-fuchsia-100/95 hover:bg-fuchsia-200/85' },
  { id: 'slate', label: 'Gris', swatch: 'bg-slate-300', row: 'bg-slate-100/95 hover:bg-slate-200/85' },
] as const;

export type ClavesSolPaletteId = (typeof CLAVES_SOL_PASTEL_PALETTE)[number]['id'];

/** Dígitos de empresa en claves SOL (0–9), en orden de UI. */
export const CLAVES_SOL_DIGIT_KEYS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

export const DEFAULT_DIG_COLOR_MAP: Record<string, ClavesSolPaletteId> = {
  '0': 'cyan',
  '1': 'sky',
  '2': 'emerald',
  '3': 'amber',
  '4': 'violet',
  '5': 'rose',
  '6': 'teal',
  '7': 'indigo',
  '8': 'lime',
  '9': 'orange',
};

const paletteById = Object.fromEntries(CLAVES_SOL_PASTEL_PALETTE.map((p) => [p.id, p])) as Record<
  ClavesSolPaletteId,
  (typeof CLAVES_SOL_PASTEL_PALETTE)[number]
>;

export function parseDigColorMap(json?: string | null): Record<string, ClavesSolPaletteId> {
  const out: Record<string, ClavesSolPaletteId> = { ...DEFAULT_DIG_COLOR_MAP };
  const raw = (json ?? '').trim();
  if (!raw) return out;
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    for (const key of CLAVES_SOL_DIGIT_KEYS) {
      const id = (parsed[key] ?? '').trim() as ClavesSolPaletteId;
      if (id && paletteById[id]) out[key] = id;
    }
  } catch {
    /* usar defaults */
  }
  return out;
}

export function serializeDigColorMap(map: Record<string, ClavesSolPaletteId>): string {
  const payload: Record<string, string> = {};
  for (const key of CLAVES_SOL_DIGIT_KEYS) {
    payload[key] = map[key] ?? DEFAULT_DIG_COLOR_MAP[key];
  }
  return JSON.stringify(payload);
}

export function normalizeCompanyDig(dig?: string | null): string {
  const t = (dig ?? '').trim();
  if (!t) return '';
  const ch = t[0];
  if (ch >= '0' && ch <= '9') return ch;
  return '';
}

export function getDigRowClass(dig: string | undefined | null, colorMap: Record<string, ClavesSolPaletteId>): string {
  const d = normalizeCompanyDig(dig);
  if (!d) return 'bg-white hover:bg-slate-50/90';
  const paletteId = colorMap[d] ?? DEFAULT_DIG_COLOR_MAP[d] ?? 'slate';
  return paletteById[paletteId]?.row ?? 'bg-white hover:bg-slate-50/90';
}

export function getPaletteSwatch(paletteId: ClavesSolPaletteId): string {
  return paletteById[paletteId]?.swatch ?? 'bg-slate-300';
}
