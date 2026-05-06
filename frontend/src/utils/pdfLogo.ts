import axios from 'axios';
import { resolveBackendUrl } from '../api/client';

function authHeader(): Record<string, string> {
  const h: Record<string, string> = {};
  try {
    if (typeof window === 'undefined') return h;
    const t = window.sessionStorage.getItem('token') || window.localStorage.getItem('token');
    if (t) h.Authorization = `Bearer ${t}`;
  } catch {
    /* ignore */
  }
  return h;
}

const MAX_PDF_RASTER = 1024;

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), 'image/png', 0.92);
  });
}

/**
 * Convierte cualquier imagen decodificable por el navegador a PNG (estándar 8 bit),
 * que **pdf-lib** suele aceptar siempre, aunque falle `embedPng` sobre el PNG original
 * (p. ej. gAMA raro, interlazado, CMYK en JPEG, etc.).
 */
export async function rasterizeImageBlobToPngForPdf(input: Blob): Promise<Blob | null> {
  if (typeof document === 'undefined' || !input || input.size === 0) return null;

  const drawToPng = async (src: CanvasImageSource, sw: number, sh: number) => {
    const maxSide = MAX_PDF_RASTER;
    let w = sw || 1;
    let h = sh || 1;
    if (w > maxSide) {
      h = Math.max(1, Math.round((h * maxSide) / w));
      w = maxSide;
    }
    if (h > maxSide) {
      w = Math.max(1, Math.round((w * maxSide) / h));
      h = maxSide;
    }
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    try {
      ctx.drawImage(src, 0, 0, w, h);
    } catch {
      return null;
    }
    return canvasToPngBlob(canvas);
  };

  try {
    if (typeof createImageBitmap === 'function') {
      const bmp = await createImageBitmap(input);
      try {
        return await drawToPng(bmp, bmp.width, bmp.height);
      } finally {
        try {
          bmp.close();
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* seguir con Image + objectURL */
  }

  const u = URL.createObjectURL(input);
  const out = await rasterizeImageToPngBlob(u, u);
  return out;
}

/**
 * Dibuja cualquier imagen decodificable (data URL, blob: o http(s) con CORS) y devuelve un PNG
 * en Blob. @react-pdf/image en navegador falla a menudo con `data:...;base64` (charset,
 * application/octet-stream, etc.); con Blob+magic bytes el pipeline es fiable.
 */
function rasterizeImageToPngBlob(sourceForImg: string, revokeObjectUrlAfter?: string): Promise<Blob | null> {
  if (typeof Image === 'undefined' || typeof document === 'undefined') {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      if (revokeObjectUrlAfter) {
        try {
          URL.revokeObjectURL(revokeObjectUrlAfter);
        } catch {
          /* ignore */
        }
      }
      void (async () => {
        try {
          const maxSide = MAX_PDF_RASTER;
          let w = img.naturalWidth || 256;
          let h = img.naturalHeight || 256;
          if (w > maxSide) {
            h = Math.max(1, Math.round((h * maxSide) / w));
            w = maxSide;
          }
          if (h > maxSide) {
            w = Math.max(1, Math.round((w * maxSide) / h));
            h = maxSide;
          }
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(null);
            return;
          }
          ctx.drawImage(img, 0, 0, w, h);
          resolve(await canvasToPngBlob(canvas));
        } catch {
          resolve(null);
        }
      })();
    };
    img.onerror = () => {
      if (revokeObjectUrlAfter) {
        try {
          URL.revokeObjectURL(revokeObjectUrlAfter);
        } catch {
          /* ignore */
        }
      }
      resolve(null);
    };
    img.src = sourceForImg;
  });
}

