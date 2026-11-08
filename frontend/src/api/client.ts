import axios from 'axios';
import { clearTukifacSeriesSessionCache } from '../constants/tukifacSeriesSessionKeys';
import { isUserActive } from '../utils/activity';

const backendUrl = (import.meta.env.VITE_BACKEND_URL ?? '').replace(/\/+$/, '');

if (import.meta.env.PROD && !backendUrl) {
  // Sin VITE_BACKEND_URL en `npm run build`, Axios usa `/api` relativo al host del front (SPA en CDN/subdominio distinto al API → login a dominio equivocado, 405, etc.).
  console.error(
    '[miweb] VITE_BACKEND_URL no estaba definido en el build. Las peticiones van a este mismo origen + /api. ' +
      'Reconstruye el front con VITE_BACKEND_URL=https://tu-dominio-del-api (sin /api final).',
  );
}

const client = axios.create({
  baseURL: backendUrl ? `${backendUrl}/api` : '/api',
});

export function resolveBackendUrl(url: string): string {
  const value = (url ?? '').trim();
  if (!value) return value;
  if (value.startsWith('http://') || value.startsWith('https://') || value.startsWith('data:')) return value;
  if (!backendUrl) return value;
  if (value.startsWith('/')) return `${backendUrl}${value}`;
  return `${backendUrl}/${value}`;
}

client.interceptors.request.use((config) => {
  let token = null as string | null;
  try {
    token = window.sessionStorage.getItem('token');
    if (!token) {
      const legacyToken = window.localStorage.getItem('token');
      if (legacyToken) {
        window.sessionStorage.setItem('token', legacyToken);
        window.localStorage.removeItem('token');
        const legacyUser = window.localStorage.getItem('user');
        if (legacyUser) {
          window.sessionStorage.setItem('user', legacyUser);
          window.localStorage.removeItem('user');
        }
        token = legacyToken;
      }
    }
  } catch {
    token = null;
  }
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  // Solo el uso real de la persona mantiene viva la sesión (lo que la pantalla hace sola no cuenta).
  if (isUserActive()) {
    config.headers['X-Client-Active'] = '1';
  }
  return config;
});

client.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    const code = error?.response?.data?.code as string | undefined;
    // La contraseña la puso un administrador: hay que cambiarla antes de seguir (la pantalla «Mi cuenta» lo permite).
    if (status === 403 && code === 'password_change_required') {
      try {
        window.sessionStorage.setItem('must_change_password', '1');
      } catch {
        /* sin almacenamiento */
      }
      if (window.location.pathname !== '/profile') window.location.href = '/profile';
      return Promise.reject(error);
    }
    if (status === 401) {
      // Si la sesión se cerró (inactividad, otro equipo, administrador…), el login explica por qué.
      if (code && code.startsWith('session_')) {
        try {
          window.sessionStorage.setItem('login_notice', String(error?.response?.data?.error ?? 'Su sesión se cerró. Inicie sesión de nuevo.'));
        } catch {
          /* sin almacenamiento */
        }
      }
      clearTukifacSeriesSessionCache();
      try {
        window.sessionStorage.removeItem('token');
        window.sessionStorage.removeItem('user');
        window.sessionStorage.removeItem('permissions');
      } catch {
        return Promise.reject(error);
      }
      try {
        window.localStorage.removeItem('token');
        window.localStorage.removeItem('user');
        window.localStorage.removeItem('permissions');
      } catch {
        return Promise.reject(error);
      }
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  },
);

export default client;
