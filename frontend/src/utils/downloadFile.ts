/** Descarga un archivo remoto con nombre sugerido. `cache: 'no-store'` evita un problema real
 * encontrado probando en vivo: si el mismo archivo se acaba de ver en un <iframe> (p. ej. el botón
 * "Ver" de FilePreviewModal, en modo no-cors), el navegador puede reusar esa respuesta cacheada
 * para este fetch (modo cors) y rechazarla como si le faltara CORS ("Failed to fetch"), aunque el
 * servidor sí mande `Access-Control-Allow-Origin` — forzar a no usar caché evita el choque. */
export async function downloadRemoteFile(url: string, fileName: string): Promise<void> {
  const name = (fileName || 'archivo').trim() || 'archivo';
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error('No se pudo descargar el archivo');
  }
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
}
