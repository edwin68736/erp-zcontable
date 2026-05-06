import axios from 'axios';
import { clearTukifacSeriesSessionCache } from '../constants/tukifacSeriesSessionKeys';

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
  return config;
});

client.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    if (status === 401) {
      clearTukifacSeriesSessionCache();
      try {
        window.sessionStorage.removeItem('token');
        window.sessionStorage.removeItem('user');
      } catch {
        return Promise.reject(error);
      }
      try {
        window.localStorage.removeItem('token');
        window.localStorage.removeItem('user');
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
