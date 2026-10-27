import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  companyAccessCredentialsService,
  type CompanyAccessCredentialRow,
  type SunatAccessError,
} from '../../services/companyAccessCredentials';
import { openSunatAccessUrl, openSunatSolLogin, SUNAT_TARGETS, type SunatAccessTarget } from '../../utils/sunatSol';

type Props = {
  row: CompanyAccessCredentialRow;
  /** Destino del acceso; por defecto SUNAT (Menú SOL). */
  target?: SunatAccessTarget;
  onClose: () => void;
};

type Phase =
  | { kind: 'loading' }
  | { kind: 'ready'; url: string }
  | { kind: 'error'; error: SunatAccessError };

/** Errores tras los cuales reintentar enseguida no sirve (o empeora: puede bloquear la clave). */
const NO_RETRY_CODES = new Set(['faltan_datos', 'credenciales_rechazadas', 'credenciales_en_pausa', 'captcha', 'sin_acceso']);

/**
 * Ventana de "Acceso a SUNAT / Pagos / SUNAFIL": el servidor inicia sesión por detrás con las credenciales de la empresa
 * (unos segundos) y entrega un enlace de un solo uso; cuando está listo se habilita "Ir a SUNAT", que lo
 * abre en una pestaña nueva y entra directo al panel. Si el servidor no puede (SUNAT cambió algo, pide
 * captcha…), ofrece el ingreso con formulario como alternativa.
 */
const SunatAccessModal = ({ row, target = 'sunat', onClose }: Props) => {
  const label = SUNAT_TARGETS[target].label;
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [copied, setCopied] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const goRef = useRef<HTMLButtonElement | null>(null);

  // Una sola petición por apertura/reintento: cada una hace un login real en SUNAT, y repetirla (p. ej.
  // por el doble efecto de React.StrictMode en desarrollo) gastaría intentos de la clave.
  const alive = useRef(true);
  const requestKey = useRef('');
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    const key = `${row.company_id}:${target}:${attempt}`;
    if (requestKey.current === key) return;
    requestKey.current = key;
    setPhase({ kind: 'loading' });
    setCopied(false);
    setShowDetail(false);
    companyAccessCredentialsService
      .sunatAccess(row.company_id, target)
      .then((r) => {
        if (alive.current && requestKey.current === key) setPhase({ kind: 'ready', url: r.url });
      })
      .catch((e: SunatAccessError) => {
        if (alive.current && requestKey.current === key) setPhase({ kind: 'error', error: e });
      });
  }, [row.company_id, target, attempt]);

  useEffect(() => {
    if (phase.kind === 'ready') goRef.current?.focus();
  }, [phase.kind]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const goToSunat = () => {
    if (phase.kind !== 'ready') return;
    // Cierra primero la sesión anterior de SUNAT en este navegador y luego entra (ver utils/sunatSol.ts).
    openSunatAccessUrl(phase.url, target);
    onClose();
  };

  const copyLink = async () => {
    if (phase.kind !== 'ready') return;
    try {
      await navigator.clipboard.writeText(phase.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* sin portapapeles: el campo es seleccionable */
    }
  };

  const title = row.business_name || 'la empresa';

  return createPortal(
    <div className="fixed inset-0 z-dialog flex items-center justify-center p-4">
      <button type="button" aria-label="Cerrar" onClick={onClose} className="absolute inset-0 bg-slate-900/50 backdrop-blur-[1px]" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="sunat-access-title"
        className="relative w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl"
      >
        <div className="flex items-start gap-3">
          <span
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
              phase.kind === 'ready' ? 'bg-green-100 text-green-600' : phase.kind === 'error' ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-700'
            }`}
            aria-hidden
          >
            <i className={`fas ${phase.kind === 'ready' ? 'fa-check' : phase.kind === 'error' ? 'fa-exclamation' : 'fa-spinner fa-spin'}`} />
          </span>
          <div className="min-w-0">
            <h2 id="sunat-access-title" className="text-base font-bold text-slate-900">
              {phase.kind === 'ready' ? '¡Acceso generado!' : phase.kind === 'error' ? 'No se pudo generar el acceso' : `Generando acceso a ${label}…`}
            </h2>
            <p className="mt-0.5 truncate text-sm text-slate-600" title={title}>
              {phase.kind === 'loading' ? 'Iniciando sesión por usted en' : `Portal ${label} de`} <strong>{title}</strong>
              {row.ruc ? <span className="text-slate-500"> · {row.ruc}</span> : null}
            </p>
          </div>
        </div>

        {phase.kind === 'loading' ? (
          <p className="mt-4 text-xs text-slate-500" role="status">
            Esto toma unos segundos. No cierre esta ventana.
          </p>
        ) : null}

        {phase.kind === 'ready' ? (
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-center justify-between">
              <span className="text-2xs font-semibold uppercase tracking-wide text-slate-500">Enlace de acceso directo</span>
              <span className="rounded-md bg-red-50 px-2 py-0.5 text-2xs font-semibold text-red-600">Vence en pocos minutos</span>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <input
                readOnly
                value={phase.url}
                aria-label={`Enlace de acceso directo a ${label}`}
                onFocus={(e) => e.currentTarget.select()}
                className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-600"
              />
              <button
                type="button"
                onClick={() => void copyLink()}
                aria-label="Copiar enlace"
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-100"
              >
                <i className={`fas ${copied ? 'fa-check text-green-600' : 'fa-copy'}`} aria-hidden />
              </button>
            </div>
            <p className="mt-2 text-2xs text-slate-500">
              <i className="fas fa-circle-info mr-1" aria-hidden />
              Funciona una sola vez. Úselo ahora y no lo comparta: da acceso completo a {label} de esta empresa.
            </p>
          </div>
        ) : null}

        {phase.kind === 'error' ? (
          <div className="mt-4 space-y-2">
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{phase.error.message}</p>
            {phase.error.detail ? (
              <div>
                <button type="button" onClick={() => setShowDetail((v) => !v)} className="text-2xs font-medium text-slate-500 underline">
                  {showDetail ? 'Ocultar detalle técnico' : 'Ver detalle técnico'}
                </button>
                {showDetail ? (
                  <p className="mt-1 break-words rounded-md bg-slate-50 px-2 py-1.5 font-mono text-2xs text-slate-600">
                    {phase.error.code ? `[${phase.error.code}] ` : ''}
                    {phase.error.detail}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          {phase.kind === 'error' ? (
            <>
              {/* Plan B en el navegador: necesita usuario y clave SOL, que no llegan a quien no tiene
                  permiso de verlos — para esos usuarios no se ofrece. */}
              {phase.error.code !== 'faltan_datos' && phase.error.code !== 'sin_acceso' && row.sol_usuario && row.sol_clave ? (
                <button
                  type="button"
                  onClick={() => {
                    openSunatSolLogin({ ruc: row.ruc, usuario: row.sol_usuario, clave: row.sol_clave }, target);
                    onClose();
                  }}
                  title="Abre SUNAT enviando el formulario de login desde su navegador (puede pedirle elegir 'Continuar sin código')"
                  className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Ingresar con formulario
                </button>
              ) : null}
              {!NO_RETRY_CODES.has(phase.error.code ?? '') ? (
                <button
                  type="button"
                  onClick={() => setAttempt((n) => n + 1)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Reintentar
                </button>
              ) : null}
            </>
          ) : null}
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100">
            Cerrar
          </button>
          {phase.kind !== 'error' ? (
            <button
              ref={goRef}
              type="button"
              onClick={goToSunat}
              disabled={phase.kind !== 'ready'}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              Ir a {label}
            </button>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default SunatAccessModal;
