import { useEffect, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import Button from '../../../components/ui/Button';
import { sireService, type SireApiError } from '../../../services/sire';
import { INPUT_CLS } from './sireUi';
import { notify } from '../../../utils/notify';

type Props = {
  open: boolean;
  companyId: number;
  companyName: string;
  onClose: () => void;
  /** Se llama tras guardar, para que la pantalla recargue el estado de la empresa. */
  onSaved: () => void;
};

/**
 * Registro rápido de las credenciales de API SUNAT (Client ID y Client Secret) de una empresa. Solo esos dos datos:
 * el usuario y la clave SOL se cargan en Claves SOL. El secreto nunca vuelve del servidor, así que el formulario
 * siempre se abre vacío.
 */
const SireCredentialsModal = ({ open, companyId, companyName, onClose, onSaved }: Props) => {
  const [clientId, setClientId] = useState('');
  const [secret, setSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<SireApiError | null>(null);

  useEffect(() => {
    if (!open) return;
    setClientId('');
    setSecret('');
    setShowSecret(false);
    setError(null);
  }, [open, companyId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, saving, onClose]);

  if (!open) return null;

  const canSave = clientId.trim() !== '' && secret.trim() !== '' && !saving;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await sireService.saveCredentials(companyId, { client_id: clientId.trim(), client_secret: secret.trim() });
      void notify.success('Credenciales guardadas', 'Ya puede consultar el SIRE de esta empresa.');
      onSaved();
      onClose();
    } catch (err) {
      setError(err as SireApiError);
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-dialog flex items-center justify-center p-4">
      <button type="button" aria-label="Cerrar" disabled={saving} onClick={onClose} className="absolute inset-0 bg-slate-900/50 backdrop-blur-[1px]" />
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="sire-cred-modal-title"
        onSubmit={(e) => void submit(e)}
        className="relative w-full max-w-md space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xl"
      >
        <div>
          <h2 id="sire-cred-modal-title" className="text-lg font-semibold text-slate-800">
            Credenciales de API SUNAT
          </h2>
          <p className="mt-1 text-sm text-slate-500">{companyName}</p>
          <p className="mt-2 text-xs text-slate-500">
            Se generan en SOL de la empresa: <em>Empresas → Credenciales de API SUNAT → Gestión</em>, marcando «MIGE RCE y RVIE - SIRE» con alcance Web. SUNAT entrega un Client ID y un Client Secret.
          </p>
        </div>

        <label className="block text-xs text-slate-600">
          <span className="mb-0.5 block">Client ID</span>
          <input value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" spellCheck={false} className={`${INPUT_CLS} w-full font-mono`} autoFocus />
        </label>
        <label className="block text-xs text-slate-600">
          <span className="mb-0.5 block">Client Secret</span>
          <div className="relative">
            <input
              type={showSecret ? 'text' : 'password'}
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              autoComplete="new-password"
              spellCheck={false}
              className={`${INPUT_CLS} w-full pr-10 font-mono`}
            />
            <button
              type="button"
              onClick={() => setShowSecret((v) => !v)}
              aria-label={showSecret ? 'Ocultar secreto' : 'Mostrar secreto'}
              className="absolute inset-y-0 right-0 px-3 text-slate-400 hover:text-slate-700"
            >
              <i className={`fas ${showSecret ? 'fa-eye-slash' : 'fa-eye'}`} aria-hidden />
            </button>
          </div>
        </label>

        {error ? (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error.message}
          </p>
        ) : null}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" disabled={saving} onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={!canSave}>
            {saving ? 'Guardando…' : 'Guardar'}
          </Button>
        </div>
      </form>
    </div>,
    document.body,
  );
};

export default SireCredentialsModal;
