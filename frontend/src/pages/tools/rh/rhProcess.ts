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

export interface RhProcessResult {
  /** Recibos de los que se bajó el PDF. */
  pdf: number;
  excel: boolean;
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
  const out: RhProcessResult = { pdf: 0, excel: false, notes: [], saved: '' };
  if (!formats.pdf && !formats.excel) return out;
  if (items.length === 0) {
    out.notes.push('SUNAT no devolvió recibos en ese rango: no hay nada que descargar.');
    return out;
  }
  const meta = { empresa: p.empresa, ruc: p.ruc, desde: p.desde, hasta: p.hasta, lado };
  if (formats.pdf && lado === 'emisor') out.notes.push('El PDF solo está disponible para los recibos recibidos.');
  const fetchFiles = formats.pdf && lado === 'receptor';

  const zip = new JSZip();
  const fileErrors: string[] = []; // lo que SUNAT no entregó: va también a errores.txt dentro del ZIP
  let excelBlob: Blob | null = null;
  let excelName = '';

  if (fetchFiles) {
    for (let i = 0; i < items.length; i += RH_FILES_CHUNK) {
      const chunk = items.slice(i, i + RH_FILES_CHUNK);
      const r = await rheSolService.files(
        p.companyId,
        chunk.map((c) => ({ comprobante: c.comprobante, fec_emision: c.fec_emision, emisor_doc: c.emisor_doc })),
        ['pdf'],
      );
      const part = await JSZip.loadAsync(r.blob);
      for (const [path, entry] of Object.entries(part.files)) {
        if (entry.dir || path === 'errores.txt') continue; // los avisos se juntan abajo
        let target = path;
        for (let n = 2; zip.file(target); n++) target = path.replace(/(\.[^.]+)?$/, `-${n}$1`);
        zip.file(target, await entry.async('uint8array'));
        if (path.startsWith('PDF/')) out.pdf += 1;
      }
      fileErrors.push(...r.errors);
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
