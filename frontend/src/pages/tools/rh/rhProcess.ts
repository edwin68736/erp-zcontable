import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { rheSolService, type RheSolItem, type RheSolLado } from '../../../services/rheSol';
import { rheSolExcelBlob, rheSolExcelName } from './rhSolUi';

/** Formatos que se pueden pedir en el formulario. */
export interface RhFormats {
  pdf: boolean;
  excel: boolean;
}

export const RH_NO_FORMATS: RhFormats = { pdf: false, excel: false };

/** El servidor admite hasta este número de recibos por pedido de archivos. */
export const RH_FILES_CHUNK = 100;

/**
 * PDF por tanda. Cada recibo se pide a SUNAT de a uno: una tanda de 250 son unos minutos, y más tiempo seguido cansa a SUNAT.
 * Si hay más recibos pendientes, se repite el proceso: cada vez se bajan los siguientes (los ya descargados se saltan).
 */
export const RH_BATCH = 250;

/** ¿Falta bajar el PDF de este recibo? (los anulados no se proponen). */
export const isPdfPending = (r: RheSolItem): boolean => !r.anulado && !r.pdf_bajado;

/** Los primeros `limit` recibos con el PDF pendiente, en el orden de la lista. */
export function nextPdfPending(items: RheSolItem[], limit = RH_BATCH): RheSolItem[] {
  const out: RheSolItem[] = [];
  for (const r of items) {
    if (out.length >= limit) break;
    if (isPdfPending(r)) out.push(r);
  }
  return out;
}

/** Pide a SUNAT el PDF de estos recibos (de a RH_FILES_CHUNK por pedido) y junta lo recibido en un solo ZIP. */
export async function fetchPdfZip(companyId: number, items: RheSolItem[]): Promise<{ zip: JSZip; pdf: number; errors: string[] }> {
  const zip = new JSZip();
  const errors: string[] = [];
  let pdf = 0;
  for (let i = 0; i < items.length; i += RH_FILES_CHUNK) {
    const chunk = items.slice(i, i + RH_FILES_CHUNK);
    const r = await rheSolService.files(
      companyId,
      chunk.map((c) => ({ comprobante: c.comprobante, fec_emision: c.fec_emision, emisor_doc: c.emisor_doc })),
      ['pdf'],
    );
    const part = await JSZip.loadAsync(r.blob);
    for (const [path, entry] of Object.entries(part.files)) {
      if (entry.dir || path === 'errores.txt') continue; // los avisos se juntan abajo
      let target = path;
      for (let n = 2; zip.file(target); n++) target = path.replace(/(\.[^.]+)?$/, `-${n}$1`);
      zip.file(target, await entry.async('uint8array'));
      if (path.startsWith('PDF/')) pdf += 1;
    }
    errors.push(...r.errors);
  }
  return { zip, pdf, errors };
}

export interface RhProcessResult {
  /** Recibos de los que se bajó el PDF. */
  pdf: number;
  excel: boolean;
  /** Recibos que aún no tienen su PDF después de este proceso (por el tope de la tanda o porque SUNAT no lo entregó). */
  pdfPending: number;
  /** Avisos: archivos que SUNAT no entregó o formatos que no aplican. */
  notes: string[];
  /** Nombre del archivo que se guardó (vacío si no se pidió ningún formato). */
  saved: string;
}

/**
 * Genera lo que se eligió en el formulario con los recibos ya consultados: el Excel sale de los datos; el PDF de cada recibo
 * se pide a SUNAT (solo recibidos, de a 100). Si es un único archivo se guarda tal cual; si son varios, en un ZIP con la
 * carpeta PDF/ y el Excel (como el de MallquiBot).
 */
export async function runRhDownloads(p: {
  companyId: number;
  empresa: string;
  ruc: string;
  lado: RheSolLado;
  items: RheSolItem[];
  desde: string;
  hasta: string;
  formats: RhFormats;
}): Promise<RhProcessResult> {
  const { formats, items, lado } = p;
  const out: RhProcessResult = { pdf: 0, excel: false, pdfPending: 0, notes: [], saved: '' };
  if (!formats.pdf && !formats.excel) return out;
  if (items.length === 0) {
    out.notes.push('SUNAT no devolvió recibos en ese rango: no hay nada que descargar.');
    return out;
  }
  const meta = { empresa: p.empresa, ruc: p.ruc, desde: p.desde, hasta: p.hasta, lado };
  if (formats.pdf && lado === 'emisor') out.notes.push('El PDF solo está disponible para los recibos recibidos.');
  const fetchFiles = formats.pdf && lado === 'receptor';

  let zip = new JSZip();
  const fileErrors: string[] = []; // lo que SUNAT no entregó: va también a errores.txt dentro del ZIP
  let excelBlob: Blob | null = null;
  let excelName = '';

  if (fetchFiles) {
    // Solo los recibos sin PDF y de a una tanda; el Excel siempre lleva todos.
    const todo = items.filter(isPdfPending);
    const batch = todo.slice(0, RH_BATCH);
    if (todo.length === 0) {
      out.notes.push('Los PDF de esta lista ya estaban descargados: no se pidió ninguno.');
    } else {
      const r = await fetchPdfZip(p.companyId, batch);
      zip = r.zip;
      out.pdf = r.pdf;
      fileErrors.push(...r.errors);
      out.pdfPending = Math.max(0, todo.length - r.pdf);
      if (todo.length > batch.length) {
        out.notes.push(`Se bajaron ${r.pdf} PDF (tanda de ${RH_BATCH}); quedan ${todo.length - batch.length} recibos con el PDF pendiente. Vuelva a pulsar «Iniciar proceso de descarga» para los siguientes.`);
      }
    }
  }
  if (formats.excel) {
    excelName = rheSolExcelName(meta);
    excelBlob = await rheSolExcelBlob(items, meta);
    zip.file(excelName, excelBlob);
    out.excel = true;
  }

  const files = Object.values(zip.files).filter((f) => !f.dir).length;
  if (files === 0) return out;
  out.notes.push(...fileErrors);
  if (fileErrors.length > 0) zip.file('errores.txt', `${fileErrors.join('\r\n')}\r\n`);
  if (files === 1 && excelBlob && fileErrors.length === 0) {
    saveAs(excelBlob, excelName);
    out.saved = excelName;
    return out;
  }
  const zipName = `RH-${lado === 'emisor' ? 'EMI' : 'REC'}-${p.ruc}-${p.desde}_${p.hasta}.zip`;
  saveAs(await zip.generateAsync({ type: 'blob' }), zipName);
  out.saved = zipName;
  return out;
}
