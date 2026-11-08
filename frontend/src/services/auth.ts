import { clearTukifacSeriesSessionCache } from '../constants/tukifacSeriesSessionKeys';
import client from '../api/client';
import { getDeviceToken } from '../utils/device';

export interface AuthUser {
  id: number;
  name: string;
  username: string;
  email?: string;
}

export interface LoginResponse {
  token: string;
  user?: AuthUser;
  /** La contraseña la puso un administrador: debe cambiarla antes de seguir. */
  must_change_password?: boolean;
}

/** El equipo es nuevo: falta verificar (código de la app o aprobación de un administrador) antes de dar la sesión. */
export interface LoginChallenge {
  status: 'verification_required';
  challenge_id: string;
  device_label: string;
  expires_at: string;
  methods: { totp: boolean; approval: boolean };
}

export function isLoginChallenge(r: LoginResponse | LoginChallenge): r is LoginChallenge {
  return (r as LoginChallenge).status === 'verification_required';
}

export type ChallengeStatus = 'pendiente' | 'aprobada' | 'rechazada' | 'usada' | 'vencida';

const MUST_CHANGE_KEY = 'must_change_password';

const TOKEN_KEY = 'token';
const USER_KEY = 'user';
const PERMISSIONS_KEY = 'permissions';

type JwtClaims = {
  user_id?: number;
  username?: string;
  email?: string;
  name?: string;
};

function parseJwtClaims(token: string): JwtClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    let base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4 !== 0) base64 += '=';
    const payloadJson = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => `%${`00${c.charCodeAt(0).toString(16)}`.slice(-2)}`)
        .join(''),
    );
    return JSON.parse(payloadJson) as JwtClaims;
  } catch {
    return null;
  }
}

function migrateLegacyLocalStorageToSessionStorage(): void {
  try {
    const sessionToken = window.sessionStorage.getItem(TOKEN_KEY);
    if (sessionToken) return;

    const legacyToken = window.localStorage.getItem(TOKEN_KEY);
    if (!legacyToken) return;

    window.sessionStorage.setItem(TOKEN_KEY, legacyToken);
    window.localStorage.removeItem(TOKEN_KEY);

    const legacyUser = window.localStorage.getItem(USER_KEY);
    if (legacyUser) {
      window.sessionStorage.setItem(USER_KEY, legacyUser);
      window.localStorage.removeItem(USER_KEY);
    }
  } catch {
    return;
  }
}

