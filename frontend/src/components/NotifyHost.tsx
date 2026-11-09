import { useEffect, useId, useRef, useSyncExternalStore, type KeyboardEvent } from 'react';
import { close, getState, pause, registerNotifyHost, resume, subscribe } from '../utils/notify';
import NotifyIcon from './notify/NotifyIcon';

/**
 * Dibuja la alerta que toca mostrar (utils/notify.ts), siempre en el centro de la pantalla. Se monta una vez en el
 * Layout. Éxito e información se cierran solos (con barra de tiempo) o con un clic; error, advertencia y confirmación
 * piden respuesta; «cargando» no se puede cerrar. Escape cancela; el foco entra a los botones y vuelve al final.
 */
const NotifyHost = () => {
  const { current, paused } = useSyncExternalStore(subscribe, getState, getState);
  const cardRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const textId = useId();

  useEffect(() => registerNotifyHost(), []);

  // Foco: entra al botón seguro y vuelve a donde estaba al cerrar.
  const id = current?.id;
  useEffect(() => {
    if (!current) return;
    const previous = document.activeElement as HTMLElement | null;
    const buttons = cardRef.current?.querySelectorAll<HTMLButtonElement>('button');
    if (buttons && buttons.length > 0) {
      const target = current.kind === 'question' && current.danger ? buttons[0] : buttons[buttons.length - 1];
      target.focus();
    }
    return () => {
      if (previous && document.contains(previous)) previous.focus?.();
    };
    // Solo cuando cambia la alerta, no en cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!current) return null;
  const { kind, title, text, confirmLabel, cancelLabel, danger, autoCloseMs } = current;
  const blocking = kind === 'error' || kind === 'warning' || kind === 'question';
  const canDismiss = kind !== 'loading';
  const dismiss = () => close(kind !== 'question');

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && canDismiss) {
      e.preventDefault();
      e.stopPropagation();
      dismiss();
      return;
    }
    if (e.key === 'Tab') {
      const buttons = Array.from(cardRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? []);
      if (buttons.length === 0) {
        e.preventDefault();
        return;
      }
      const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const nextIdx = e.shiftKey ? (i <= 0 ? buttons.length - 1 : i - 1) : i === buttons.length - 1 ? 0 : i + 1;
      e.preventDefault();
      buttons[nextIdx].focus();
    }
  };

  return (
    <div
      className="fixed inset-0 z-dialog flex items-center justify-center bg-slate-900/50 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && canDismiss) dismiss();
      }}
      onKeyDown={onKeyDown}
    >
      <div
        key={current.id}
        ref={cardRef}
        role={blocking ? 'alertdialog' : 'status'}
        aria-modal={blocking ? true : undefined}
        aria-live={blocking ? undefined : 'polite'}
        aria-labelledby={titleId}
        aria-describedby={text ? textId : undefined}
        tabIndex={-1}
        onMouseEnter={autoCloseMs ? pause : undefined}
        onMouseLeave={autoCloseMs ? resume : undefined}
        onClick={!blocking && canDismiss ? dismiss : undefined}
        className={`notify-pop relative w-full max-w-sm overflow-hidden rounded-xl bg-white px-6 pb-6 pt-7 text-center shadow-2xl outline-none ${!blocking && canDismiss ? 'cursor-pointer' : ''}`}
      >
        <NotifyIcon kind={kind} danger={danger} />
        <h2 id={titleId} className="text-xl font-bold text-slate-800">
          {title}
        </h2>
        {text ? (
          <p id={textId} className="mt-1.5 whitespace-pre-line break-words text-sm leading-relaxed text-slate-600">
            {text}
          </p>
        ) : null}

        {kind === 'question' ? (
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <button type="button" onClick={() => close(false)} className="rounded-lg border border-slate-300 bg-white px-5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              {cancelLabel ?? 'Cancelar'}
            </button>
            <button
              type="button"
              onClick={() => close(true)}
              className={`rounded-lg px-5 py-2 text-sm font-medium text-white ${danger ? 'bg-red-600 hover:bg-red-700' : 'bg-primary-600 hover:bg-primary-700'}`}
            >
              {confirmLabel ?? 'Confirmar'}
            </button>
          </div>
        ) : null}

        {kind === 'error' || kind === 'warning' ? (
          <div className="mt-5 flex justify-center">
            <button type="button" onClick={() => close(true)} className="rounded-lg bg-primary-600 px-6 py-2 text-sm font-medium text-white hover:bg-primary-700">
              {confirmLabel ?? 'Aceptar'}
            </button>
          </div>
        ) : null}

        {autoCloseMs ? (
          <div
            className="notify-bar absolute bottom-0 left-0 h-[3px] bg-primary-600"
            style={{ animationDuration: `${autoCloseMs}ms`, animationPlayState: paused ? 'paused' : 'running' }}
            aria-hidden
          />
        ) : null}
      </div>
    </div>
  );
};

export default NotifyHost;
