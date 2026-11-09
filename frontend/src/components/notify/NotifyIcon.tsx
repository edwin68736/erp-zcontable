import type { NotifyKind } from '../../utils/notify';

const TONE: Record<Exclude<NotifyKind, 'loading'>, { ring: string; mark: string }> = {
  success: { ring: 'text-emerald-200', mark: 'text-emerald-600' },
  error: { ring: 'text-red-200', mark: 'text-red-600' },
  warning: { ring: 'text-amber-200', mark: 'text-amber-600' },
  info: { ring: 'text-sky-200', mark: 'text-sky-600' },
  question: { ring: 'text-emerald-200', mark: 'text-emerald-600' },
};

/**
 * Icono circular de las alertas centradas (check, cruz, signo de admiración, «i», interrogación o rueda de carga).
 * El trazo se dibuja con una animación corta; con «reducir movimiento» queda dibujado de una vez.
 */
const NotifyIcon = ({ kind, danger = false }: { kind: NotifyKind; danger?: boolean }) => {
  if (kind === 'loading') {
    return <div className="mx-auto mb-4 mt-1 h-10 w-10 animate-spin rounded-full border-4 border-emerald-100 border-t-emerald-600" role="presentation" />;
  }
  const tone = kind === 'question' && danger ? { ring: 'text-red-200', mark: 'text-red-600' } : TONE[kind];
  const mark = `${tone.mark} notify-draw`;
  return (
    <svg className="mx-auto mb-4 h-[76px] w-[76px]" viewBox="0 0 80 80" fill="none" aria-hidden>
      <circle cx="40" cy="40" r="35" stroke="currentColor" strokeWidth="4" className={tone.ring} />
      {kind === 'success' ? <polyline points="24,41 35,52 57,29" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" className={mark} /> : null}
      {kind === 'error' ? (
        <>
          <line x1="28" y1="28" x2="52" y2="52" stroke="currentColor" strokeWidth="5" strokeLinecap="round" className={mark} />
          <line x1="52" y1="28" x2="28" y2="52" stroke="currentColor" strokeWidth="5" strokeLinecap="round" className={mark} />
        </>
      ) : null}
      {kind === 'warning' ? (
        <>
          <line x1="40" y1="23" x2="40" y2="44" stroke="currentColor" strokeWidth="5" strokeLinecap="round" className={mark} />
          <line x1="40" y1="54" x2="40" y2="55" stroke="currentColor" strokeWidth="6" strokeLinecap="round" className={mark} />
        </>
      ) : null}
      {kind === 'info' ? (
        <>
          <line x1="40" y1="36" x2="40" y2="55" stroke="currentColor" strokeWidth="5" strokeLinecap="round" className={mark} />
          <line x1="40" y1="25" x2="40" y2="26" stroke="currentColor" strokeWidth="6" strokeLinecap="round" className={mark} />
        </>
      ) : null}
      {kind === 'question' ? (
        <>
          <path d="M31 31 C31 22 49 22 49 32 C49 39 40 39 40 46" stroke="currentColor" strokeWidth="5" strokeLinecap="round" className={mark} />
          <line x1="40" y1="56" x2="40" y2="57" stroke="currentColor" strokeWidth="6" strokeLinecap="round" className={mark} />
        </>
      ) : null}
    </svg>
  );
};

export default NotifyIcon;
