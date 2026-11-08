/**
 * Confirmación de contraseña para acciones sensibles. Cuando el servidor responde 403 con código `reauth_required`, el
 * cliente HTTP pide la contraseña (con el diálogo registrado aquí) y, si la persona la confirma, repite la petición.
 * Si varias peticiones piden confirmación a la vez, se muestra un solo diálogo y todas comparten el resultado.
 */
export type ReauthPrompt = () => Promise<boolean>;

let prompt: ReauthPrompt | null = null;
let inflight: Promise<boolean> | null = null;

/** El diálogo se registra al montarse; devuelve la función que lo quita. */
export function registerReauthPrompt(p: ReauthPrompt): () => void {
  prompt = p;
  return () => {
    if (prompt === p) prompt = null;
  };
}

/** Pide confirmar la contraseña. true si la confirmó; false si canceló o no hay diálogo disponible. */
export function askReauth(): Promise<boolean> {
  if (!prompt) return Promise.resolve(false);
  if (!inflight) {
    inflight = prompt()
      .catch(() => false)
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/** ¿Es la respuesta del servidor que pide confirmar la contraseña? */
export function isReauthRequired(status: number | undefined, code: string | undefined): boolean {
  return status === 403 && code === 'reauth_required';
}
