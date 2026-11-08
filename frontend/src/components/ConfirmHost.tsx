import { useEffect, useRef, useState } from 'react';
import ConfirmDialog from './ConfirmDialog';
import { registerConfirmPrompt, type ConfirmOptions } from '../utils/confirmDialog';

/**
 * Anfitrión de `confirmDialog()` (ver utils/confirmDialog.ts): muestra el mismo ConfirmDialog que ya usan las pantallas
 * que lo controlan con estado, para que haya un solo diálogo de confirmación en toda la aplicación. Se monta una vez en
 * el Layout.
 */
const ConfirmHost = () => {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  useEffect(
    () =>
      registerConfirmPrompt(
        (o) =>
          new Promise<boolean>((resolve) => {
            // Si llega otra confirmación con una abierta, la anterior se da por cancelada.
            resolver.current?.(false);
            resolver.current = resolve;
            setOpts(o);
          }),
      ),
    [],
  );

  const finish = (ok: boolean) => {
    setOpts(null);
    resolver.current?.(ok);
    resolver.current = null;
  };

  return (
    <ConfirmDialog
      open={opts !== null}
      title={opts?.title ?? (opts?.danger ? 'Confirme esta acción' : 'Confirmar')}
      message={opts?.message ?? ''}
      confirmLabel={opts?.confirmLabel ?? (opts?.danger ? 'Eliminar' : 'Confirmar')}
      cancelLabel={opts?.cancelLabel}
      danger={opts?.danger}
      onClose={() => finish(false)}
      onConfirm={() => finish(true)}
    />
  );
};

export default ConfirmHost;
