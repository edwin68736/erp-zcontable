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

export async function exportRheSolExcel(items: RheSolItem[], meta: { empresa: string; ruc: string; desde: string; hasta: string; lado: RheSolLado }): Promise<void> {
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
  saveAs(
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `RH-${emitidos ? 'emitidos' : 'recibidos'}-${meta.ruc}-${meta.desde}_${meta.hasta}.xlsx`,
  );
  void notify.success('Excel descargado');
}

const TXT_HEADER =
  'Fecha de Emisión|Tipo Doc. Emitido|Nro. Doc. Emitido|Estado Doc. Emitido|Tipo de Doc. Emisor|Nro. Doc. Emisor|Apellidos y Nombres, Denominación o Razón Social del Emisor|Tipo de Renta|Gratuito|Descripción|Observación|Moneda de Operación|Renta Bruta|Impuesto a la Renta|Renta Neta|Monto Neto Pendiente de Pago|';

const txtMoneda = (m: string): string => (m === 'USD' ? 'DOLARES' : m === 'PEN' || !m ? 'SOLES' : m);
const txtNum = (n: number): string => n.toFixed(2);

/** El reporte en texto con «|», con las mismas 16 columnas que entrega SUNAT en «Descargar Reporte». */
export function rheSolTxt(items: RheSolItem[]): string {
  const rows = items.map((r) =>
    [
      fmtDay(r.fec_emision),
      r.tipo,
      r.comprobante,
      r.estado,
      r.emisor_tipo_doc,
      r.emisor_doc,
      r.emisor_nombre,
      r.tipo_renta,
      r.gratuito ? 'SI' : 'NO',
      r.descripcion || '-',
      r.observacion || '-',
      txtMoneda(r.moneda),
      txtNum(r.renta_bruta),
      txtNum(r.impuesto_renta),
      txtNum(r.renta_neta),
      txtNum(r.monto_pendiente),
      '',
    ].join('|'),
  );
  return [TXT_HEADER, ...rows].join('\r\n') + '\r\n';
}

/** Baja el reporte en .txt (el mismo formato de SUNAT). */
export function exportRheSolTxt(items: RheSolItem[], meta: { ruc: string; desde: string; hasta: string; lado: RheSolLado }): void {
  const dmy = (iso: string) => iso.split('-').reverse().join('');
  const blob = new Blob([rheSolTxt(items)], { type: 'text/plain;charset=utf-8' });
  saveAs(blob, `RH-${meta.lado === 'emisor' ? 'EMI' : 'REC'}-${meta.ruc}-${dmy(meta.desde)}_a_${dmy(meta.hasta)}.txt`);
  void notify.success('TXT descargado');
}
