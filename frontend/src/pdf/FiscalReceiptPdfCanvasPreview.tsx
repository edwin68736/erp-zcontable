import { useEffect, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = pdfjsWorker;

type Props = {
  blob: Blob | null;
  className?: string;
  /** Escala de render (ticket suele verse bien con 1.2–1.5). */
  scale?: number;
};

/** Vista previa sin visor del navegador (sin barra descargar/imprimir del PDF embebido). */
export default function FiscalReceiptPdfCanvasPreview({ blob, className = '', scale = 1.4 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    if (!blob) {
      el.replaceChildren();
      setError(null);
      setRendering(false);
      return;
    }

    let cancelled = false;
    setRendering(true);
    setError(null);
    el.replaceChildren();

    void (async () => {
      try {
        const data = await blob.arrayBuffer();
        const pdf = await getDocument({ data }).promise;
        if (cancelled) return;

        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
          const page = await pdf.getPage(pageNum);
          if (cancelled) return;
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.className = 'mx-auto block max-w-full h-auto bg-white shadow-sm ring-1 ring-slate-200/80';
          if (pageNum < pdf.numPages) canvas.className += ' mb-4';

          const ctx = canvas.getContext('2d');
          if (!ctx) continue;
          await page.render({ canvasContext: ctx, viewport }).promise;
          if (cancelled) return;
          el.appendChild(canvas);
        }
      } catch (e) {
        console.error(e);
        if (!cancelled) setError('No se pudo mostrar la vista previa del PDF');
      } finally {
        if (!cancelled) setRendering(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [blob, scale]);

  return (
    <div className={className}>
      {rendering ? (
        <p className="flex min-h-[200px] items-center justify-center text-sm text-slate-500">
          <i className="fas fa-spinner fa-spin mr-2" />
          Renderizando…
        </p>
      ) : null}
      {error ? <p className="text-sm text-red-600 px-2 py-4">{error}</p> : null}
      <div ref={containerRef} className="flex flex-col items-center py-2" />
    </div>
  );
}

/** @deprecated Preferir printFiscalReceiptPdfBlob (vectorial). Reserva: impresión raster con ancho fijo. */
export function printFiscalReceiptCanvasPreview(
  container: HTMLElement | null,
  format: 'a4' | 'a5' | 'ticket' = 'a4',
): boolean {
  if (!container) return false;
  const canvases = container.querySelectorAll('canvas');
  if (!canvases.length) return false;

  const w = window.open('', '_blank');
  if (!w) return false;

  const imgWidth = format === 'ticket' ? '80mm' : format === 'a5' ? '210mm' : '100%';
  const pageRule =
    format === 'ticket'
      ? '@page{size:80mm auto;margin:2mm}'
      : format === 'a5'
        ? '@page{size:A5 landscape;margin:8mm}'
        : '@page{margin:8mm}';

  const imgs = Array.from(canvases)
    .map(
      (c) =>
        `<img src="${(c as HTMLCanvasElement).toDataURL('image/png')}" style="display:block;width:${imgWidth};max-width:${imgWidth};height:auto;margin:0 auto 8px;image-rendering:crisp-edges" />`,
    )
    .join('');

  w.document.open();
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Imprimir</title>
<style>${pageRule}body{margin:0;padding:8px;background:#fff}</style></head>
<body>${imgs}</body></html>`);
  w.document.close();
  w.focus();
  w.onload = () => {
    w.print();
    w.close();
  };
  return true;
}
