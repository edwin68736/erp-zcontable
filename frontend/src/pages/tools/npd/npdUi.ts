import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import type { NpdItem, NpdResult } from '../../../services/npd';
import { notify } from '../../../utils/notify';

/** SUNAT permite consultar hasta 12 meses por vez. */
export const NPD_MAX_DAYS = 365;

export const NPD_ESTADOS: { value: string; label: string }[] = [
  { value: '00', label: 'Vigente' },
  { value: '10', label: 'Pagado' },
  { value: '11', label: 'No vigente' },
];

export const NPD_ESTADO_BADGE: Record<string, string> = {
  '00': 'bg-amber-50 text-amber-700',
  '10': 'bg-green-50 text-green-700',
  '11': 'bg-slate-100 text-slate-600',
};

export function isoDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function daysAgo(n: number, now = new Date()): string {
  const d = new Date(now);
  d.setDate(d.getDate() - n);
  return isoDay(d);
}

/** Días entre dos fechas AAAA-MM-DD, ambas incluidas (0 si el orden es inválido). */
export function daysSpan(desde: string, hasta: string): number {
  const a = Date.parse(`${desde}T00:00:00`);
  const b = Date.parse(`${hasta}T00:00:00`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  const n = Math.round((b - a) / 86400000) + 1;
  return n > 0 ? n : 0;
}

/** «2026-10-30» → «30/10/2026». */
export function fmtDay(iso: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : iso;
}

export const fmtMoney = (n: number): string => `S/ ${n.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Totales por estado (cantidad e importe), en el orden de NPD_ESTADOS; los estados desconocidos van al final. */
export function totalsByEstado(items: NpdItem[]): { cod: string; label: string; count: number; importe: number }[] {
  const out = new Map<string, { cod: string; label: string; count: number; importe: number }>();
  for (const e of NPD_ESTADOS) out.set(e.value, { cod: e.value, label: e.label, count: 0, importe: 0 });
  for (const it of items) {
    const cur = out.get(it.estado_cod) ?? { cod: it.estado_cod, label: it.estado || it.estado_cod, count: 0, importe: 0 };
    cur.count += 1;
    cur.importe += it.importe;
    out.set(it.estado_cod, cur);
  }
  return [...out.values()].filter((x) => x.count > 0);
}

/** Excel con la lista de NPD (una fila por NPD y totales al final). */
export async function exportNpdExcel(res: NpdResult, meta: { empresa: string; ruc: string }): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('NPD');
  sheet.addRow([`NPD (Número de Pago de Detracciones) — ${meta.empresa} (RUC ${meta.ruc})`]).font = { bold: true, size: 12 };
  sheet.addRow([`Generados del ${fmtDay(res.desde)} al ${fmtDay(res.hasta)} · ${res.total} NPD`]);
  sheet.addRow([]);
  const head = sheet.addRow(['NPD', 'Fecha de creación', 'Fecha de registro', 'Fecha límite de pago', 'Estado', 'Importe (S/)', 'RUC', 'Razón social']);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.eachCell((c) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });
  for (const r of res.items) sheet.addRow([r.npd, r.fec_creacion, r.fec_registro, r.fec_limite_pago, r.estado, r.importe, r.ruc, r.razon_social]);
  sheet.addRow([]);
  sheet.addRow(['Total', '', '', '', '', res.total_importe]).font = { bold: true };
  sheet.addRow(['Vigentes (pendientes de pago)', '', '', '', res.vigentes, res.importe_vigente]).font = { bold: true };
  [16, 16, 20, 20, 18, 14, 14, 40].forEach((w, i) => {
    sheet.getColumn(i + 1).width = w;
  });
  sheet.getColumn(6).numFmt = '#,##0.00';
  sheet.views = [{ state: 'frozen', xSplit: 0, ySplit: 4 }];
  const buffer = await wb.xlsx.writeBuffer();
  saveAs(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `NPD-${meta.ruc}-${res.desde}_${res.hasta}.xlsx`);
  void notify.success('Excel descargado');
}