/** URL lista para fetch (misma lógica que API + origen actual si la ruta es relativa). */
function resolveLogoFetchUrl(logoPath: string): string {
  let resolved = resolveBackendUrl(logoPath);
  if (resolved.startsWith('data:') || resolved.startsWith('http://') || resolved.startsWith('https://')) {
    return resolved;
  }
  if (typeof window !== 'undefined') {
    const path = resolved.startsWith('/') ? resolved : `/${resolved}`;
    return `${window.location.origin}${path}`;
  }
  return resolved;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const FETCH_RETRIES = 3;

/**
 * Descarga con reintentos (errores de red / 5xx) y `cache: 'no-store'` para no quedarse
 * con una respuesta HTML o vacía en caché.
 */
async function fetchAsBlob(resolved: string): Promise<Blob | null> {
  const headers = authHeader();

  for (let attempt = 0; attempt < FETCH_RETRIES; attempt++) {
    let blob: Blob | null = null;

    try {
      const res = await fetch(resolved, { headers, mode: 'cors', cache: 'no-store' });
      if (res.ok) {
        blob = await res.blob();
      }
    } catch {
      /* intento con axios */
    }

    if (!blob || blob.size === 0) {
      try {
        const r = await axios.get(resolved, {
          responseType: 'arraybuffer',
          headers,
          validateStatus: (s) => s >= 200 && s < 400,
        });
        if (r.data && r.data.byteLength > 0) {
          blob = new Blob([r.data]);
        }
      } catch {
        /* siguiente intento */
      }
    }

    if (blob && blob.size > 0) {
      return blob;
    }
    if (attempt < FETCH_RETRIES - 1) {
      await sleep(200 * (attempt + 1));
    }
  }
  return null;
}

/**
 * Carga un recurso de imagen y devuelve un **Blob PNG** listo para `<Image src={...} />` de @react-pdf.
 * Prioriza un pipeline de canvas → PNG; evita data URLs hacia @react-pdf.
 */
function isPngSignature(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  );
}

function isJpegSignature(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

/**
 * Carga un Blob listo para **pdf-lib** (`embedPng` / `embedJpg`): si el servidor entrega
 * PNG o JPEG, se reenvían esos bytes sin canvas (más fiable y más rápido). Si el formato
 * hace falta (p. ej. WebP, SVG) se rasteriza a PNG como con `loadLogoPngBlobForPdf`.
 *
 * **Dónde vive el logo del estudio:** en `FirmConfig.logo_url` (Ajustes → subida vía
 * `configService.uploadFirmLogo`). El backend devuelve una ruta o URL; en pantalla se
 * usa `resolveBackendUrl(logo_url)` en un `<img>`. En el PDF se usa la **misma** ruta con
 * `fetch` + cabecera `Authorization: Bearer` (`fetchAsBlob` / `resolveLogoFetchUrl`) para
 * obtener los bytes que luego se pasan a `embedPng`/`embedJpg` (ver demo en
 * https://pdf-lib.js.org/ ).
 */
export async function loadImageBlobForPdf(logoUrl: string | undefined | null): Promise<Blob | null> {
  const url = (logoUrl ?? '').trim();
  if (!url) return null;
  if (url.startsWith('data:') || (typeof window !== 'undefined' && url.startsWith('blob:'))) {
    return loadLogoPngBlobForPdf(url);
  }
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return null;
  }

  const resolved = resolveLogoFetchUrl(url);
  if (resolved.startsWith('data:') || resolved.startsWith('blob:')) {
    return loadLogoPngBlobForPdf(resolved);
  }

  const raw = await fetchAsBlob(resolved);
  if (!raw || raw.size === 0) return null;
  const u8 = new Uint8Array(await raw.arrayBuffer());
  if (isPngSignature(u8)) {
    return new Blob([u8], { type: 'image/png' });
  }
  if (isJpegSignature(u8)) {
    return new Blob([u8], { type: 'image/jpeg' });
  }

  const objectUrl = URL.createObjectURL(new Blob([u8], { type: raw.type || 'application/octet-stream' }));
  return rasterizeImageToPngBlob(objectUrl, objectUrl);
}

export async function loadLogoPngBlobForPdf(logoUrl: string | undefined | null): Promise<Blob | null> {
  const url = (logoUrl ?? '').trim();
  if (!url) return null;

  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    return null;
  }

  if (url.startsWith('data:')) {
    return rasterizeImageToPngBlob(url);
  }

  const resolved = resolveLogoFetchUrl(url);
  if (resolved.startsWith('data:')) {
    return rasterizeImageToPngBlob(resolved);
  }

  const raw = await fetchAsBlob(resolved);
  if (!raw) return null;

  const objectUrl = URL.createObjectURL(raw);
  return rasterizeImageToPngBlob(objectUrl, objectUrl);
}

/**
 * Compatibilidad: quien aún requiera data URL (poco recomendable con @react-pdf en navegador).
 */
export async function loadLogoDataUrlForPdf(logoUrl: string | undefined | null): Promise<string | null> {
  const b = await loadLogoPngBlobForPdf(logoUrl);
  if (!b) return null;
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ''));
    r.onerror = () => resolve(null);
    r.readAsDataURL(b);
  });
}
