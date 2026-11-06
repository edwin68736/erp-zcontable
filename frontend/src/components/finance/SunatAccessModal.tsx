import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  companyAccessCredentialsService,
  type CompanyAccessCredentialRow,
  type SunatAccessError,
} from '../../services/companyAccessCredentials';
import { openSunatAccessUrl, openSunatLoginPage, sunatAccessFallback, SUNAT_TARGETS, type SunatAccessTarget } from '../../utils/sunatSol';

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

/** Una fila del ingreso manual: valor con botón de copiar (y ojito si es la clave). */
function CredentialRow({ label, value, secret = false, mono = true }: { label: string; value: string; secret?: boolean; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  const [visible, setVisible] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* sin portapapeles: el campo es seleccionable */
    }
  };
  return (
    <div>
      <span className="mb-0.5 block text-2xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      <div className="flex items-center gap-2">
        <input
          readOnly
          type={secret && !visible ? 'password' : 'text'}
          value={value}
          aria-label={label}
          onFocus={(e) => e.currentTarget.select()}
          className={`min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-800 ${mono ? 'font-mono' : ''}`}
        />
        {secret ? (
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? 'Ocultar clave' : 'Mostrar clave'}
            title={visible ? 'Ocultar clave' : 'Mostrar clave'}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-100"
          >
            <i className={`fas ${visible ? 'fa-eye-slash' : 'fa-eye'}`} aria-hidden />
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => void copy()}
          aria-label={`Copiar ${label}`}
          title="Copiar"
          className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-100"
        >
          <i className={`fas ${copied ? 'fa-check text-green-600' : 'fa-copy'}`} aria-hidden />
        </button>
      </div>
    </div>
  );
}

/**
 * Ingreso manual cuando el acceso directo falla o se agotaron sus intentos: RUC, usuario y clave SOL de la empresa con
 * botones de copiar y un botón que abre la pantalla de login de SUNAT. Las claves solo las ve quien tiene permiso
 * de verlas (sin él llegan vacías del servidor).
 */
function ManualAccessPanel({ row, target, label, error }: { row: CompanyAccessCredentialRow; target: SunatAccessTarget; label: string; error: SunatAccessError }) {
  const hasCreds = Boolean(row.sol_usuario && row.sol_clave);
  const why =
    error.code === 'intentos_agotados' || error.attempts_left === 0
      ? 'Se agotaron los intentos automáticos para no bloquear la clave de la empresa.'
      : error.code === 'captcha' || error.code === 'autenticacion_bloqueada'
        ? 'SUNAT pidió verificación o bloqueó los intentos.'
        : 'SUNAT no aceptó el acceso automático.';
  return (
    <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
      <p className="text-sm font-semibold text-slate-800">Inicie sesión en {label} con la clave de la empresa</p>
      <p className="mt-0.5 text-xs text-slate-600">{why} Copie los datos, abra el login de SUNAT y péguelos allí.</p>
      {hasCreds ? (
        <div className="mt-3 space-y-2">
          <CredentialRow label="RUC" value={row.ruc} />
          <CredentialRow label="Usuario SOL" value={row.sol_usuario} />
          <CredentialRow label="Clave SOL" value={row.sol_clave} secret />
          <button
            type="button"
            onClick={() => openSunatLoginPage(target)}
            className="mt-1 w-full rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
          >
            <i className="fas fa-arrow-up-right-from-square mr-2" aria-hidden />
            Iniciar sesión en {label}
          </button>
          <p className="text-2xs text-slate-500">En el login de SUNAT elija «RUC», pegue el RUC, el usuario y la clave, y pulse Iniciar sesión.</p>
        </div>
      ) : (
        <p className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
          Su rol no puede ver el usuario y la clave SOL de esta empresa. Pida a un supervisor que inicie sesión o le comparta los datos.
        </p>
      )}
    </div>
  );
}

/**
 * Ventana de "Acceso a SUNAT / Pagos / SUNAFIL": el servidor inicia sesión por detrás con las credenciales de la empresa
 * (unos segundos) y entrega un enlace de un solo uso; cuando está listo se habilita "Ir a SUNAT", que lo
 * abre en una pestaña nueva y entra directo al panel. Si falla, el servidor permite un par de reintentos (uno menos que
 * el límite de SUNAT para no bloquear la clave) y después la ventana muestra las claves SOL con botones de copiar y el
 * acceso al login de SUNAT para entrar a mano.
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
  const fallback = phase.kind === 'error' ? sunatAccessFallback(phase.error) : 'none';

  return createPortal(
    <div className="fixed inset-0 z-dialog flex items-center justify-center p-4">
      <button type="button" aria-label="Cerrar" onClick={onClose} className="absolute inset-0 bg-slate-900/50 backdrop-blur-[1px]" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="sunat-access-title"
        className="relative max-h-[95vh] w-full max-w-md overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-xl"
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

        {phase.kind === 'error' && fallback === 'manual' ? <ManualAccessPanel row={row} target={target} label={label} error={phase.error} /> : null}

        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          {phase.kind === 'error' && fallback === 'retry' ? (
            <button
              type="button"
              onClick={() => setAttempt((n) => n + 1)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Reintentar
              {typeof phase.error.attempts_left === 'number' ? ` (${phase.error.attempts_left} ${phase.error.attempts_left === 1 ? 'intento' : 'intentos'} más)` : ''}
            </button>
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
