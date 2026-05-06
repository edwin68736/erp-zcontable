import { useEffect, useMemo, useRef, useState } from 'react';

export type SearchableSelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
  searchText?: string;
};

type Props = {
  id?: string;
  name?: string;
  required?: boolean;
  value: string;
  onChange: (nextValue: string) => void;
  options: SearchableSelectOption[];
  placeholder?: string;
  disabled?: boolean;
  searchPlaceholder?: string;
  noResultsText?: string;
  maxVisibleOptions?: number;
  className?: string;
};

function normalizeForSearch(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

const SearchableSelect = ({
  id,
  name,
  required,
  value,
  onChange,
  options,
  placeholder = 'Selecciona…',
  disabled,
  searchPlaceholder = 'Buscar…',
  noResultsText = 'No se encontraron resultados',
  maxVisibleOptions = 60,
  className = '',
}: Props) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selected = useMemo(() => options.find((o) => o.value === value) ?? null, [options, value]);

  const filtered = useMemo(() => {
    const q = normalizeForSearch(query);
    if (!q) return options;
    return options.filter((o) => {
      const haystack = normalizeForSearch([o.label, o.searchText, o.value].filter(Boolean).join(' '));
      return haystack.includes(q);
    });
  }, [options, query]);

  const visible = useMemo(() => filtered.slice(0, Math.max(0, maxVisibleOptions)), [filtered, maxVisibleOptions]);
  const hasMore = filtered.length > visible.length;

  useEffect(() => {
    if (!open) return;
    setQuery('');
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    const handleMouseDown = (ev: MouseEvent) => {
      if (!open) return;
      const target = ev.target as Node | null;
      if (!target) return;
      if (rootRef.current && !rootRef.current.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [open]);

  useEffect(() => {
    const handleKeyDown = (ev: KeyboardEvent) => {
      if (!open) return;
      if (ev.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  const handleToggle = () => {
    if (disabled) return;
    setOpen((prev) => !prev);
  };

  const handlePick = (nextValue: string) => {
    onChange(nextValue);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      {name ? <input type="hidden" name={name} value={value} required={required} /> : null}
      <button
        id={id}
        type="button"
        onClick={handleToggle}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="w-full px-3 py-2.5 rounded-lg border border-slate-300 bg-white text-sm text-left focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none disabled:opacity-60 flex items-center justify-between gap-3"
      >
        <span className={`min-w-0 truncate ${selected ? 'text-slate-800' : 'text-slate-400'}`}>
          {selected ? selected.label : placeholder}
        </span>
        <span className="flex items-center gap-2 text-slate-400 flex-shrink-0">
          <i className={`fas fa-chevron-${open ? 'up' : 'down'} text-xs`} />
        </span>
      </button>

      {open ? (
        <div className="absolute left-0 right-0 mt-2 bg-white rounded-xl shadow-lg border border-slate-200 z-40 overflow-hidden">
          <div className="p-2 border-b border-slate-100">
            <div className="relative">
              <span className="absolute inset-y-0 left-3 flex items-center text-slate-400">
                <i className="fas fa-search text-xs" />
              </span>
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchPlaceholder}
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
              />
            </div>
            {hasMore ? (
              <div className="mt-2 text-[11px] text-slate-500 px-1">
                Mostrando {visible.length} de {filtered.length}. Escribe para filtrar.
              </div>
            ) : null}
          </div>

          <div role="listbox" className="max-h-64 overflow-y-auto py-1">
            {visible.length === 0 ? (
              <div className="px-4 py-3 text-xs text-slate-500 text-center">{noResultsText}</div>
            ) : (
              visible.map((o) => {
                const isSelected = o.value === value;
                return (
                  <button
                    key={o.value || `__empty_${o.label}`}
                    type="button"
                    disabled={o.disabled}
                    onClick={() => handlePick(o.value)}
                    className={`w-full px-4 py-2 text-sm text-left flex items-center justify-between gap-3 ${
                      o.disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-slate-50'
                    } ${isSelected ? 'bg-slate-50' : ''}`}
                  >
                    <span className="min-w-0 truncate text-slate-700">{o.label}</span>
                    <span className="text-primary-600 flex-shrink-0">{isSelected ? <i className="fas fa-check text-xs" /> : null}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default SearchableSelect;
