/**
 * Ingreso automático a SUNAT Operaciones en Línea (Clave SOL) con las credenciales de la empresa.
 *
 * Cómo funciona: la página de login de SUNAT (api-seguridad.sunat.gob.pe …/oauth2/loginMenuSol) arma por
 * JavaScript un formulario oculto y lo envía por POST a `j_security_check`; acá se envía ese MISMO
 * formulario directo, en una pestaña nueva, con los datos ya puestos — SUNAT autentica y redirige al
 * Menú SOL. Las credenciales viajan por POST a SUNAT (https), nunca van en la URL, y el formulario
 * se elimina del DOM apenas se envía.
 *
 * Campos que SUNAT espera (copiados de su login): tipo=2 (RUC), custom_ruc=<RUC>, j_username=<usuario
 * SOL>, j_password=<clave SOL>, dni vacío, captcha vacío (solo lo pide tras 3 intentos fallidos),
 * originalUrl/lang/state fijos de cada destino (SUNAT, Pagos, SUNAFIL; ver SUNAT_TARGETS).
 */

const SUNAT_SOL_LANG = 'es-PE';

/** A dónde se entra con la clave SOL de la empresa. */
export type SunatAccessTarget = 'sunat' | 'pagos' | 'sunafil';

type SunatTargetConfig = {
  label: string;
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
    clientId: '085b176d-2437-44cd-8c3e-e9a83b705921',
    originalUrl: 'https://e-menu.sunat.gob.pe/cl-ti-itmenucabina/AutenticaMenuInternet.htm',
    state:
      'rO0ABXNyABFqYXZhLnV0aWwuSGFzaE1hcAUH2sHDFmDRAwACRgAKbG9hZEZhY3RvckkACXRocmVzaG9sZHhwP0AAAAAAAAx3CAAAABAAAAADdAAEZXhlY3B0AAZwYXJhbXN0AFEqJiomL2NsLXRpLWl0bWVudWNhYmluYS9NZW51SW50ZXJuZXQuaHRtJjBlMWY4NDg5ZmVlYWJmOTMxNmI5ODUwNTYyMjA5MTE4ZjkxZTJjMmN0AANleGVweA==',
    menuSol: true,
  },
  // Pagos: plataforma de pagos y deudas del Menú SOL.
  pagos: {
    label: 'Pagos',
    clientId: '59d39217-c025-4de5-b342-393b0f4630ab',
    originalUrl: 'https://e-menu.sunat.gob.pe/cl-ti-itmenu2/AutenticaMenuInternetPlataforma.htm',
    state:
      'rO0ABXQA7HpIam90dXJFVVlqQlpNb2t3NE8xQUZiZFBYdG5qZlhKbzVRQ3k0TnBZZ0lWNWhBNDU4OTZWU2xUbU85V1pVa2gvQUU2N09OR1VPR0M2d2g1YTBmMkxlOGpZQWNiazcyVXkweEhkTU44QWQrNVJCYUJURkgvcHdPRkxGZkplSTN5dkFESjdBSXZXM2lZbkZOc2NwMWNsbWJ2c1pXeUJQVnNIOEdERklJZWFCd1AvRFFVTFcraGRoeGk0YTczVC9pS3Z0Vmd1WVBqODlJckN3LzViaE5LelBmcnNqcURTNHdNOVYvTitvYTVyVmM9',
    menuSol: true,
  },
  // SUNAFIL: casilla electrónica; entra con la misma clave SOL y no usa el Menú SOL (nada que cerrar antes).
  sunafil: {
    label: 'SUNAFIL',
    clientId: 'b6474e23-8a3b-4153-b301-dafcc9646250',
    originalUrl: 'https://casillaelectronica.sunafil.gob.pe/si.inbox/Login/Empresa',
    state: 's',
    menuSol: false,
  },
};

function loginAction(t: SunatTargetConfig): string {
  return `https://api-seguridad.sunat.gob.pe/v1/clientessol/${t.clientId}/oauth2/j_security_check`;
}

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

function submitSunatSolForm(c: SunatSolCredentials, target: SunatAccessTarget): void {
  const cfg = SUNAT_TARGETS[target];
  const fields: Record<string, string> = {
    tipo: '2',
    dni: '',
    custom_ruc: (c.ruc ?? '').trim(),
    j_username: (c.usuario ?? '').trim(),
    j_password: c.clave ?? '',
    captcha: '',
    originalUrl: cfg.originalUrl,
    lang: SUNAT_SOL_LANG,
    state: cfg.state,
  };

  const form = document.createElement('form');
  form.method = 'POST';
  form.action = loginAction(cfg);
  form.target = '_blank';
  form.rel = 'noopener noreferrer';
  form.style.display = 'none';
  form.autocomplete = 'off';
  for (const [name, value] of Object.entries(fields)) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  try {
    form.submit();
  } finally {
    form.remove();
  }
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

/** Abre el destino en una pestaña nueva ya autenticada, con el formulario de login. En el Menú SOL cierra antes la sesión anterior. Debe llamarse desde un clic. */
export function openSunatSolLogin(c: SunatSolCredentials, target: SunatAccessTarget = 'sunat'): void {
  if (!SUNAT_TARGETS[target].menuSol) {
    submitSunatSolForm(c, target);
    return;
  }
  const w = openCleanupWindow();
  if (!w) {
    submitSunatSolForm(c, target);
    return;
  }
  window.setTimeout(() => {
    try {
      w.close();
    } catch {
      /* ya cerrada */
    }
    submitSunatSolForm(c, target);
  }, SUNAT_CLEANUP_WAIT_MS);
}
