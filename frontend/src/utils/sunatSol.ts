/**
 * Acceso a SUNAT Operaciones en Línea (Clave SOL), SUNAFIL y Pagos con las credenciales de la empresa.
 *
 * El acceso directo lo genera el servidor (inicia sesión por detrás y entrega un enlace de un solo uso: ver
 * SunatAccessModal). Si falla, la pantalla muestra las claves SOL y manda a la pantalla de login de SUNAT para entrar a
 * mano; este archivo guarda los datos de cada destino, la limpieza de la sesión anterior y esas direcciones.
 */

const SUNAT_SOL_LANG = 'es-PE';

/** A dónde se entra con la clave SOL de la empresa. */
export type SunatAccessTarget = 'sunat' | 'pagos' | 'sunafil';

type SunatTargetConfig = {
  label: string;
  /** Imagen del botón (public/icons) y su ancho en px a 96 px de alto (reserva el espacio antes de cargar). */
  image: string;
  imageWidth: number;
  /** Cliente OAuth de SUNAT para ese destino (solo viaja en la ruta; no es secreto). */
  clientId: string;
  originalUrl: string;
  /** `state` idéntico al que usa la otra aplicación del estudio para ese botón. */
  state: string;
  /** Si el destino cuelga del Menú SOL (e-menu) hay que cerrar antes la sesión anterior del navegador. */
  menuSol: boolean;
};

export const SUNAT_TARGETS: Record<SunatAccessTarget, SunatTargetConfig> = {
  // Menú SOL tal como lo abre la otra aplicación (cabina). `state` = mapa serializado que dice a dónde volver tras el login.
  sunat: {
    label: 'SUNAT',
    image: '/icons/acceso-sunat.png',
    imageWidth: 319,
    clientId: '085b176d-2437-44cd-8c3e-e9a83b705921',
    originalUrl: 'https://e-menu.sunat.gob.pe/cl-ti-itmenucabina/AutenticaMenuInternet.htm',
    state:
      'rO0ABXNyABFqYXZhLnV0aWwuSGFzaE1hcAUH2sHDFmDRAwACRgAKbG9hZEZhY3RvckkACXRocmVzaG9sZHhwP0AAAAAAAAx3CAAAABAAAAADdAAEZXhlY3B0AAZwYXJhbXN0AFEqJiomL2NsLXRpLWl0bWVudWNhYmluYS9NZW51SW50ZXJuZXQuaHRtJjBlMWY4NDg5ZmVlYWJmOTMxNmI5ODUwNTYyMjA5MTE4ZjkxZTJjMmN0AANleGVweA==',
    menuSol: true,
  },
  // Pagos: plataforma de pagos y deudas del Menú SOL.
  pagos: {
    label: 'Pagos',
    image: '/icons/acceso-pagos.png',
    imageWidth: 315,
    clientId: '59d39217-c025-4de5-b342-393b0f4630ab',
    originalUrl: 'https://e-menu.sunat.gob.pe/cl-ti-itmenu2/AutenticaMenuInternetPlataforma.htm',
    state:
      'rO0ABXQA7HpIam90dXJFVVlqQlpNb2t3NE8xQUZiZFBYdG5qZlhKbzVRQ3k0TnBZZ0lWNWhBNDU4OTZWU2xUbU85V1pVa2gvQUU2N09OR1VPR0M2d2g1YTBmMkxlOGpZQWNiazcyVXkweEhkTU44QWQrNVJCYUJURkgvcHdPRkxGZkplSTN5dkFESjdBSXZXM2lZbkZOc2NwMWNsbWJ2c1pXeUJQVnNIOEdERklJZWFCd1AvRFFVTFcraGRoeGk0YTczVC9pS3Z0Vmd1WVBqODlJckN3LzViaE5LelBmcnNqcURTNHdNOVYvTitvYTVyVmM9',
    menuSol: true,
  },
  // SUNAFIL: casilla electrónica; entra con la misma clave SOL y no usa el Menú SOL (nada que cerrar antes).
  sunafil: {
    label: 'SUNAFIL',
    image: '/icons/acceso-sunafil.png',
    imageWidth: 341,
    clientId: 'b6474e23-8a3b-4153-b301-dafcc9646250',
    originalUrl: 'https://casillaelectronica.sunafil.gob.pe/si.inbox/Login/Empresa',
    state: 's',
    menuSol: false,
  },
};

export type SunatSolCredentials = {
  ruc?: string | null;
  usuario?: string | null;
  clave?: string | null;
};

/** Qué falta para poder ingresar ('' si está todo). */
export function sunatSolMissingField(c: SunatSolCredentials): string {
  if (!(c.ruc ?? '').trim()) return 'RUC';
  if (!(c.usuario ?? '').trim()) return 'usuario SOL';
  if (!(c.clave ?? '').trim()) return 'clave SOL';
  return '';
}

