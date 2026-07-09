/** Descarga un archivo remoto con nombre sugerido. */
export async function downloadRemoteFile(url: string, fileName: string): Promise<void> {
  const name = (fileName || 'archivo').trim() || 'archivo';
  const res = await fetch(url);
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
