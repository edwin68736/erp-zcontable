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

/** Abre SUNAT en una pestaña nueva ya autenticada. Debe llamarse desde un clic (si no, el navegador bloquea la pestaña). */
export function openSunatSolLogin(c: SunatSolCredentials): void {
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
