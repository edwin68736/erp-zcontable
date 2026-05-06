import { useMemo } from 'react';

export type PaginationMeta = {
  page: number;
  perPage: number;
  total: number;
};

type Props = {
  page: number;
  perPage: number;
  total: number;
  onPageChange: (nextPage: number) => void;
  onPerPageChange: (nextPerPage: number) => void;
  perPageOptions?: number[];
  className?: string;
};

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

const Pagination = ({
  page,
  perPage,
  total,
  onPageChange,
  onPerPageChange,
  perPageOptions = [10, 20, 50, 100],
  className = '',
}: Props) => {
  const safePerPage = clampInt(perPage, 1, 200);
  const safeTotal = Math.max(0, Math.trunc(total));

  const totalPages = useMemo(() => {
    if (safeTotal <= 0) return 1;
    return Math.max(1, Math.ceil(safeTotal / safePerPage));
  }, [safePerPage, safeTotal]);

  const safePage = clampInt(page, 1, totalPages);
  const from = safeTotal <= 0 ? 0 : (safePage - 1) * safePerPage + 1;
  const to = safeTotal <= 0 ? 0 : Math.min(safePage * safePerPage, safeTotal);

  const pages = useMemo(() => {
    const windowSize = 5;
    const half = Math.floor(windowSize / 2);
    let start = Math.max(1, safePage - half);
    let end = Math.min(totalPages, start + windowSize - 1);
    start = Math.max(1, end - windowSize + 1);
    const result: number[] = [];
    for (let p = start; p <= end; p++) result.push(p);
    return result;
  }, [safePage, totalPages]);

  const handlePrev = () => onPageChange(Math.max(1, safePage - 1));
  const handleNext = () => onPageChange(Math.min(totalPages, safePage + 1));
  const handleFirst = () => onPageChange(1);
  const handleLast = () => onPageChange(totalPages);

  return (
    <div className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 ${className}`}>
      <div className="text-xs text-slate-500">
        Mostrando <span className="font-semibold text-slate-700">{from}</span>–<span className="font-semibold text-slate-700">{to}</span>{' '}
        de <span className="font-semibold text-slate-700">{safeTotal}</span>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
        <div className="flex items-center justify-between sm:justify-start gap-2">
          <span className="text-xs text-slate-500">Por página</span>
          <select
            value={String(safePerPage)}
            onChange={(ev) => onPerPageChange(Number(ev.target.value))}
            className="px-3 py-2 rounded-full border border-slate-300 bg-white text-xs font-medium text-slate-700 focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
          >
            {perPageOptions.map((v) => (
              <option key={v} value={String(v)}>
                {v}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center justify-between sm:justify-end gap-1">
          <button
            type="button"
            onClick={handleFirst}
            disabled={safePage <= 1}
            className="hidden sm:inline-flex items-center px-3 py-2 rounded-full border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60"
          >
            <i className="fas fa-angles-left mr-1"></i> Primero
          </button>
          <button
            type="button"
            onClick={handlePrev}
            disabled={safePage <= 1}
            className="inline-flex items-center px-2.5 sm:px-3 py-2 rounded-full border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60"
          >
            <i className="fas fa-angle-left sm:mr-1"></i>
            <span className="hidden sm:inline">Anterior</span>
          </button>

          <div className="sm:hidden text-xs font-semibold text-slate-700 px-2">
            {safePage} / {totalPages}
          </div>

          <div className="hidden sm:flex items-center gap-1 mx-1">
            {pages.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => onPageChange(p)}
                className={`inline-flex items-center justify-center w-9 h-9 rounded-full border text-xs font-semibold ${
                  p === safePage
                    ? 'bg-primary-600 border-primary-600 text-white'
                    : 'border-slate-300 text-slate-700 hover:bg-slate-100'
                }`}
              >
                {p}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={handleNext}
            disabled={safePage >= totalPages}
            className="inline-flex items-center px-2.5 sm:px-3 py-2 rounded-full border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60"
          >
            <span className="hidden sm:inline">Siguiente</span>
            <i className="fas fa-angle-right sm:ml-1"></i>
          </button>
          <button
            type="button"
            onClick={handleLast}
            disabled={safePage >= totalPages}
            className="hidden sm:inline-flex items-center px-3 py-2 rounded-full border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60"
          >
            Último <i className="fas fa-angles-right ml-1"></i>
          </button>
        </div>
      </div>
    </div>
  );
};

export default Pagination;
