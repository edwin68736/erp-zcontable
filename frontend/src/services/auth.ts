import { clearTukifacSeriesSessionCache } from '../constants/tukifacSeriesSessionKeys';
import client from '../api/client';

export interface AuthUser {
  id: number;
  name: string;
  username: string;
  email?: string;
}

export interface LoginResponse {
  token: string;
  user?: AuthUser;
}

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
  async login(username: string, password: string): Promise<LoginResponse> {
    const res = await client.post<LoginResponse>('/login', { username, password });
    const token = res.data?.token;
    if (!token) {
      throw new Error('Respuesta inválida del servidor');
    }

    clearTukifacSeriesSessionCache();

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

  async logout(): Promise<void> {
    try {
      await client.get('/logout');
    } finally {
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
