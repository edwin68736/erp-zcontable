import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import type { ItfResult, ItfTable } from '../../../services/itf';

/** SUNAT no consulta períodos anteriores a marzo de 2004. */
export const ITF_MIN_MONTH = '2004-03';
export const ITF_MAX_MONTHS = 60;

/** Descripción de los códigos de operación que SUNAT publica (los demás figuran «no definido» en su propia pantalla). */
export const ITF_COD_OPER: Record<string, string> = {
  '01': 'Operaciones en cuenta (Art. 9, inc. a, Ley 28194)',
  '02': 'Pagos a ESF, sin utilizar cuenta (Art. 9, inc. b)',
  '03': 'Adquisición de cheques de gerencia sin utilizar cuenta (Art. 9, inc. c)',
  '04': 'Entrega de recaudación, sin utilizar cuenta (Art. 9, inc. d)',
  '05': 'Envío de dinero por ESF, sin utilizar cuenta (Art. 9, inc. e, num. 1)',
  '06': 'Envío de dinero por ETF, sin utilizar cuenta (Art. 9, inc. e, num. 2)',
  '07': 'Sistema organizado de pagos (Art. 9, inc. f)',
  '08': 'Pagos realizados por ESF para adquisición de activos (Art. 9, inc. h, num. 1)',
  '09': 'Gasto o costo incurrido por ESF excepto intermediación (Art. 9, inc. h, num. 2)',
  '10': 'Pagos a establecimientos afiliados de TC, sin utilizar cuenta (Art. 9, inc. i)',
  '11': 'Recepción de préstamos, sin utilizar cuenta (Art. 9, inc. j)',
};

/** «202605» → «05/2026». */
export function periodLabel(p: string): string {
  return /^\d{6}$/.test(p) ? `${p.slice(4)}/${p.slice(0, 4)}` : p;
}

/** «2026-05» (campo de mes) → «202605». */
export const monthToPeriod = (m: string): string => m.replace('-', '');

/** «202605» → «2026-05» (campo de mes). */
export const periodToMonth = (p: string): string => (/^\d{6}$/.test(p) ? `${p.slice(0, 4)}-${p.slice(4)}` : '');

export function currentMonth(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** Mes anterior o posterior en «AAAA-MM». */
export function addMonths(m: string, delta: number): string {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(y, mo - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Meses entre dos «AAAA-MM», ambos incluidos (0 si el orden es inválido). */
export function monthsBetween(desde: string, hasta: string): number {
  if (!/^\d{4}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}$/.test(hasta)) return 0;
  const [y1, m1] = desde.split('-').map(Number);
  const [y2, m2] = hasta.split('-').map(Number);
  const n = (y2 - y1) * 12 + (m2 - m1) + 1;
  return n > 0 ? n : 0;
}

/** «1,000.00» → 1000. */
export function parseAmount(s: string | undefined): number {
  const v = Number((s ?? '').replace(/,/g, ''));
  return Number.isFinite(v) ? v : 0;
}

export const fmtAmount = (n: number): string => n.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Posición de una columna por su nombre (sin importar tildes ni mayúsculas); -1 si no está. */
export function colIndex(t: ItfTable, name: string): number {
  return t.columnas.findIndex((c) => norm(c) === norm(name));
}

export interface ItfPeriodSummary {
  periodo: string;
  base: number;
  impuesto: number;
  operaciones: number;
}

/** Totales por período de los movimientos acumulados (base e impuesto), ordenados por período. */
export function summarizeByPeriod(t: ItfTable): ItfPeriodSummary[] {
  const ip = colIndex(t, 'Período');
  const ib = colIndex(t, 'Base');
  const ii = colIndex(t, 'Impuesto');
  if (ip < 0 || ib < 0 || ii < 0) return [];
  const map = new Map<string, ItfPeriodSummary>();
  for (const f of t.filas) {
    const p = f[ip];
    const cur = map.get(p) ?? { periodo: p, base: 0, impuesto: 0, operaciones: 0 };
    cur.base += parseAmount(f[ib]);
    cur.impuesto += parseAmount(f[ii]);
    cur.operaciones += 1;
    map.set(p, cur);
  }
  return [...map.values()].sort((a, b) => a.periodo.localeCompare(b.periodo));
}

/** Columnas que se muestran alineadas a la derecha (importes). */
export const isAmountColumn = (name: string): boolean => ['base', 'impuesto'].includes(norm(name));

/** Excel con las tres tablas del resultado (una hoja por tabla, más un resumen por período). */
export async function exportItfExcel(res: ItfResult, meta: { empresa: string; ruc: string }): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const style = (row: ExcelJS.Row) => {
    row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    row.eachCell((c) => {
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
      c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    });
  };
  const title = `Consulta de ITF — ${meta.empresa} (RUC ${meta.ruc}) · períodos ${periodLabel(res.desde)} a ${periodLabel(res.hasta)}`;

  const resumen = wb.addWorksheet('Resumen');
  resumen.addRow([title]).font = { bold: true, size: 12 };
  resumen.addRow(['Base imponible referencial calculada por SUNAT a partir del impuesto retenido.']);
  resumen.addRow([]);
  style(resumen.addRow(['Período', 'Operaciones', 'Base', 'Impuesto (ITF)']));
  const rows = summarizeByPeriod(res.acumulados);
  for (const r of rows) resumen.addRow([periodLabel(r.periodo), r.operaciones, r.base, r.impuesto]);
  const total = resumen.addRow(['Total', rows.reduce((a, r) => a + r.operaciones, 0), rows.reduce((a, r) => a + r.base, 0), rows.reduce((a, r) => a + r.impuesto, 0)]);
  total.font = { bold: true };
  [14, 14, 18, 18].forEach((w, i) => {
    resumen.getColumn(i + 1).width = w;
  });
  resumen.getColumn(3).numFmt = '#,##0.00';
  resumen.getColumn(4).numFmt = '#,##0.00';

  const add = (name: string, t: ItfTable) => {
    const ws = wb.addWorksheet(name);
    ws.addRow([`${t.titulo} — ${meta.empresa} (RUC ${meta.ruc})`]).font = { bold: true, size: 12 };
    ws.addRow([`${t.registros} registro${t.registros === 1 ? '' : 's'}`]);
    ws.addRow([]);
    if (t.columnas.length) style(ws.addRow(t.columnas));
    const amountCols = t.columnas.map((c, i) => (isAmountColumn(c) ? i : -1)).filter((i) => i >= 0);
    for (const f of t.filas) ws.addRow(f.map((v, i) => (amountCols.includes(i) ? parseAmount(v) : v)));
    t.columnas.forEach((c, i) => {
      ws.getColumn(i + 1).width = Math.max(12, Math.min(40, c.length + 6));
      if (amountCols.includes(i)) ws.getColumn(i + 1).numFmt = '#,##0.00';
    });
    ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 4 }];
  };
  add('Acumulados', res.acumulados);
  add('Contra asientos', res.contra_asientos);
  add('Exoneraciones', res.exoneraciones);

  const buffer = await wb.xlsx.writeBuffer();
  saveAs(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `ITF-${meta.ruc}-${res.desde}_${res.hasta}.xlsx`);
}
