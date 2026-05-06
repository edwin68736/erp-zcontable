import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { auth } from '../services/auth';
import { configService } from '../services/config';
import type { FirmConfig } from '../types/dashboard';
import { resolveBackendUrl } from '../api/client';

const Settings = () => {
  const role = auth.getRole() ?? '';
  const isAdmin = useMemo(() => role === 'Administrador', [role]);
  const canEdit = isAdmin;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadingStatement, setUploadingStatement] = useState<null | 'bank' | 'qr'>(null);
  const [error, setError] = useState('');

  const [config, setConfig] = useState<FirmConfig | null>(null);

  useEffect(() => {
    if (!isAdmin) {
      setLoading(false);
      setConfig(null);
      return;
    }

    const run = async () => {
      try {
        setLoading(true);
        setError('');
        const cfg = await configService.getFirmConfig();
        setConfig(cfg);
      } catch (e) {
        console.error(e);
        setError('Error cargando configuración');
      } finally {
        setLoading(false);
      }
    };
    run();
  }, [isAdmin]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (!config) return;
    setConfig({ ...config, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!canEdit) {
      setError('No tienes permisos para realizar esta acción');
      return;
    }
    if (!config) return;

    try {
      setSaving(true);
      setError('');
      const updated = await configService.updateFirmConfig({
        name: config.name,
        ruc: config.ruc,
        address: config.address,
        phone: config.phone,
        email: config.email,
        tukifac_api_url: config.tukifac_api_url,
        tukifac_api_token: config.tukifac_api_token,
        apiperu_base_url: config.apiperu_base_url,
        apiperu_token: config.apiperu_token,
        statement_whatsapp_notice: config.statement_whatsapp_notice ?? '',
        statement_bank_info: config.statement_bank_info ?? '',
        statement_payment_observations: config.statement_payment_observations ?? '',
        statement_payment_qr_caption: config.statement_payment_qr_caption ?? '',
      });
      setConfig(updated);
      window.dispatchEvent(
        new CustomEvent('miweb:toast', { detail: { type: 'success', message: 'Configuración guardada.' } }),
      );
    } catch (e2) {
      console.error(e2);
      setError('Error al guardar configuración');
      window.dispatchEvent(
        new CustomEvent('miweb:toast', { detail: { type: 'error', message: 'Error al guardar configuración' } }),
      );
    } finally {
      setSaving(false);
    }
  };

  const handleLogoChange = async (file: File | null) => {
    if (!file) return;
    if (!canEdit) {
      setError('No tienes permisos para realizar esta acción');
      return;
    }
    try {
      setUploading(true);
      setError('');
      const res = await configService.uploadFirmLogo(file);
      setConfig(res.config);
      window.dispatchEvent(
        new CustomEvent('miweb:toast', { detail: { type: 'success', message: 'Logo actualizado.' } }),
      );
    } catch (e) {
      console.error(e);
      setError('Error al subir el logo');
      window.dispatchEvent(
        new CustomEvent('miweb:toast', { detail: { type: 'error', message: 'Error al subir el logo' } }),
      );
    } finally {
      setUploading(false);
    }
  };

  const handleStatementBankLogo = async (file: File | null) => {
    if (!file || !canEdit) return;
    try {
      setUploadingStatement('bank');
      setError('');
      const res = await configService.uploadStatementBankLogo(file);
      setConfig(res.config);
      window.dispatchEvent(
        new CustomEvent('miweb:toast', { detail: { type: 'success', message: 'Logo del banco actualizado.' } }),
      );
    } catch (e) {
      console.error(e);
      setError('Error al subir el logo del banco');
      window.dispatchEvent(
        new CustomEvent('miweb:toast', { detail: { type: 'error', message: 'Error al subir el logo del banco' } }),
      );
    } finally {
      setUploadingStatement(null);
    }
  };

  const handleStatementPaymentQr = async (file: File | null) => {
    if (!file || !canEdit) return;
    try {
      setUploadingStatement('qr');
      setError('');
      const res = await configService.uploadStatementPaymentQr(file);
      setConfig(res.config);
      window.dispatchEvent(
        new CustomEvent('miweb:toast', { detail: { type: 'success', message: 'QR de pagos actualizado.' } }),
      );
    } catch (e) {
      console.error(e);
      setError('Error al subir el QR');
      window.dispatchEvent(
        new CustomEvent('miweb:toast', { detail: { type: 'error', message: 'Error al subir el QR' } }),
      );
    } finally {
      setUploadingStatement(null);
    }
  };

  const initials = useMemo(() => {
    const name = (config?.name ?? '').trim();
    if (!name) return 'E';
    const parts = name.split(/\s+/).filter(Boolean);
    const first = parts[0]?.[0] ?? 'E';
    const second = parts.length > 1 ? parts[1]?.[0] ?? '' : '';
    return (first + second).toUpperCase();
  }, [config?.name]);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-800">Perfil del estudio</h2>
        <p className="text-sm text-slate-500">Datos generales utilizados en reportes y encabezados.</p>
      </div>

      {!isAdmin ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          No tienes permisos para acceder a esta pantalla
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-6 text-sm text-slate-600">
          <i className="fas fa-spinner fa-spin mr-2"></i> Cargando...
        </div>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}

      {config ? (
        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-6 py-6 bg-gradient-to-r from-primary-700 to-emerald-700 text-white">
              <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-5">
                <div className="flex items-center gap-4">
                  <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl bg-white/15 ring-1 ring-white/25 overflow-hidden flex items-center justify-center">
                    {config.logo_url ? (
                      <div className="w-full h-full bg-white flex items-center justify-center p-3">
                        <img src={resolveBackendUrl(config.logo_url)} alt="Logo del estudio" className="w-full h-full object-contain" />
                      </div>
                    ) : (
                      <div className="text-2xl sm:text-3xl font-extrabold tracking-wide">{initials}</div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold uppercase tracking-widest text-white/70">Estudio</div>
                    <div className="text-xl sm:text-2xl font-bold leading-tight truncate">{config.name || '—'}</div>
                    <div className="mt-1 text-sm text-white/80 flex flex-wrap items-center gap-x-4 gap-y-1">
                      <span className="inline-flex items-center gap-2">
                        <i className="fas fa-id-card text-xs"></i>
                        <span className="font-medium">RUC:</span>
                        <span className="font-semibold">{config.ruc || '—'}</span>
                      </span>
                      {config.email ? (
                        <span className="inline-flex items-center gap-2">
                          <i className="fas fa-envelope text-xs"></i>
                          <span className="truncate">{config.email}</span>
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <label
                    className={`inline-flex items-center justify-center px-4 py-2 rounded-full border text-sm font-medium shadow-sm ${
                      canEdit && !saving && !uploading
                        ? 'bg-white text-slate-800 border-white/30 hover:bg-white/90 cursor-pointer'
                        : 'bg-white/40 text-white/70 border-white/20 cursor-not-allowed'
                    }`}
                  >
                    <i className={`fas ${uploading ? 'fa-spinner fa-spin' : 'fa-upload'} mr-2 text-xs`}></i>
                    {uploading ? 'Subiendo...' : 'Cambiar logo'}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={!canEdit || saving || uploading}
                      onChange={(ev) => {
                        const file = ev.target.files?.[0] ?? null;
                        handleLogoChange(file);
                        ev.currentTarget.value = '';
                      }}
                    />
                  </label>
                </div>
              </div>
            </div>

            <div className="px-6 py-5">
              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <div className="text-sm font-semibold text-slate-800">Información del estudio</div>
                  <div className="text-xs text-slate-500">Actualiza los datos que se usan en reportes y encabezados.</div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="name" className="block text-sm font-medium text-slate-700 mb-1">
                      Nombre del estudio
                    </label>
                    <input
                      type="text"
                      id="name"
                      name="name"
                      required
                      value={config.name ?? ''}
                      onChange={handleChange}
                      disabled={!canEdit || saving || uploading}
                      className="w-full px-3 py-2.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none disabled:opacity-60"
                    />
                  </div>
                  <div>
                    <label htmlFor="ruc" className="block text-sm font-medium text-slate-700 mb-1">
                      RUC del estudio
                    </label>
                    <input
                      type="text"
                      id="ruc"
                      name="ruc"
                      required
                      value={config.ruc ?? ''}
                      onChange={handleChange}
                      disabled={!canEdit || saving || uploading}
                      className="w-full px-3 py-2.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none disabled:opacity-60"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="address" className="block text-sm font-medium text-slate-700 mb-1">
                    Dirección
                  </label>
                  <input
                    type="text"
                    id="address"
                    name="address"
                    required
                    value={config.address ?? ''}
                    onChange={handleChange}
                    disabled={!canEdit || saving || uploading}
                    className="w-full px-3 py-2.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none disabled:opacity-60"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="phone" className="block text-sm font-medium text-slate-700 mb-1">
                      Teléfono
                    </label>
                    <input
                      type="text"
                      id="phone"
                      name="phone"
                      value={config.phone ?? ''}
                      onChange={handleChange}
                      disabled={!canEdit || saving || uploading}
                      className="w-full px-3 py-2.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none disabled:opacity-60"
                    />
                  </div>
                  <div>
                    <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-1">
                      Correo institucional
                    </label>
                    <input
                      type="email"
                      id="email"
                      name="email"
                      value={config.email ?? ''}
                      onChange={handleChange}
                      disabled={!canEdit || saving || uploading}
                      className="w-full px-3 py-2.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none disabled:opacity-60"
                    />
                  </div>
                </div>

                <div className="pt-2">
                  <div className="text-sm font-semibold text-slate-800">ApiPeru.dev (consulta RUC)</div>
                  <div className="text-xs text-slate-500">
                    Datos oficiales SUNAT según{' '}
                    <a
                      href="https://docs.apiperu.dev/enpoints/consulta-ruc"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary-600 hover:underline"
                    >
                      documentación ApiPeru.dev
                    </a>
                    . Se usa al validar RUC en el formulario de empresa.
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="apiperu_base_url" className="block text-sm font-medium text-slate-700 mb-1">
                      URL base (ApiPeru.dev)
                    </label>
                    <input
                      type="url"
                      id="apiperu_base_url"
                      name="apiperu_base_url"
                      value={config.apiperu_base_url ?? ''}
                      onChange={handleChange}
                      disabled={!canEdit || saving || uploading}
                      placeholder="https://apiperu.dev"
                      className="w-full px-3 py-2.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none disabled:opacity-60"
                    />
                  </div>
                  <div>
                    <label htmlFor="apiperu_token" className="block text-sm font-medium text-slate-700 mb-1">
                      Token Bearer (ApiPeru.dev)
                    </label>
                    <input
                      type="password"
                      id="apiperu_token"
                      name="apiperu_token"
                      value={config.apiperu_token ?? ''}
                      onChange={handleChange}
                      disabled={!canEdit || saving || uploading}
                      placeholder="Token de tu cuenta ApiPeru.dev"
                      className="w-full px-3 py-2.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none disabled:opacity-60"
                      autoComplete="off"
                    />
                  </div>
                </div>

                <div className="pt-4 border-t border-slate-100">
                  <div className="text-sm font-semibold text-slate-800">Pie de página — estado de cuenta</div>
                  <div className="text-xs text-slate-500 mt-1">
                    Texto e imágenes que aparecen al final del estado de cuenta (pantalla y PDF), por ejemplo datos de
                    cuenta bancaria, observaciones y QR de Yape u otro medio de pago.
                  </div>
                </div>

                <div>
                  <label htmlFor="statement_whatsapp_notice" className="block text-sm font-medium text-slate-700 mb-1">
                    Aviso de contacto (WhatsApp / canales)
                  </label>
                  <textarea
                    id="statement_whatsapp_notice"
                    name="statement_whatsapp_notice"
                    rows={2}
                    value={config.statement_whatsapp_notice ?? ''}
                    onChange={handleChange}
                    disabled={!canEdit || saving || uploading || uploadingStatement !== null}
                    placeholder="Puedes solicitar tu estado de cuenta a través del grupo de WhatsApp de tu empresa…"
                    className="w-full px-3 py-2.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none disabled:opacity-60 resize-y min-h-[3rem]"
                  />
                </div>

                <div>
                  <label htmlFor="statement_bank_info" className="block text-sm font-medium text-slate-700 mb-1">
                    Información bancaria
                  </label>
                  <textarea
                    id="statement_bank_info"
                    name="statement_bank_info"
                    rows={6}
                    value={config.statement_bank_info ?? ''}
                    onChange={handleChange}
                    disabled={!canEdit || saving || uploading || uploadingStatement !== null}
                    placeholder={'Ej.\nCUENTA BCP\nN° Cuenta: …\nCCI: …\nTitular: …\nYAPE: …'}
                    className="w-full px-3 py-2.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none disabled:opacity-60 resize-y font-mono"
                  />
                </div>

                <div>
                  <label htmlFor="statement_payment_observations" className="block text-sm font-medium text-slate-700 mb-1">
                    Observaciones
                  </label>
                  <textarea
                    id="statement_payment_observations"
                    name="statement_payment_observations"
                    rows={3}
                    value={config.statement_payment_observations ?? ''}
                    onChange={handleChange}
                    disabled={!canEdit || saving || uploading || uploadingStatement !== null}
                    placeholder="Ej. Enviar la constancia de depósito o transferencia al grupo de WhatsApp…"
                    className="w-full px-3 py-2.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none disabled:opacity-60 resize-y"
                  />
                </div>

                <div>
                  <label htmlFor="statement_payment_qr_caption" className="block text-sm font-medium text-slate-700 mb-1">
                    Texto bajo el QR de pago
                  </label>
                  <input
                    type="text"
                    id="statement_payment_qr_caption"
                    name="statement_payment_qr_caption"
                    value={config.statement_payment_qr_caption ?? ''}
                    onChange={handleChange}
                    disabled={!canEdit || saving || uploading || uploadingStatement !== null}
                    placeholder="Paga aquí con Yape"
                    className="w-full px-3 py-2.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none disabled:opacity-60"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <div className="text-sm font-medium text-slate-700 mb-2">Logo del banco</div>
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="w-36 h-20 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-center p-2 overflow-hidden">
                        {config.statement_bank_logo_url ? (
                          <img
                            src={resolveBackendUrl(config.statement_bank_logo_url)}
                            alt="Logo banco"
                            className="max-w-full max-h-full object-contain"
                          />
                        ) : (
                          <span className="text-xs text-slate-400">Sin imagen</span>
                        )}
                      </div>
                      <label
                        className={`inline-flex items-center px-3 py-2 rounded-full border text-xs font-medium ${
                          canEdit && !saving && !uploading && uploadingStatement === null
                            ? 'border-slate-300 text-slate-700 hover:bg-slate-50 cursor-pointer'
                            : 'border-slate-200 text-slate-400 cursor-not-allowed'
                        }`}
                      >
                        <i
                          className={`fas ${uploadingStatement === 'bank' ? 'fa-spinner fa-spin' : 'fa-upload'} mr-2`}
                        />
                        Subir logo
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          disabled={!canEdit || saving || uploading || uploadingStatement !== null}
                          onChange={(ev) => {
                            const f = ev.target.files?.[0] ?? null;
                            void handleStatementBankLogo(f);
                            ev.currentTarget.value = '';
                          }}
                        />
                      </label>
                    </div>
                  </div>
                  <div>
                    <div className="text-sm font-medium text-slate-700 mb-2">QR de pago (Yape, Plin, etc.)</div>
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="w-28 h-28 rounded-lg border border-slate-200 bg-white flex items-center justify-center p-1 overflow-hidden">
                        {config.statement_payment_qr_url ? (
                          <img
                            src={resolveBackendUrl(config.statement_payment_qr_url)}
                            alt="QR pagos"
                            className="max-w-full max-h-full object-contain"
                          />
                        ) : (
                          <span className="text-xs text-slate-400 text-center px-1">Sin QR</span>
                        )}
                      </div>
                      <label
                        className={`inline-flex items-center px-3 py-2 rounded-full border text-xs font-medium ${
                          canEdit && !saving && !uploading && uploadingStatement === null
                            ? 'border-slate-300 text-slate-700 hover:bg-slate-50 cursor-pointer'
                            : 'border-slate-200 text-slate-400 cursor-not-allowed'
                        }`}
                      >
                        <i className={`fas ${uploadingStatement === 'qr' ? 'fa-spinner fa-spin' : 'fa-upload'} mr-2`} />
                        Subir QR
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          disabled={!canEdit || saving || uploading || uploadingStatement !== null}
                          onChange={(ev) => {
                            const f = ev.target.files?.[0] ?? null;
                            void handleStatementPaymentQr(f);
                            ev.currentTarget.value = '';
                          }}
                        />
                      </label>
                    </div>
                  </div>
                </div>

                <div className="pt-2">
                  <div className="text-sm font-semibold text-slate-800">Integración Tukifac</div>
                  <div className="text-xs text-slate-500">Configura el endpoint del API y el token de acceso.</div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="tukifac_api_url" className="block text-sm font-medium text-slate-700 mb-1">
                      URL del API (Tukifac)
                    </label>
                    <input
                      type="url"
                      id="tukifac_api_url"
                      name="tukifac_api_url"
                      value={config.tukifac_api_url ?? ''}
                      onChange={handleChange}
                      disabled={!canEdit || saving || uploading}
                      placeholder="https://doricontdemo.app.tukifac.pe/api"
                      className="w-full px-3 py-2.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none disabled:opacity-60"
                    />
                  </div>
                  <div>
                    <label htmlFor="tukifac_api_token" className="block text-sm font-medium text-slate-700 mb-1">
                      Token Bearer (Tukifac)
                    </label>
                    <input
                      type="password"
                      id="tukifac_api_token"
                      name="tukifac_api_token"
                      value={config.tukifac_api_token ?? ''}
                      onChange={handleChange}
                      disabled={!canEdit || saving || uploading}
                      placeholder="Bearer ..."
                      className="w-full px-3 py-2.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none disabled:opacity-60"
                      autoComplete="off"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-end pt-1">
                  <button
                    type="submit"
                    disabled={!canEdit || saving || uploading}
                    className="inline-flex items-center justify-center px-5 py-2.5 rounded-full bg-primary-600 text-white text-sm font-medium shadow-sm hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-primary-500 disabled:opacity-60"
                  >
                    <i className="fas fa-save mr-2 text-xs"></i>
                    {saving ? 'Guardando...' : 'Guardar cambios'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default Settings;
