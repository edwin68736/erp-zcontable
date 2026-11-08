import client from '../api/client';

/** Tipos de evento de la bitácora de seguridad. */
export type SecurityEventType =
  | 'login_ok'
  | 'login_fail'
  | 'login_blocked'
  | 'password_change'
  | 'password_change_fail'
  | 'password_reset'
  | 'logout'
  | 'idle_logout'
  | 'session_revoked'
  | 'device_new'
  | 'device_challenge'
  | 'device_verified'
  | 'device_approval_requested'
  | 'device_approved'
  | 'device_denied'
  | 'device_revoked'
  | 'totp_enabled'
  | 'totp_disabled'
  | 'totp_reset'
  | 'security_settings_changed';

export interface SecurityEvent {
  id: number;
  type: SecurityEventType | string;
  user_id?: number;
  username: string;
  ip: string;
  user_agent: string;
  detail?: string;
  created_at: string;
}

export interface SecurityEventsPage {
  rows: SecurityEvent[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

export interface SecurityEventsParams {
  type?: string;
  username?: string;
  ip?: string;
  from?: string;
  to?: string;
  page?: number;
  per_page?: number;
}

/** Mensaje del servidor ante un error de la API (o el de respaldo). */
export function apiErrorMessage(err: unknown, fallback: string): string {
  const data = (err as { response?: { data?: { error?: string } } }).response?.data;
  return data?.error || fallback;
}

export interface MySession {
  id: string;
  ip: string;
  user_agent: string;
  created_at: string;
  last_active_at: string;
  /** Es la sesión desde la que se está mirando. */
  current: boolean;
}

export interface MyDevice {
  id: number;
  label: string;
  user_agent: string;
  first_ip: string;
  last_ip: string;
  via: string;
  created_at: string;
  last_seen_at: string;
  trusted_until?: string | null;
  /** Es el equipo desde el que se está mirando. */
  current?: boolean;
}

export interface TotpStatus {
  enabled: boolean;
  enabled_at?: string | null;
  recovery_codes_left: number;
}

export type DeviceTrustMode = 'off' | 'learn' | 'enforce';

export interface SecuritySettings {
  device_trust_mode: DeviceTrustMode;
  device_trust_days: number;
  enforce_from?: string | null;
  /** El modo que rige hoy (la fecha programada puede pasar de «learn» a «enforce»). */
  effective_mode: DeviceTrustMode;
}

export interface PendingApproval {
  id: string;
  user_id: number;
  username: string;
  name?: string;
  device_label: string;
  ip: string;
  requested_at: string;
  expires_at: string;
}

export const securityService = {
  // ───── Dispositivos de confianza y verificación en dos pasos (Mi cuenta) ─────
  async myDevices(): Promise<MyDevice[]> {
    const res = await client.get<{ data: MyDevice[] }>('/me/devices');
    return res.data.data ?? [];
  },

  async revokeMyDevice(id: number): Promise<void> {
    await client.delete(`/me/devices/${id}`);
  },

  async totpStatus(): Promise<TotpStatus> {
    const res = await client.get<{ data: TotpStatus }>('/me/totp');
    return res.data.data;
  },

  /** Genera el secreto y la dirección otpauth:// para el código QR (todavía no queda activada). */
  async totpSetup(): Promise<{ secret: string; uri: string }> {
    const res = await client.post<{ data: { secret: string; uri: string } }>('/me/totp/setup');
    return res.data.data;
  },

  /** Activa con un código de la app; devuelve los códigos de recuperación (se muestran una sola vez). */
  async totpEnable(code: string): Promise<string[]> {
    const res = await client.post<{ data: { recovery_codes: string[] } }>('/me/totp/enable', { code });
    return res.data.data.recovery_codes;
  },

  async totpDisable(password: string): Promise<void> {
    await client.post('/me/totp/disable', { password });
  },

  // ───── Central de seguridad (administrador) ─────
  async settings(): Promise<SecuritySettings> {
    const res = await client.get<{ data: SecuritySettings }>('/security/settings');
    return res.data.data;
  },

  async saveSettings(input: { device_trust_mode: DeviceTrustMode; device_trust_days: number; enforce_from: string }): Promise<SecuritySettings> {
    const res = await client.put<{ data: SecuritySettings }>('/security/settings', input);
    return res.data.data;
  },

  async pendingApprovals(): Promise<PendingApproval[]> {
    const res = await client.get<{ data: PendingApproval[] }>('/security/approvals');
    return res.data.data ?? [];
  },

  async decideApproval(id: string, approve: boolean): Promise<void> {
    await client.post(`/security/approvals/${encodeURIComponent(id)}/${approve ? 'approve' : 'deny'}`);
  },

  async userDevices(userId: number): Promise<{ devices: MyDevice[]; totp: TotpStatus }> {
    const res = await client.get<{ data: MyDevice[]; totp: TotpStatus }>(`/security/users/${userId}/devices`);
    return { devices: res.data.data ?? [], totp: res.data.totp };
  },

  async revokeDevice(id: number): Promise<void> {
    await client.delete(`/security/devices/${id}`);
  },

  async resetUser(userId: number): Promise<void> {
    await client.post(`/security/users/${userId}/reset`);
  },

  /** Sesiones abiertas del propio usuario. */
  async mySessions(): Promise<MySession[]> {
    const res = await client.get<{ data: MySession[] }>('/me/sessions');
    return res.data.data ?? [];
  },

  /** Cierra la sesión en todos los demás equipos. */
  async revokeOtherSessions(): Promise<number> {
    const res = await client.post<{ data: { closed: number } }>('/me/sessions/revoke-others');
    return res.data.data.closed;
  },

  async revokeSession(id: string): Promise<void> {
    await client.delete(`/me/sessions/${id}`);
  },

  /** El usuario cambia su propia contraseña (exige la actual y cumplir la política). */
  async changePassword(current: string, next: string): Promise<void> {
    await client.post('/me/password', { current_password: current, new_password: next });
  },

  /** Bitácora de seguridad (solo con el permiso de verla). */
  async events(params: SecurityEventsParams = {}): Promise<SecurityEventsPage> {
    const res = await client.get<{ data: SecurityEventsPage }>('/security/events', { params });
    return res.data.data;
  },
};
