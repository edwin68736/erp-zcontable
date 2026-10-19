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
 * originalUrl/lang/state fijos del Menú SOL.
 */

const SUNAT_SOL_CLIENT_ID = '4f3b88b3-d9d6-402a-b85d-6a0bc857746a';
const SUNAT_SOL_LOGIN_ACTION = `https://api-seguridad.sunat.gob.pe/v1/clientessol/${SUNAT_SOL_CLIENT_ID}/oauth2/j_security_check`;
const SUNAT_SOL_ORIGINAL_URL = 'https://e-menu.sunat.gob.pe/cl-ti-itmenu/AutenticaMenuInternet.htm';
const SUNAT_SOL_LANG = 'es-PE';
/** `state` del Menú SOL (mapa serializado que identifica a dónde volver tras el login). */
const SUNAT_SOL_STATE =
  'rO0ABXNyABFqYXZhLnV0aWwuSGFzaE1hcAUH2sHDFmDRAwACRgAKbG9hZEZhY3RvckkACXRocmVzaG9sZHhwP0AAAAAAAAx3CAAAABAAAAADdAADZXhlcHQABnBhcmFtc3QASyomKiYvY2wtdGktaXRtZW51L01lbnVJbnRlcm5ldC5odG0mYjY0ZDI2YThiNWFmMDkxOTIzYjIzYjY0MDdhMWMxZGI0MWU3MzNhNnQABGV4ZWNweA==';

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

function submitSunatSolForm(c: SunatSolCredentials): void {
  const fields: Record<string, string> = {
    tipo: '2',
    dni: '',
    custom_ruc: (c.ruc ?? '').trim(),
    j_username: (c.usuario ?? '').trim(),
    j_password: c.clave ?? '',
    captcha: '',
    originalUrl: SUNAT_SOL_ORIGINAL_URL,
    lang: SUNAT_SOL_LANG,
    state: SUNAT_SOL_STATE,
  };

  const form = document.createElement('form');
  form.method = 'POST';
  form.action = SUNAT_SOL_LOGIN_ACTION;
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

/** Entra a SUNAT con el enlace de un solo uso, cerrando antes la sesión anterior de este navegador. */
export function openSunatAccessUrl(url: string): void {
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

/** Abre SUNAT en una pestaña nueva ya autenticada, con el formulario de login. Cierra antes la sesión anterior. Debe llamarse desde un clic. */
export function openSunatSolLogin(c: SunatSolCredentials): void {
  const w = openCleanupWindow();
  if (!w) {
    submitSunatSolForm(c);
    return;
  }
  window.setTimeout(() => {
    try {
      w.close();
    } catch {
      /* ya cerrada */
    }
    submitSunatSolForm(c);
  }, SUNAT_CLEANUP_WAIT_MS);
}