/**
 * Limpieza de la sesión anterior de SUNAT en este navegador.
 *
 * SUNAT guarda UNA sesión de Menú SOL por navegador: si hay otra empresa abierta, el nuevo acceso dice
 * "ya hay una sesión abierta". El botón "Salir" de SUNAT ejecuta `unLoad()`, que hace
 * POST MenuInternet.htm {action:"salir", pestana:"null", agrupacion:"null"} (más borrar unas cookies
 * propias). Desde otro sitio no se puede borrar cookies de sunat.gob.pe, pero sí navegar una pestaña a
 * esa misma dirección con los mismos parámetros (navegación de primer nivel: lleva las cookies de
 * SUNAT) y luego continuar al acceso nuevo.
 */
export const SUNAT_MENU_LOGOUT_URL =
  'https://e-menu.sunat.gob.pe/cl-ti-itmenu/MenuInternet.htm?action=salir&pestana=null&agrupacion=null';
/** Tiempo que se deja a SUNAT para procesar el cierre antes de entrar a la nueva empresa. Siempre se limpia antes de entrar: no hay forma fiable de saber si hay otra sesión abierta (puede venir de otra pestaña, otro día o de fuera de ZContable) y SUNAT bloquea el ingreso si existe. */
export const SUNAT_CLEANUP_WAIT_MS = 1200;

/** Abre una pestaña nueva que ya navega al cierre de sesión de SUNAT. Debe llamarse desde un clic. */
function openCleanupWindow(): Window | null {
  // OJO: no se le quita el opener (`w.opener = null`). Sin ese vínculo el navegador no deja redirigir
  // después esta misma pestaña al acceso nuevo (falla y obliga a abrir una segunda pestaña).
  const w = window.open('about:blank', '_blank');
  if (!w) return null;
  w.location.href = SUNAT_MENU_LOGOUT_URL;
  return w;
}

/** Entra con el enlace de un solo uso; en los destinos del Menú SOL cierra antes la sesión anterior de este navegador. */
export function openSunatAccessUrl(url: string, target: SunatAccessTarget = 'sunat'): void {
  if (!SUNAT_TARGETS[target].menuSol) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  const w = openCleanupWindow();
  if (!w) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  window.setTimeout(() => {
    try {
      w.location.href = url;
    } catch {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }, SUNAT_CLEANUP_WAIT_MS);
}

/** Dirección de la pantalla de login de SUNAT (Clave SOL) del destino: ahí se inicia sesión a mano con las claves de la empresa. */
export function sunatLoginPageUrl(target: SunatAccessTarget = 'sunat'): string {
  const t = SUNAT_TARGETS[target];
  const q = new URLSearchParams({ lang: SUNAT_SOL_LANG, showDni: 'true', showLanguages: 'false', originalUrl: t.originalUrl, state: t.state });
  return `https://api-seguridad.sunat.gob.pe/v1/clientessol/${t.clientId}/oauth2/loginMenuSol?${q.toString()}`;
}

/** Abre el login de SUNAT en una pestaña nueva; en el Menú SOL cierra antes la sesión anterior de este navegador. Debe llamarse desde un clic. */
export function openSunatLoginPage(target: SunatAccessTarget = 'sunat'): void {
  openSunatAccessUrl(sunatLoginPageUrl(target), target);
}

/**
 * Qué hacer cuando el acceso directo falla:
 * - `retry`: se puede reintentar (todavía quedan intentos automáticos);
 * - `manual`: ya no conviene insistir (SUNAT rechazó la clave, pide captcha o bloqueó, o se agotaron los intentos):
 *   se muestran las claves SOL para iniciar sesión a mano en SUNAT;
 * - `none`: falta un dato o el permiso; no hay nada que reintentar ni claves que mostrar.
 * El servidor es quien cuenta los intentos (uno menos que el límite de SUNAT) y los informa en `attempts_left`.
 */
export type SunatAccessFallback = 'retry' | 'manual' | 'none';

const MANUAL_NOW_CODES = new Set(['credenciales_rechazadas', 'credenciales_en_pausa', 'captcha', 'autenticacion_bloqueada', 'intentos_agotados']);
const NO_FALLBACK_CODES = new Set(['faltan_datos', 'sin_acceso']);

export function sunatAccessFallback(error: { code?: string; attempts_left?: number }): SunatAccessFallback {
  const code = error.code ?? '';
  if (NO_FALLBACK_CODES.has(code)) return 'none';
  if (MANUAL_NOW_CODES.has(code)) return 'manual';
  if (code === 'en_curso') return 'retry'; // ya hay una generación en marcha: esperar y reintentar no gasta intentos
  return (error.attempts_left ?? 1) > 0 ? 'retry' : 'manual';
}
