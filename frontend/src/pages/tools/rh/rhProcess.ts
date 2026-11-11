import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { rheSolService, type RheSolItem, type RheSolLado } from '../../../services/rheSol';
import { rheSolExcelBlob, rheSolExcelName, rheSolTxt, rheSolTxtName } from './rhSolUi';

/** Formatos que se pueden pedir en el formulario. */
export interface RhFormats {
  pdf: boolean;
  xml: boolean;
  txt: boolean;
  excel: boolean;
}

export const RH_NO_FORMATS: RhFormats = { pdf: false, xml: false, txt: false, excel: false };

/** El servidor admite hasta este número de recibos por pedido de archivos. */
export const RH_FILES_CHUNK = 100;

export interface RhProcessResult {
  /** Recibos de los que se bajó el PDF / el XML. */
  pdf: number;
  xml: number;
  txt: boolean;
  excel: boolean;
  /** Avisos: archivos que SUNAT no entregó o formatos que no aplican. */
  notes: string[];
  /** Nombre del archivo que se guardó (vacío si no se pidió ningún formato). */
  saved: string;
}

const dir = (path: string) => (path.startsWith('PDF/') ? 'pdf' : path.startsWith('XML/') ? 'xml' : '');

/**
 * Genera lo que se eligió en el formulario con los recibos ya consultados: el Excel y el TXT salen de los datos; el PDF y el
 * XML se piden a SUNAT (solo recibidos, de a 100). Si es un único archivo se guarda tal cual; si son varios, en un ZIP con
 * las carpetas PDF/, XML/ y TXT/ y el Excel (como el de MallquiBot).
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
  const out: RhProcessResult = { pdf: 0, xml: 0, txt: false, excel: false, notes: [], saved: '' };
  if (!formats.pdf && !formats.xml && !formats.txt && !formats.excel) return out;
  if (items.length === 0) {
    out.notes.push('SUNAT no devolvió recibos en ese rango: no hay nada que descargar.');
    return out;
  }
  const meta = { empresa: p.empresa, ruc: p.ruc, desde: p.desde, hasta: p.hasta, lado };
  const wantFiles = formats.pdf || formats.xml;
  if (wantFiles && lado === 'emisor') out.notes.push('El PDF y el XML solo están disponibles para los recibos recibidos.');
  const fetchFiles = wantFiles && lado === 'receptor';

  const zip = new JSZip();
  const fileErrors: string[] = []; // lo que SUNAT no entregó: va también a errores.txt dentro del ZIP
  let singleBlob: Blob | null = null;
  let singleName = '';

  if (fetchFiles) {
    const kinds = [...(formats.pdf ? (['pdf'] as const) : []), ...(formats.xml ? (['xml'] as const) : [])];
    for (let i = 0; i < items.length; i += RH_FILES_CHUNK) {
      const chunk = items.slice(i, i + RH_FILES_CHUNK);
      const r = await rheSolService.files(
        p.companyId,
        chunk.map((c) => ({ comprobante: c.comprobante, fec_emision: c.fec_emision, emisor_doc: c.emisor_doc })),
        kinds,
      );
      const part = await JSZip.loadAsync(r.blob);
      for (const [path, entry] of Object.entries(part.files)) {
        if (entry.dir) continue;
        if (path === 'errores.txt') continue; // los avisos se juntan abajo
        let target = path;
        for (let n = 2; zip.file(target); n++) target = `${path.replace(/(\.[^.]+)?$/, `-${n}$1`)}`;
        zip.file(target, await entry.async('uint8array'));
        const d = dir(path);
        if (d === 'pdf') out.pdf += 1;
        if (d === 'xml') out.xml += 1;
      }
      fileErrors.push(...r.errors);
    }
  }
  if (formats.txt) {
    const name = rheSolTxtName(meta);
    const blob = new Blob([rheSolTxt(items)], { type: 'text/plain;charset=utf-8' });
    zip.file(`TXT/${name}`, blob);
    singleBlob = blob;
    singleName = name;
    out.txt = true;
  }
  if (formats.excel) {
    const name = rheSolExcelName(meta);
    const blob = await rheSolExcelBlob(items, meta);
    zip.file(name, blob);
    singleBlob = blob;
    singleName = name;
    out.excel = true;
  }

  const files = Object.values(zip.files).filter((f) => !f.dir).length;
  if (files === 0) return out;
  out.notes.push(...fileErrors);
  if (fileErrors.length > 0) zip.file('errores.txt', `${fileErrors.join('\r\n')}\r\n`);
  if (files === 1 && singleBlob && fileErrors.length === 0) {
    saveAs(singleBlob, singleName);
    out.saved = singleName;
    return out;
  }
  const zipName = `RH-${lado === 'emisor' ? 'EMI' : 'REC'}-${p.ruc}-${p.desde}_${p.hasta}.zip`;
  saveAs(await zip.generateAsync({ type: 'blob' }), zipName);
  out.saved = zipName;
  return out;
}
