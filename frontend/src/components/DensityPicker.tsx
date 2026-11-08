import { DENSITY_OPTIONS, type DensityPref } from '../utils/density';

/** Selector de densidad de las listas (Ajustes): automática, cómoda o compacta. */
const DensityPicker = ({ value, onChange }: { value: DensityPref; onChange: (next: DensityPref) => void }) => (
  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 sm:p-4">
    <div className="text-sm font-semibold text-slate-800">Densidad de las listas</div>
    <div className="mb-2 text-xs text-slate-500">Cuántas filas caben en pantalla. En «Automática» las pantallas pequeñas usan la compacta.</div>
    <div role="radiogroup" aria-label="Densidad de las listas" className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      {DENSITY_OPTIONS.map((o) => {
        const selected = value === o.id;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(o.id)}
            className={`rounded-lg border px-3 py-2 text-left transition ${selected ? 'border-primary-500 bg-white ring-2 ring-primary-200' : 'border-slate-200 bg-white hover:border-slate-300'}`}
          >
            <div className="text-sm font-semibold text-slate-800">{o.label}</div>
            <div className="text-2xs text-slate-500">{o.help}</div>
          </button>
        );
      })}
    </div>
  </div>
);

export default DensityPicker;
