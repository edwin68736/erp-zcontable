import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatMonthName, shiftPeriodYm } from './calendarUtils';

type Props = {
  periodYm: string;
  canManage: boolean;
  canEdit: boolean;
  isClosed: boolean;
  hasCalendar: boolean;
  pdfLoading?: boolean;
  onPeriodChange: (ym: string) => void;
  onNewCalendar: () => void;
  onDuplicate: () => void;
  onEditNotes: () => void;
  onDelete: () => void;
  onExportPdf: () => void;
  onCloseCalendar: () => void;
  onReopenCalendar: () => void;
  onAddActivity?: () => void;
};

const CalendarHeader = ({
  periodYm,
  canManage,
  canEdit,
  isClosed,
  hasCalendar,
  pdfLoading,
  onPeriodChange,
  onNewCalendar,
  onDuplicate,
  onEditNotes,
  onDelete,
  onExportPdf,
  onCloseCalendar,
  onReopenCalendar,
  onAddActivity,
}: Props) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuWrapRef = useRef<HTMLDivElement>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!menuOpen || !menuBtnRef.current) {
      setMenuPos(null);
      return;
    }
    const update = () => {
      const r = menuBtnRef.current?.getBoundingClientRect();
      if (!r) return;
      const w = 208;
      setMenuPos({
        top: r.bottom + 4,
        left: Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8)),
      });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuWrapRef.current?.contains(t)) return;
      const portal = document.getElementById('finance-calendar-header-menu');
      if (portal?.contains(t)) return;
      setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  const menuDropdown =
    menuOpen && hasCalendar && menuPos
      ? createPortal(
          <div
            id="finance-calendar-header-menu"
            role="menu"
            className="fixed w-52 rounded-xl border border-slate-200 bg-white shadow-xl py-1 z-[10050]"
            style={{ top: menuPos.top, left: menuPos.left }}
          >
            {canEdit ? (
              <>
                <button
                  type="button"
                  role="menuitem"
                  className="w-full text-left px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                  onClick={() => {
                    setMenuOpen(false);
                    onDuplicate();
                  }}
                >
                  <i className="fas fa-copy text-slate-400 w-4" aria-hidden /> Duplicar mes
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="w-full text-left px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                  onClick={() => {
                    setMenuOpen(false);
                    onEditNotes();
                  }}
                >
                  <i className="fas fa-pen text-slate-400 w-4" aria-hidden /> Editar notas
                </button>
                <hr className="my-1 border-slate-100" />
                <button
                  type="button"
                  role="menuitem"
                  className="w-full text-left px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                  onClick={() => {
                    setMenuOpen(false);
                    onDelete();
                  }}
                >
                  <i className="fas fa-trash-alt w-4" aria-hidden /> Eliminar calendario
                </button>
              </>
            ) : (
              <p className="px-4 py-2 text-xs text-slate-500">Calendario cerrado. Ábralo para editar.</p>
            )}
          </div>,
          document.body,
        )
      : null;

  return (
    <header className="relative z-30 rounded-xl border border-slate-200 bg-white shadow-sm overflow-visible">
      <div className="px-4 py-2.5 sm:px-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="text-sm font-semibold text-slate-800 shrink-0">Calendario de actividades</h2>
          {hasCalendar && isClosed ? (
            <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-slate-200 text-slate-700">
              Cerrado
            </span>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center rounded-lg border border-slate-200 bg-slate-50/80 p-0.5">
            <button
              type="button"
              onClick={() => onPeriodChange(shiftPeriodYm(periodYm, -1))}
              className="p-1.5 rounded-md text-slate-600 hover:bg-white hover:text-primary-700 transition-colors"
              aria-label="Mes anterior"
            >
              <i className="fas fa-chevron-left text-xs" aria-hidden />
            </button>
            <span className="px-2.5 text-sm font-medium text-slate-800 min-w-[72px] text-center">
              {formatMonthName(periodYm)}
            </span>
            <button
              type="button"
              onClick={() => onPeriodChange(shiftPeriodYm(periodYm, 1))}
              className="p-1.5 rounded-md text-slate-600 hover:bg-white hover:text-primary-700 transition-colors"
              aria-label="Mes siguiente"
            >
              <i className="fas fa-chevron-right text-xs" aria-hidden />
            </button>
          </div>

          {hasCalendar ? (
            <button
              type="button"
              disabled={pdfLoading}
              onClick={onExportPdf}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-slate-200 text-slate-700 text-xs font-medium hover:bg-slate-50 disabled:opacity-50"
            >
              {pdfLoading ? (
                <i className="fas fa-spinner fa-spin text-[10px]" aria-hidden />
              ) : (
                <i className="fas fa-file-pdf text-[10px] text-red-600" aria-hidden />
              )}
              PDF
            </button>
          ) : null}

          {hasCalendar && canEdit && onAddActivity ? (
            <button
              type="button"
              onClick={onAddActivity}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-600 text-white text-xs font-medium shadow-sm hover:bg-emerald-700 transition-colors"
              title="Crear actividad (también puede hacer doble clic en un día)"
            >
              <i className="fas fa-plus text-[10px]" aria-hidden />
              Nueva actividad
            </button>
          ) : null}

          {canManage ? (
            <>
              {canEdit ? (
                <button
                  type="button"
                  onClick={onNewCalendar}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary-600 text-white text-xs font-medium shadow-sm hover:bg-primary-700 transition-colors"
                >
                  <i className="fas fa-plus text-[10px]" aria-hidden />
                  Nuevo calendario
                </button>
              ) : null}

              {hasCalendar && canEdit ? (
                <button
                  type="button"
                  onClick={onCloseCalendar}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-amber-300 bg-amber-50 text-amber-900 text-xs font-medium hover:bg-amber-100"
                >
                  <i className="fas fa-lock text-[10px]" aria-hidden />
                  Cerrar calendario
                </button>
              ) : null}

              {hasCalendar && isClosed ? (
                <button
                  type="button"
                  onClick={onReopenCalendar}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-primary-300 bg-primary-50 text-primary-800 text-xs font-medium hover:bg-primary-100"
                >
                  <i className="fas fa-lock-open text-[10px]" aria-hidden />
                  Abrir calendario
                </button>
              ) : null}

              <div className="relative" ref={menuWrapRef}>
                <button
                  ref={menuBtnRef}
                  type="button"
                  onClick={() => setMenuOpen((o) => !o)}
                  disabled={!hasCalendar}
                  className="inline-flex items-center justify-center w-8 h-8 rounded-full border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition-colors"
                  aria-label="Más acciones"
                  aria-expanded={menuOpen}
                  aria-haspopup="menu"
                >
                  <i className="fas fa-ellipsis-v text-sm" aria-hidden />
                </button>
                {menuDropdown}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </header>
  );
};

export default CalendarHeader;
