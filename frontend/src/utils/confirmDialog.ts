import { notify, type ConfirmOptions } from './notify';

export type { ConfirmOptions };

/**
 * Confirmación imperativa: `if (!(await confirmDialog({ message: '¿Eliminar?', danger: true }))) return;`.
 * Es un atajo de `notify.confirm` (alerta centrada, utils/notify.ts); sin componente de dibujo cae al `confirm` del
 * navegador.
 */
export const confirmDialog = (options: ConfirmOptions): Promise<boolean> => notify.confirm(options);
