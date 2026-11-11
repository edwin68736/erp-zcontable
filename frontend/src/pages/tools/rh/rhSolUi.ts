import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import type { RheSolItem, RheSolLado } from '../../../services/rheSol';
import { notify } from '../../../utils/notify';
import { fmtDay } from './rhUi';

/** Rango máximo por consulta (el servidor parte el rango en búsquedas de 1 mes). */
export const RH_SOL_MAX_DAYS = 366;

export const TIPO_LABEL: Record<string, string> = {
  RH: 'Recibo por honorarios',
  NC: 'Nota de crédito',
  OI: 'Otros ingresos de 4ta',
};

export const tipoLabel = (t: string): string => TIPO_LABEL[t] ?? t;

/** ¿Cuenta para los totales? Se dejan fuera los anulados y las notas de crédito (reducen el recibo original). */
export const countsInTotals = (r: RheSolItem): boolean => !r.anulado && r.tipo !== 'NC';

export interface RheSolTotals {
  moneda: string;
  bruta: number;
  impuesto: number;
  neta: number;
  cantidad: number;
}

/** Suma por moneda (no se mezclan soles con dólares). */
export function totalsByMoneda(items: RheSolItem[]): RheSolTotals[] {
  const acc = new Map<string, RheSolTotals>();
  for (const r of items) {
    if (!countsInTotals(r)) continue;
    const cur = r.moneda || 'PEN';
    const t = acc.get(cur) ?? { moneda: cur, bruta: 0, impuesto: 0, neta: 0, cantidad: 0 };
    t.bruta += r.renta_bruta;
    t.impuesto += r.impuesto_renta;
    t.neta += r.renta_neta;
    t.cantidad += 1;
    acc.set(cur, t);
  }
  return [...acc.values()];
}

const headers = (lado: RheSolLado) => [
  'FECHA EMISIÓN',
  'TIPO',
  'COMPROBANTE',
  'ESTADO',
  lado === 'emisor' ? 'DOC. CLIENTE' : 'DOC. EMISOR',
  lado === 'emisor' ? 'NRO. DOC. CLIENTE' : 'NRO. DOC. EMISOR',
  lado === 'emisor' ? 'CLIENTE (USUARIO DEL SERVICIO)' : 'EMISOR',
  'TIPO DE RENTA',
  'GRATUITO',
  'DESCRIPCIÓN',
  'OBSERVACIÓN',
  'MONEDA',
  'RENTA BRUTA',
  'IMPUESTO A LA RENTA',
  'RENTA NETA',
  'MONTO PENDIENTE',
];
const WIDTHS = [13, 20, 14, 13, 10, 15, 38, 9, 9, 50, 30, 8, 14, 14, 14, 14];

export interface RheSolExportMeta {
  empresa: string;
  ruc: string;
  desde: string;
  hasta: string;
  lado: RheSolLado;
}

/** Nombre del Excel: «RH-recibidos-<RUC>-<desde>_<hasta>.xlsx». */
export const rheSolExcelName = (meta: RheSolExportMeta): string => `RH-${meta.lado === 'emisor' ? 'emitidos' : 'recibidos'}-${meta.ruc}-${meta.desde}_${meta.hasta}.xlsx`;

/** Arma el Excel (sin guardarlo). */
export async function rheSolExcelBlob(items: RheSolItem[], meta: RheSolExportMeta): Promise<Blob> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Recibos');
  const emitidos = meta.lado === 'emisor';
  sheet.addRow([`Recibos por honorarios ${emitidos ? 'emitidos' : 'recibidos'} — ${meta.empresa} (RUC ${meta.ruc})`]).font = { bold: true, size: 12 };
  sheet.addRow([`SUNAT Operaciones en Línea · Consulta ${emitidos ? 'Emisor' : 'Receptor'} · emisión del ${fmtDay(meta.desde)} al ${fmtDay(meta.hasta)}`]);
  sheet.addRow([]);
  const head = sheet.addRow(headers(meta.lado));
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.eachCell((c) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });
  for (const r of items) {
    sheet.addRow([
      fmtDay(r.fec_emision),
      tipoLabel(r.tipo),
      r.comprobante,
      r.estado,
      r.emisor_tipo_doc,
      r.emisor_doc,
      r.emisor_nombre,
      r.tipo_renta,
      r.gratuito ? 'SÍ' : 'NO',
      r.descripcion,
      r.observacion,
      r.moneda,
      r.renta_bruta,
      r.impuesto_renta,
      r.renta_neta,
      r.monto_pendiente,
    ]);
  }
  WIDTHS.forEach((w, i) => {
    sheet.getColumn(i + 1).width = w;
  });
  for (const col of [13, 14, 15, 16]) sheet.getColumn(col).numFmt = '#,##0.00';
  sheet.views = [{ state: 'frozen', xSplit: 0, ySplit: 4 }];
  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export async function exportRheSolExcel(items: RheSolItem[], meta: RheSolExportMeta): Promise<void> {
  saveAs(await rheSolExcelBlob(items, meta), rheSolExcelName(meta));
  void notify.success('Excel descargado');
}
