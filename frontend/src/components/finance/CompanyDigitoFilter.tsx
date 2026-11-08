import {
  CLAVES_SOL_DIGIT_KEYS,
  DEFAULT_DIG_COLOR_MAP,
  getPaletteSwatch,
  parseDigColorMap,
  type ClavesSolPaletteId,
} from '../../utils/clavesSolDigColors';

type Props = {
  filterDig: string | null;
  onFilterDigChange: (dig: string | null) => void;
  /** JSON de colores desde configuración (opcional). */
  digColorsJson?: string | null;
  loading?: boolean;
  className?: string;
};

const CompanyDigitoFilter = ({
  filterDig,
  onFilterDigChange,
  digColorsJson,
  loading = false,
  className = '',
}: Props) => {
  const digColorMap = digColorsJson != null ? parseDigColorMap(digColorsJson) : DEFAULT_DIG_COLOR_MAP;

  return (
    <div className={`min-w-0 ${className}`}>
      {loading ? (
        <p className="text-xs text-slate-500 py-1">
          <i className="fas fa-spinner fa-spin mr-1" aria-hidden />
          Cargando dígitos…
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="text-2xs font-medium uppercase tracking-wide text-slate-500">Dígitos</p>
          <div className="flex gap-1">
            {CLAVES_SOL_DIGIT_KEYS.map((key) => {
              const active = filterDig === key;
              const swatch = getPaletteSwatch((digColorMap[key] ?? DEFAULT_DIG_COLOR_MAP[key] ?? 'slate') as ClavesSolPaletteId);
              return (
                <button
                  key={key}
                  type="button"
                  title={`Dígito ${key}`}
                  aria-pressed={active}
                  className={[
                    'flex h-7 w-8 items-center justify-center rounded border font-bold font-mono text-slate-800 text-xs',
                    swatch,
                    active
                      ? 'ring-2 ring-primary-500 ring-offset-1 border-primary-500'
                      : 'border-slate-300/70 hover:brightness-95',
                  ].join(' ')}
                  onClick={() => onFilterDigChange(active ? null : key)}
                >
                  {key}
                </button>
              );
            })}
          </div>
          {filterDig ? (
            <button
              type="button"
              onClick={() => onFilterDigChange(null)}
              className="text-2xs font-medium text-primary-700 hover:text-primary-900 hover:underline"
            >
              Limpiar
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
};

export default CompanyDigitoFilter;