export const auth = {
  /**
   * Inicia sesión. Si el equipo es nuevo y el estudio lo exige, devuelve un desafío (HTTP 202) en vez de la sesión:
   * hay que terminarlo con `verifyCode` o con `requestApproval` + `completeApproved`.
   * `remember` = «confiar en este equipo» (por defecto sí).
   */
  async login(username: string, password: string, remember = true): Promise<LoginResponse | LoginChallenge> {
    const res = await client.post<LoginResponse | LoginChallenge>('/login', {
      username,
      password,
      device_token: getDeviceToken(username),
      remember,
    });
    if (isLoginChallenge(res.data)) return res.data;
    return auth.storeSession(res.data);
  },

  /** Termina el inicio de sesión con el código de la app (o uno de recuperación). */
  async verifyCode(username: string, challengeId: string, code: string): Promise<LoginResponse> {
    const res = await client.post<LoginResponse>('/login/verify', {
      challenge_id: challengeId,
      code,
      device_token: getDeviceToken(username),
    });
    return auth.storeSession(res.data);
  },

  /** Pide a un administrador que apruebe este equipo. */
  async requestApproval(challengeId: string): Promise<ChallengeStatus> {
    const res = await client.post<{ status: ChallengeStatus }>('/login/approval', { challenge_id: challengeId });
    return res.data.status;
  },

  async challengeStatus(challengeId: string): Promise<ChallengeStatus> {
    const res = await client.get<{ status: ChallengeStatus }>(`/login/challenge/${encodeURIComponent(challengeId)}`);
    return res.data.status;
  },

  /** Tras la aprobación del administrador, la persona termina de entrar. */
  async completeApproved(username: string, challengeId: string): Promise<LoginResponse> {
    const res = await client.post<LoginResponse>('/login/complete', { challenge_id: challengeId, device_token: getDeviceToken(username) });
    return auth.storeSession(res.data);
  },

  /** Guarda la sesión recibida (token, usuario, permisos). */
  async storeSession(data: LoginResponse): Promise<LoginResponse> {
    const res = { data };
    const token = res.data?.token;
    if (!token) {
      throw new Error('Respuesta inválida del servidor');
    }

    clearTukifacSeriesSessionCache();

    try {
      if (res.data.must_change_password) window.sessionStorage.setItem(MUST_CHANGE_KEY, '1');
      else window.sessionStorage.removeItem(MUST_CHANGE_KEY);
    } catch {
      /* sin almacenamiento */
    }

    try {
      window.sessionStorage.setItem(TOKEN_KEY, token);
      window.localStorage.removeItem(TOKEN_KEY);
    } catch {
      window.localStorage.setItem(TOKEN_KEY, token);
    }
    const claims = parseJwtClaims(token);
    const mergedUser: AuthUser | null = res.data.user
      ? { ...res.data.user }
      : claims?.username
        ? {
            id: claims.user_id ?? 0,
            name: claims.name ?? '',
            username: claims.username,
            email: claims.email || undefined,
          }
        : null;

    if (mergedUser) {
      try {
        window.sessionStorage.setItem(USER_KEY, JSON.stringify(mergedUser));
        window.localStorage.removeItem(USER_KEY);
      } catch {
        window.localStorage.setItem(USER_KEY, JSON.stringify(mergedUser));
      }
    } else {
      try {
        window.sessionStorage.removeItem(USER_KEY);
        window.sessionStorage.removeItem(PERMISSIONS_KEY);
      } catch {
        return res.data;
      }
      try {
        window.localStorage.removeItem(USER_KEY);
        window.localStorage.removeItem(PERMISSIONS_KEY);
      } catch {
        return res.data;
      }
    }

    try {
      await auth.refreshPermissions();
    } catch {
      /* permisos se reintentan desde Layout */
    }

    return res.data;
  },

  /** ¿Debe cambiar su contraseña antes de usar el sistema? */
  mustChangePassword(): boolean {
    try {
      return window.sessionStorage.getItem(MUST_CHANGE_KEY) === '1';
    } catch {
      return false;
    }
  },

  clearMustChangePassword(): void {
    try {
      window.sessionStorage.removeItem(MUST_CHANGE_KEY);
    } catch {
      /* sin almacenamiento */
    }
  },

  async logout(): Promise<void> {
    try {
      await client.get('/logout');
    } finally {
      clearTukifacSeriesSessionCache();
      try {
        window.sessionStorage.removeItem(MUST_CHANGE_KEY);
      } catch {
        /* sin almacenamiento */
      }
      try {
        window.sessionStorage.removeItem(TOKEN_KEY);
        window.sessionStorage.removeItem(USER_KEY);
        window.sessionStorage.removeItem(PERMISSIONS_KEY);
      } catch {
        return;
      }
      try {
        window.localStorage.removeItem(TOKEN_KEY);
        window.localStorage.removeItem(USER_KEY);
        window.localStorage.removeItem(PERMISSIONS_KEY);
      } catch {
        return;
      }
    }
  },

  clear(): void {
    clearTukifacSeriesSessionCache();
    try {
      window.sessionStorage.removeItem(TOKEN_KEY);
      window.sessionStorage.removeItem(USER_KEY);
      window.sessionStorage.removeItem(PERMISSIONS_KEY);
    } catch {
      return;
    }
    try {
      window.localStorage.removeItem(TOKEN_KEY);
      window.localStorage.removeItem(USER_KEY);
      window.localStorage.removeItem(PERMISSIONS_KEY);
    } catch {
      return;
    }
  },

  getToken(): string | null {
    migrateLegacyLocalStorageToSessionStorage();
    try {
      return window.sessionStorage.getItem(TOKEN_KEY);
    } catch {
      return window.localStorage.getItem(TOKEN_KEY);
    }
  },

  hasStoredPermissions(): boolean {
    try {
      const raw = window.sessionStorage.getItem(PERMISSIONS_KEY);
      if (!raw) return false;
      const arr = JSON.parse(raw) as string[];
      return Array.isArray(arr) && arr.length > 0;
    } catch {
      return false;
    }
  },

  getPermissionCodes(): string[] {
    let raw: string | null = null;
    try {
      raw = window.sessionStorage.getItem(PERMISSIONS_KEY);
    } catch {
      raw = window.localStorage.getItem(PERMISSIONS_KEY);
    }
    if (!raw) return [];
    try {
      const arr = JSON.parse(raw) as string[];
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  },

  /** true si el usuario tiene al menos un permiso del módulo RBAC (prefijo module.). */
  hasAnyPermissionInModule(moduleCode: string): boolean {
    const mod = (moduleCode ?? '').trim();
    if (!mod) return false;
    const prefix = `${mod}.`;
    return this.getPermissionCodes().some((c) => c.startsWith(prefix));
  },

  async refreshPermissions(): Promise<void> {
    if (!this.getToken()) return;
    const res = await client.get<{ success?: boolean; data?: string[] }>('/me/permissions');
    const list = res.data?.data ?? [];
    const json = JSON.stringify(list);
    try {
      window.sessionStorage.setItem(PERMISSIONS_KEY, json);
      window.localStorage.removeItem(PERMISSIONS_KEY);
    } catch {
      window.localStorage.setItem(PERMISSIONS_KEY, json);
    }
    window.dispatchEvent(new CustomEvent('miweb:permissions-updated'));
  },

  /** Comprueba permiso module.action (lista desde /me/permissions). */
  hasPermission(code: string): boolean {
    if (!code) return true;
    let raw: string | null = null;
    try {
      raw = window.sessionStorage.getItem(PERMISSIONS_KEY);
    } catch {
      raw = window.localStorage.getItem(PERMISSIONS_KEY);
    }
    if (!raw) return false;
    try {
      const arr = JSON.parse(raw) as string[];
      const set = new Set(arr);
      return set.has(code);
    } catch {
      return false;
    }
  },

  hasAnyPermission(...codes: string[]): boolean {
    return codes.some((c) => c && this.hasPermission(c));
  },

  hasAllPermissions(...codes: string[]): boolean {
    return codes.every((c) => !c || this.hasPermission(c));
  },

  getUser(): AuthUser | null {
    migrateLegacyLocalStorageToSessionStorage();
    let raw: string | null = null;
    try {
      raw = window.sessionStorage.getItem(USER_KEY);
    } catch {
      raw = window.localStorage.getItem(USER_KEY);
    }
    if (!raw) return null;
    try {
      return JSON.parse(raw) as AuthUser;
    } catch {
      return null;
    }
  },
};
