import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { companiesService } from '../services/companies';
import type { Company } from '../types/dashboard';

function useDebouncedValue<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

function formatCompanyLine(c: Pick<Company, 'ruc' | 'business_name'>): string {
  return `${c.ruc} · ${c.business_name}`;
}

type Props = {
  value: string;
  onChange: (companyId: string) => void;
  className?: string;
  id?: string;
};

export default function CompanySearchInput({ value, onChange, className = '', id }: Props) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Company[]>([]);
  const [highlight, setHighlight] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputFocusedRef = useRef(false);
  const skipNextSearchRef = useRef(false);

  const debouncedQ = useDebouncedValue(text.trim(), 350);

  useEffect(() => {
    if (!value) {
      if (!inputFocusedRef.current) {
        setText('');
      }
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const c = await companiesService.get(Number(value));
        if (!cancelled) {
          skipNextSearchRef.current = true;
          setText(formatCompanyLine(c));
        }
      } catch {
        if (!cancelled) {
          setText('');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [value]);

  useEffect(() => {
    const q = debouncedQ;
    if (q.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    if (skipNextSearchRef.current) {
      skipNextSearchRef.current = false;
      setResults([]);
      setLoading(false);
      return;
    }
    if (value) {
      setResults([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    companiesService
      .listPaged({ q, page: 1, per_page: 30 })
      .then(({ items }) => {
        if (!cancelled) setResults(items);
      })
      .catch(() => {
        if (!cancelled) setResults([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQ, value]);

  useEffect(() => {
    const onDocMouseDown = (ev: MouseEvent) => {
      const el = ev.target as Node;
      if (rootRef.current && !rootRef.current.contains(el)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, []);

  const handleInputChange = (v: string) => {
    setText(v);
    setHighlight(-1);
    setOpen(true);
    if (value) onChange('');
  };

  const pick = (c: Company) => {
    onChange(String(c.id));
    setText(formatCompanyLine(c));
    setOpen(false);
    setResults([]);
    setHighlight(-1);
  };

  const clearAll = () => {
    onChange('');
    setText('');
    setResults([]);
    setOpen(false);
    setHighlight(-1);
    inputRef.current?.focus();
  };

  const showDropdown = open && debouncedQ.length >= 2 && !value;

  const onKeyDown = (ev: KeyboardEvent<HTMLInputElement>) => {
    if (!showDropdown && ev.key !== 'Escape') return;
    if (ev.key === 'Escape') {
      setOpen(false);
      setHighlight(-1);
      return;
    }
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      setHighlight((h) => Math.min(results.length - 1, h + 1));
      return;
    }
    if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      setHighlight((h) => Math.max(-1, h - 1));
      return;
    }
    if (ev.key === 'Enter' && highlight >= 0 && results[highlight]) {
      ev.preventDefault();
      pick(results[highlight]);
    }
  };

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <div className="flex gap-1 items-stretch">
        <input
          ref={inputRef}
          id={id}
          type="text"
          value={text}
          onChange={(e) => handleInputChange(e.target.value)}
          onFocus={() => {
            inputFocusedRef.current = true;
            setOpen(true);
          }}
          onBlur={() => {
            window.setTimeout(() => {
              inputFocusedRef.current = false;
            }, 0);
          }}
          onKeyDown={onKeyDown}
          placeholder="Buscar por RUC o razón social…"
          className="w-full min-h-[44px] px-3 py-2.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={open}
        />
        {value || text.trim() ? (
          <button
            type="button"
            onClick={clearAll}
            className="shrink-0 px-3 rounded-lg border border-slate-300 text-slate-600 text-sm hover:bg-slate-50"
            title="Quitar empresa (todas)"
          >
            Todas
          </button>
        ) : null}
      </div>
      {showDropdown ? (
        <ul
          className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg"
          role="listbox"
        >
          {loading ? (
            <li className="px-3 py-2 text-slate-500">Buscando…</li>
          ) : results.length === 0 ? (
            <li className="px-3 py-2 text-slate-500">Sin coincidencias</li>
          ) : (
            results.map((c, i) => (
              <li key={c.id} role="option" aria-selected={highlight === i}>
                <button
                  type="button"
                  className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-slate-50 ${
                    highlight === i ? 'bg-primary-50' : ''
                  }`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(c)}
                >
                  <span className="font-medium text-slate-800">{c.business_name}</span>
                  <span className="font-mono text-xs text-slate-500">RUC {c.ruc}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
