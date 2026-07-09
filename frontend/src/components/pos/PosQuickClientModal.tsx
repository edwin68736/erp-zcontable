import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { posSalesService } from '../../services/posSales';
import type { Company } from '../../types/dashboard';

function docDigits(raw: string): string {
  return raw.replace(/\D/g, '');
}

type Props = {
  open: boolean;
  initialSearch?: string;
  onClose: () => void;
  onCreated: (company: Company) => void;
};

const PosQuickClientModal = ({ open, initialSearch = '', onClose, onCreated }: Props) => {
  const [doc, setDoc] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [validating, setValidating] = useState(false);
  const [saving, setSaving] = useState(false);
  const lastLookup = useRef('');
  const lookupInFlight = useRef(false);

  useEffect(() => {
    if (!open) return;
    setDoc(initialSearch.replace(/\D/g, '').slice(0, 11));
    setBusinessName('');
    setAddress('');
    setPhone('');
    setEmail('');
    setError('');
    lastLookup.current = '';
  }, [open, initialSearch]);

  const runLookup = useCallback(async (raw: string, mode: 'auto' | 'manual') => {
    if (lookupInFlight.current) return;
    const digits = docDigits(raw);
    if (digits.length !== 8 && digits.length !== 11) {
      if (mode === 'manual') {
        setError('Ingrese un DNI (8 dígitos) o RUC (11 dígitos)');
      }
      return;
    }
    if (mode === 'auto' && digits === lastLookup.current) return;

    setError('');
    lookupInFlight.current = true;
    setValidating(true);
    try {
      if (digits.length === 11) {
        const data = await posSalesService.validateRuc(digits);
        setDoc(data.ruc ?? digits);
        if (data.business_name) setBusinessName(data.business_name);
        if (data.address) setAddress(data.address);
        lastLookup.current = docDigits(data.ruc ?? digits);
        window.dispatchEvent(
          new CustomEvent('miweb:toast', {
            detail: { type: 'success', message: 'Datos obtenidos desde SUNAT (ApiPeru.dev).' },
          }),
        );
      } else {
        const data = await posSalesService.validateDni(digits);
        setDoc(data.dni ?? digits);
        if (data.full_name) setBusinessName(data.full_name);
        lastLookup.current = docDigits(data.dni ?? digits);
        window.dispatchEvent(
          new CustomEvent('miweb:toast', {
            detail: { type: 'success', message: 'Datos obtenidos desde RENIEC (ApiPeru.dev).' },
          }),
        );
      }
    } catch (e: unknown) {
      const ax = e as { response?: { data?: { error?: string } } };
      const msg = ax.response?.data?.error ?? 'No se pudo consultar el documento';
      if (mode === 'manual') setError(msg);
    } finally {
      lookupInFlight.current = false;
      setValidating(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const digits = docDigits(doc);
    if (digits.length !== 8 && digits.length !== 11) return;
    if (digits === lastLookup.current) return;
    const t = window.setTimeout(() => {
      void runLookup(doc, 'auto');
    }, 500);
    return () => window.clearTimeout(t);
  }, [doc, open, runLookup]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const digits = docDigits(doc);
    if (digits.length !== 8 && digits.length !== 11) {
      setError('El documento debe tener 8 (DNI) u 11 (RUC) dígitos');
      return;
    }
    if (!businessName.trim()) {
      setError('El nombre o razón social es requerido');
      return;
    }
    try {
      setSaving(true);
      setError('');
      const created = await posSalesService.createQuickCompany({
        ruc: digits,
        business_name: businessName.trim(),
        trade_name: businessName.trim(),
        address: address.trim() || undefined,
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
      });
      window.dispatchEvent(
        new CustomEvent('miweb:toast', {
          detail: { type: 'success', message: 'Cliente registrado. Ya puede usarlo en la venta.' },
        }),
      );
      onCreated(created);
      onClose();
    } catch (err: unknown) {
      const ax = err as { response?: { data?: { error?: string } } };
      setError(ax.response?.data?.error ?? 'No se pudo registrar el cliente');
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[10001] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
        onClick={() => !saving && onClose()}
        aria-label="Cerrar"
      />
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-md rounded-t-2xl border border-slate-200 bg-white shadow-2xl sm:rounded-2xl"
      >
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-lg font-semibold text-slate-900">Nuevo cliente (venta rápida)</h2>
          <p className="mt-1 text-sm text-slate-600">
            Solo para emitir ventas. No incluye plan ni equipo contable.
          </p>
        </div>
        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-3">
          {error ? (
            <p className="text-sm text-red-600 rounded-lg bg-red-50 border border-red-100 px-3 py-2">{error}</p>
          ) : null}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">DNI / RUC</label>
            <div className="flex gap-2">
              <input
                value={doc}
                onChange={(e) => setDoc(docDigits(e.target.value).slice(0, 11))}
                className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono"
                placeholder="8 u 11 dígitos"
                inputMode="numeric"
                autoFocus
              />
              <button
                type="button"
                disabled={validating || saving}
                onClick={() => {
                  lastLookup.current = '';
                  void runLookup(doc, 'manual');
                }}
                className="shrink-0 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {validating ? <i className="fas fa-spinner fa-spin" /> : 'Consultar'}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Nombre / Razón social</label>
            <input
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Dirección</label>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Teléfono</label>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              disabled={saving}
              onClick={onClose}
              className="rounded-full border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving || validating}
              className="rounded-full bg-primary-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
            >
              {saving ? 'Guardando…' : 'Registrar cliente'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
};

export default PosQuickClientModal;
