import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import type { ItfResult, ItfTable } from '../../../services/itf';
import { notify } from '../../../utils/notify';

/** SUNAT no consulta periodos anteriores a marzo de 2004. */
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

/** Totales por periodo de los movimientos acumulados (base e impuesto), ordenados por periodo. */
export function summarizeByPeriod(t: ItfTable): ItfPeriodSummary[] {
  const ip = colIndex(t, 'Periodo');
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

/** Columnas de las tablas de SUNAT; el Excel las muestra aunque la consulta no traiga registros (como la referencia). */
export const ITF_DEFAULT_COLUMNS = ['RUC', 'Declarante', 'Tipo Doc', 'Contribuyente', 'Período', 'Tipo', 'Movimiento', 'Cod. Oper.', 'Base', 'Impuesto'];

/** Las hojas del Excel, con los nombres de la referencia. */
const ITF_SHEETS: { name: string; pick: (r: ItfResult) => ItfTable }[] = [
  { name: 'Movimientos Acumulados', pick: (r) => r.acumulados },
  { name: 'Contra Asientos', pick: (r) => r.contra_asientos },
  { name: 'Exoneraciones', pick: (r) => r.exoneraciones },
];

const sumColumn = (t: ItfTable, name: string): number => {
  const i = colIndex(t, name);
  return i < 0 ? 0 : t.filas.reduce((acc, f) => acc + parseAmount(f[i]), 0);
};

/** «ITF_20611930641_202608-202609.xlsx» */
export const itfFileName = (ruc: string, res: Pick<ItfResult, 'desde' | 'hasta'>): string => `ITF_${ruc}_${res.desde}-${res.hasta}.xlsx`;

/**
 * El libro del reporte, con la misma forma que el de la referencia: una hoja por tabla de SUNAT (Movimientos Acumulados, Contra
 * Asientos, Exoneraciones); arriba el documento y la razón social, la tabla desde la fila 5 y, debajo, la cantidad de registros y los totales.
 */
export function buildItfWorkbook(res: ItfResult, meta: { empresa: string; ruc: string }): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const documento = res.documento || `06 - RUC Nro. ${meta.ruc}`;
  const razon = res.razon_social || meta.empresa;
  for (const sheet of ITF_SHEETS) {
    const t = sheet.pick(res);
    const cols = t.columnas.length > 0 ? t.columnas : ITF_DEFAULT_COLUMNS;
    const ws = wb.addWorksheet(sheet.name);
    const label = (row: number, text: string, value: string) => {
      const r = ws.getRow(row);
      r.getCell(1).value = text;
      r.getCell(1).font = { bold: true, color: { argb: 'FF2F5597' } };
      r.getCell(2).value = value;
    };
    label(1, 'Documento:', documento);
    label(2, 'Razón Social:', razon);
    const head = ws.getRow(5);
    cols.forEach((c, i) => {
      const cell = head.getCell(i + 1);
      cell.value = c;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F5597' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    });
    const amountCols = cols.map((c, i) => (isAmountColumn(c) ? i : -1)).filter((i) => i >= 0);
    t.filas.forEach((f, ri) => {
      const row = ws.getRow(6 + ri);
      f.forEach((v, i) => {
        row.getCell(i + 1).value = amountCols.includes(i) ? parseAmount(v) : v;
      });
    });
    // Debajo de la tabla (con una fila en blanco): cantidad de registros y totales, como SUNAT.
    const impuesto = t.total_impuesto ?? sumColumn(t, 'Impuesto');
    const movimientos = t.total_movimientos ?? sumColumn(t, 'Base');
    const sumRow = ws.getRow(6 + t.filas.length + 1);
    sumRow.getCell(1).value = `Cantidad de registros: ${t.registros} Total Impuesto: ${impuesto.toFixed(2)} Total Movimientos: ${movimientos.toFixed(2)}`;
    sumRow.getCell(1).font = { bold: true, italic: true };
    cols.forEach((c, i) => {
      ws.getColumn(i + 1).width = i === 0 ? 16 : Math.max(12, Math.min(40, c.length + 6));
      if (amountCols.includes(i)) ws.getColumn(i + 1).numFmt = '#,##0.00';
    });
  }
  return wb;
}

/** Baja el reporte en Excel (la forma del de la referencia). */
export async function exportItfExcel(res: ItfResult, meta: { empresa: string; ruc: string }): Promise<void> {
  const buffer = await buildItfWorkbook(res, meta).xlsx.writeBuffer();
  saveAs(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), itfFileName(meta.ruc, res));
  void notify.success('Excel descargado');
}
