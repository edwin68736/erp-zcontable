import { clearTukifacSeriesSessionCache } from '../constants/tukifacSeriesSessionKeys';
import client from '../api/client';

export interface AuthUser {
  id: number;
  name: string;
  username: string;
  email?: string;
  role?: string;
}

export interface LoginResponse {
  token: string;
  user?: AuthUser;
}

const TOKEN_KEY = 'token';
const USER_KEY = 'user';

type JwtClaims = {
  user_id?: number;
  username?: string;
  email?: string;
  name?: string;
  role?: string;
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
      ? { ...res.data.user, role: claims?.role }
      : claims?.username
        ? {
            id: claims.user_id ?? 0,
            name: claims.name ?? '',
            username: claims.username,
            email: claims.email || undefined,
            role: claims.role,
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
      } catch {
        return res.data;
      }
      try {
        window.localStorage.removeItem(USER_KEY);
      } catch {
        return res.data;
      }
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
      } catch {
        return;
      }
      try {
        window.localStorage.removeItem(TOKEN_KEY);
        window.localStorage.removeItem(USER_KEY);
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
    } catch {
      return;
    }
    try {
      window.localStorage.removeItem(TOKEN_KEY);
      window.localStorage.removeItem(USER_KEY);
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

  getRole(): string | null {
    const token = this.getToken();
    if (token) {
      const claims = parseJwtClaims(token);
      if (claims?.role) return claims.role;
    }
    return this.getUser()?.role ?? null;
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
      const user = JSON.parse(raw) as AuthUser;
      if (user.role) return user;

      const token = this.getToken();
      if (!token) return user;

      const claims = parseJwtClaims(token);
      if (!claims?.role) return user;

      const merged = { ...user, role: claims.role };
      try {
        window.sessionStorage.setItem(USER_KEY, JSON.stringify(merged));
      } catch {
        window.localStorage.setItem(USER_KEY, JSON.stringify(merged));
      }
      return merged;
    } catch {
      return null;
    }
  },
};
