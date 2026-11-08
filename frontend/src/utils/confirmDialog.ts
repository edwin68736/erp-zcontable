/**
 * Confirmaciones de la aplicación. Reemplaza `window.confirm` (el cuadro gris del navegador, distinto en cada equipo
 * y que no se puede estilizar) por un diálogo propio: `if (!(await confirmDialog({ message: '…' }))) return;`.
 * El diálogo (ConfirmHost) se monta una vez en el Layout; si por algún motivo no hay uno, se cae al del navegador.
 */
export interface ConfirmOptions {
  /** Texto principal. Admite saltos de línea (\n\n separa párrafos). */
  message: string;
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Acción destructiva: el botón de confirmar va en rojo. */
  danger?: boolean;
}

export type ConfirmPrompt = (options: ConfirmOptions) => Promise<boolean>;

let prompt: ConfirmPrompt | null = null;

/** El host se registra al montarse; devuelve la función que lo quita. */
export function registerConfirmPrompt(p: ConfirmPrompt): () => void {
  prompt = p;
  return () => {
    if (prompt === p) prompt = null;
  };
}

/** Pide confirmación. true si la persona acepta; false si cancela, cierra o no hay forma de preguntar. */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  if (prompt) return prompt(options).catch(() => false);
  if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
    return Promise.resolve(window.confirm(options.message));
  }
  return Promise.resolve(false);
}
