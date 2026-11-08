import { useEffect, useState, type FormEvent } from 'react';
import Button from '../../components/ui/Button';
import { apiErrorMessage, securityService, type DeviceTrustMode, type SecuritySettings } from '../../services/security';
import { MODE_HELP, MODE_LABEL, dateInputValue } from './deviceUi';

const INPUT = 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800';
const MODES: DeviceTrustMode[] = ['off', 'learn', 'enforce'];

/** Cómo se tratan los equipos nuevos: desactivado, aprendizaje u obligatorio (con fecha programada opcional). */
export default function SettingsTab({ canEdit }: { canEdit: boolean }) {
  const [current, setCurrent] = useState<SecuritySettings | null>(null);
  const [mode, setMode] = useState<DeviceTrustMode>('learn');
  const [days, setDays] = useState(30);
  const [from, setFrom] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const apply = (s: SecuritySettings) => {
    setCurrent(s);
    setMode(s.device_trust_mode);
    setDays(s.device_trust_days);
    setFrom(dateInputValue(s.enforce_from));
  };

  useEffect(() => {
    securityService
      .settings()
      .then(apply)
      .catch((e) => setError(apiErrorMessage(e, 'No se pudo leer la configuración.')));
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      apply(await securityService.saveSettings({ device_trust_mode: mode, device_trust_days: days, enforce_from: mode === 'learn' ? from : '' }));
      setSaved(true);
    } catch (err) {
      setError(apiErrorMessage(err, 'No se pudo guardar.'));
    } finally {
      setBusy(false);
    }
  };

  const daysOk = Number.isInteger(days) && days >= 1 && days <= 180;

  return (
    <form onSubmit={submit} className="max-w-2xl space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      {current ? (
        <p className="text-sm text-slate-600">
          Hoy rige: <strong>{MODE_LABEL[current.effective_mode]}</strong>
          {current.effective_mode !== current.device_trust_mode ? ' (por la fecha programada)' : ''}.
        </p>
      ) : null}

      <fieldset className="space-y-2" disabled={!canEdit}>
        <legend className="mb-1 text-sm font-semibold text-slate-800">Equipos nuevos</legend>
        {MODES.map((m) => (
          <label key={m} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm ${mode === m ? 'border-primary-500 bg-primary-50/40' : 'border-slate-200'}`}>
            <input type="radio" name="mode" value={m} checked={mode === m} onChange={() => setMode(m)} className="mt-1" />
            <span>
              <span className="block font-semibold text-slate-800">{MODE_LABEL[m]}</span>
              <span className="block text-xs text-slate-500">{MODE_HELP[m]}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {mode === 'learn' ? (
        <label className="block text-sm">
          <span className="mb-1 block text-slate-700">Pasar a «Obligatorio» automáticamente desde (opcional)</span>
          <input type="date" value={from} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setFrom(e.target.value)} disabled={!canEdit} className={INPUT} />
          <span className="mt-1 block text-xs text-slate-500">
            Recomendado: déjelo en aprendizaje unos días para que todos los equipos habituales queden registrados, y programe aquí la fecha. Antes de esa fecha pida a cada persona que active su app en «Mi cuenta».
          </span>
        </label>
      ) : null}

      {mode !== 'off' ? (
        <label className="block text-sm">
          <span className="mb-1 block text-slate-700">Días de confianza de un equipo</span>
          <input
            type="number"
            min={1}
            max={180}
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            disabled={!canEdit}
            className={`${INPUT} w-28`}
          />
          <span className="mt-1 block text-xs text-slate-500">
            Si el equipo se usa, la confianza se renueva sola; si pasan estos días sin usarlo, vuelve a pedir verificación. Máximo 180 días desde que se registró.
          </span>
        </label>
      ) : null}

      {error ? <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">{error}</p> : null}
      {saved ? <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800" role="status">Configuración guardada.</p> : null}

      {canEdit ? (
        <Button type="submit" disabled={busy || (mode !== 'off' && !daysOk)}>
          <i className={`fas ${busy ? 'fa-spinner fa-spin' : 'fa-floppy-disk'} mr-1.5`} aria-hidden />
          Guardar
        </Button>
      ) : (
        <p className="text-xs text-slate-500">Solo quien administra los dispositivos de confianza puede cambiar esto.</p>
      )}
    </form>
  );
}
