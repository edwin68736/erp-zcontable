import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import type { RheComprobante, RheTipo } from '../../../services/rhe';
import { notify } from '../../../utils/notify';

/** Estados de la plataforma de confirmación según el tipo de consulta. */
export const RH_ESTADOS: Record<RheTipo, { value: string; label: string }[]> = {
  C: [
    { value: '01', label: 'Pendiente' },
    { value: '03', label: 'Subsanado' },
    { value: '06', label: 'Pendiente por reinicio' },
  ],
  V: [{ value: '02', label: 'Disconforme' }],
};

export const RH_ESTADO_BADGE: Record<string, string> = {
  '01': 'bg-amber-50 text-amber-700',
  '02': 'bg-red-50 text-red-700',
  '03': 'bg-green-50 text-green-700',
  '06': 'bg-blue-50 text-blue-700',
};

export const RH_MAX_DAYS = 190;

export function isoDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return isoDay(d);
}

/** Días entre dos fechas AAAA-MM-DD (negativo si «hasta» es anterior). */
export function daysBetween(desde: string, hasta: string): number {
  const a = Date.parse(`${desde}T00:00:00`);
  const b = Date.parse(`${hasta}T00:00:00`);
  return Math.round((b - a) / 86400000);
}

/** '2026-10-05T10:00:00.000' → '05/10/2026'. */
export function fmtDay(v: string | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v ?? '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : v || '—';
}

export function fmtMoney(n: number, moneda?: string): string {
  const s = n.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return moneda && moneda !== 'PEN' ? `${moneda} ${s}` : `S/ ${s}`;
}

export function docLabel(r: Pick<RheComprobante, 'serie' | 'numero'>): string {
  return `${r.serie}-${r.numero}`;
}

export function motivosLabel(codes: string[] | undefined, motivos: Record<string, string>): string {
  return (codes ?? []).map((c) => motivos[c] ?? c).join('; ');
}

/** Suma por moneda (no se mezclan soles con dólares). */
export function totalsByCurrency(items: RheComprobante[], pick: (r: RheComprobante) => number): [string, number][] {
  const acc = new Map<string, number>();
  for (const r of items) {
    const cur = r.moneda || 'PEN';
    acc.set(cur, (acc.get(cur) ?? 0) + pick(r));
  }
  return [...acc.entries()];
}

const HEADERS = [
  'ESTADO',
  'COMPROBANTE',
  'SERIE',
  'NÚMERO',
  'RUC EMISOR',
  'FECHA EMISIÓN',
  'PUESTA A DISPOSICIÓN',
  'PLAZO DE PAGO',
  'MONEDA',
  'TOTAL HONORARIOS',
  'RETENCIÓN',
  'NETO RECIBIDO',
  'IMPORTE FACTURA',
  'PENDIENTE DE PAGO',
  'CUOTAS',
  'MOTIVOS DISCONFORMIDAD',
  'SUSTENTO',
  'SUBSANACIÓN',
];

const WIDTHS = [22, 22, 9, 12, 14, 14, 16, 14, 9, 16, 12, 14, 15, 17, 40, 40, 40, 40];

/** Excel con todos los comprobantes consultados (una fila por comprobante). */
export async function exportRheExcel(
  items: RheComprobante[],
  motivos: Record<string, string>,
  meta: { empresa: string; ruc: string; tipo: RheTipo; desde: string; hasta: string },
): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Comprobantes');
  sheet.addRow([`${meta.tipo === 'C' ? 'Comprobantes recibidos (compras)' : 'Comprobantes emitidos (ventas)'} — ${meta.empresa} (RUC ${meta.ruc})`]).font = {
    bold: true,
    size: 12,
  };
  sheet.addRow([`Plataforma de confirmación del RHE y la FE · emisión del ${fmtDay(meta.desde)} al ${fmtDay(meta.hasta)}`]);
  sheet.addRow([]);
  const head = sheet.addRow(HEADERS);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.eachCell((c) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });
  for (const r of items) {
    sheet.addRow([
      r.estado_desc,
      r.cod_cpe === '02' ? 'Recibo por honorarios' : r.cod_cpe === '01' ? 'Factura' : r.cod_cpe,
      r.serie,
      r.numero,
      r.ruc_emisor,
      fmtDay(r.fec_emision),
      fmtDay(r.fec_puesta_disposicion),
      fmtDay(r.fec_plazo_pago),
      r.moneda,
      r.total_honorarios,
      r.retencion,
      r.neto_recibido,
      r.importe_factura,
      r.monto_pendiente,
      (r.cuotas ?? []).map((c) => `${c.numero}: ${c.monto.toFixed(2)} (${fmtDay(c.vencimiento)})`).join(' | '),
      motivosLabel(r.motivos_disconformidad, motivos),
      r.sustento_disconformidad ?? '',
      (r.notas_subsanacion ?? []).map((n) => `${n.cod_cpe} ${n.serie}-${n.numero}: ${n.comentario}`).join(' | '),
    ]);
  }
  WIDTHS.forEach((w, i) => {
    sheet.getColumn(i + 1).width = w;
  });
  for (const col of [10, 11, 12, 13, 14]) sheet.getColumn(col).numFmt = '#,##0.00';
  sheet.views = [{ state: 'frozen', xSplit: 0, ySplit: 4 }];
  const buffer = await wb.xlsx.writeBuffer();
  saveAs(
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `RH-${meta.ruc}-${meta.tipo === 'C' ? 'compras' : 'ventas'}-${meta.desde}_${meta.hasta}.xlsx`,
  );
  void notify.success('Excel descargado');
}
