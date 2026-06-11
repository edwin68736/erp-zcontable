import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';

export type TableRowMoreMenuItem =
  | { type: 'link'; to: string; label: string; icon: string }
  | { type: 'button'; label: string; icon: string; onClick: () => void; danger?: boolean };

type Props = {
  items: TableRowMoreMenuItem[];
  buttonClassName?: string;
  label?: string;
};

const itemClass = (danger?: boolean) =>
  `w-full text-left px-4 py-2.5 text-sm flex items-center gap-2 ${
    danger ? 'text-red-600 hover:bg-red-50' : 'text-slate-700 hover:bg-slate-50'
  }`;

const TableRowMoreMenu = ({
  items,
  buttonClassName = 'inline-flex items-center justify-center w-8 h-8 rounded-full border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors',
  label = 'Más acciones',
}: Props) => {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  const close = () => setOpen(false);

  useEffect(() => {
    if (!open) return;
    const onOutside = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t)) return;
      const panel = document.getElementById(menuId);
      if (panel?.contains(t)) return;
      close();
    };
    const reposition = () => {
      if (!btnRef.current) return;
      const r = btnRef.current.getBoundingClientRect();
      setCoords({ top: r.bottom + 4, left: r.right });
    };
    reposition();
    document.addEventListener('mousedown', onOutside);
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      document.removeEventListener('mousedown', onOutside);
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open, menuId]);

  if (items.length === 0) return null;

  const toggle = () => {
    setOpen((prev) => {
      if (!prev && btnRef.current) {
        const r = btnRef.current.getBoundingClientRect();
        setCoords({ top: r.bottom + 4, left: r.right });
      }
      return !prev;
    });
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        className={buttonClassName}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <i className="fas fa-ellipsis-v text-xs" aria-hidden />
      </button>
      {open && coords
        ? createPortal(
            <div
              id={menuId}
              role="menu"
              className="fixed z-[10050] min-w-[9.5rem] rounded-xl border border-slate-200 bg-white shadow-lg py-1"
              style={{ top: coords.top, left: coords.left, transform: 'translateX(-100%)' }}
            >
              {items.map((item) =>
                item.type === 'link' ? (
                  <Link
                    key={`${item.type}-${item.to}`}
                    to={item.to}
                    role="menuitem"
                    onClick={close}
                    className={itemClass()}
                  >
                    <i className={`${item.icon} text-slate-400 w-4 text-center`} aria-hidden />
                    {item.label}
                  </Link>
                ) : (
                  <button
                    key={`${item.type}-${item.label}`}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      item.onClick();
                      close();
                    }}
                    className={itemClass(item.danger)}
                  >
                    <i
                      className={`${item.icon} w-4 text-center ${item.danger ? '' : 'text-slate-400'}`}
                      aria-hidden
                    />
                    {item.label}
                  </button>
                ),
              )}
            </div>,
            document.body,
          )
        : null}
    </>
  );
};

export default TableRowMoreMenu;
