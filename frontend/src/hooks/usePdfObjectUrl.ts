import { useEffect, useState } from 'react';

/**
 * Descarga un PDF servido por el backend como blob y expone un blob: URL listo para un
 * <iframe src=...>. Evita el bloqueo de X-Frame-Options: SAMEORIGIN que aparece cuando el
 * frontend y el backend viven en subdominios distintos (confirmado en pruebas: el proxy delante
 * del backend manda esa cabecera) — un iframe apuntando directo a la URL remota del backend se
 * niega a cargar aunque el archivo exista y sea accesible por fetch/descarga normal. No hace
 * falta para <img> (esa cabecera no aplica) ni para PDFs ya generados como blob en el cliente.
 */
export function usePdfObjectUrl(url: string | null | undefined, enabled = true) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    setBlobUrl(null);
    setError(false);
    if (!url || !enabled) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    void (async () => {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setBlobUrl(objectUrl);
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url, enabled]);

  return { blobUrl, error, loading: !!url && enabled && !blobUrl && !error };
}
