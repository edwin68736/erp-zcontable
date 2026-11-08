import client from '../api/client';

/** Tipos de evento de la bitácora de seguridad. */
export type SecurityEventType = 'login_ok' | 'login_fail' | 'login_blocked' | 'password_change' | 'password_change_fail' | 'password_reset';

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

export const securityService = {
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
