import { useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation } from 'react-router-dom';
import CompanyAccessCredentials from '../pages/finance/CompanyAccessCredentials';
import { P } from '../rbac/codes';
import { auth } from '../services/auth';

const CLAVES_SOL_PATH = '/finance/claves-sol';

/**
 * Botón flotante de «Claves SOL», junto a los avisos de notificaciones y de la agenda: abre un modal grande con la MISMA pantalla
 * de Claves SOL (lista, filtros y acceso directo a SUNAT), para entrar a SUNAT desde cualquier vista sin salir de ella. Lo ve quien
 * tiene permiso de ver claves; en la propia pantalla de Claves SOL no aparece (ya está ahí).
 */
const SolKeysFloating = ({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) => {
  const canView = useMemo(() => auth.hasPermission(P.companyCredentialsView), []);
  const { pathname } = useLocation();
  const onOwnPage = pathname.startsWith(CLAVES_SOL_PATH);

  // Al cambiar de pantalla (o llegar a la propia de Claves SOL) el modal se cierra.
  useEffect(() => {
    if (open) onOpenChange(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo debe reaccionar al cambio de ruta
  }, [pathname]);

  // Esc cierra el modal, salvo que haya encima otra ventana de la lista (editar, acceso a SUNAT…): esa se cierra primero.
  useEffect(() => {
    if (!open) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      if (document.querySelectorAll('.fixed.z-dialog').length > 1) return;
      onOpenChange(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  if (!canView || onOwnPage) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => onOpenChange(true)}
        className="pointer-events-auto relative flex h-11 w-11 items-center justify-center rounded-full border border-white/70 bg-gradient-to-br from-sky-600 to-blue-800 text-white shadow-[0_6px_18px_-4px_rgba(30,64,175,0.55)] transition hover:scale-105 active:scale-95"
        aria-label="Abrir Claves SOL"
        title="Claves SOL: entrar a SUNAT desde cualquier vista"
      >
        <i className="fas fa-key text-sm" aria-hidden />
      </button>

      {open
        ? createPortal(
            <div
              className="fixed inset-0 z-dialog flex items-center justify-center bg-slate-900/50 p-2 sm:p-4"
              onMouseDown={(e) => {
                if (e.target === e.currentTarget) onOpenChange(false);
              }}
            >
              <div role="dialog" aria-modal="true" aria-labelledby="sol-keys-title" className="notify-pop flex h-[94dvh] w-full max-w-[1700px] flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
                <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-5">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-sky-600 to-blue-800 text-white">
                      <i className="fas fa-key text-sm" aria-hidden />
                    </div>
                    <div className="min-w-0">
                      <h2 id="sol-keys-title" className="m-0 truncate text-base font-bold text-slate-900">
                        Claves SOL
                      </h2>
                      <p className="m-0 truncate text-xs text-slate-500">La misma lista de la pantalla de Claves SOL: entre a SUNAT con un clic sin salir de lo que está haciendo.</p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Link
                      to={CLAVES_SOL_PATH}
                      className="hidden rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 sm:inline-flex sm:items-center"
                      title="Abrir la pantalla de Claves SOL completa"
                    >
                      <i className="fas fa-up-right-from-square mr-1.5 text-[10px]" aria-hidden />
                      Abrir en pantalla completa
                    </Link>
                    <button
                      type="button"
                      onClick={() => onOpenChange(false)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                      aria-label="Cerrar Claves SOL"
                    >
                      <i className="fas fa-times" aria-hidden />
                    </button>
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/50 p-3 sm:p-4">
                  <CompanyAccessCredentials />
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
};

export default SolKeysFloating;
