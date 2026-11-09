import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import type { DamItem, DamResult } from '../../../services/dam';
import { fmtDay } from '../npd/npdUi';
import { notify } from '../../../utils/notify';

/** La búsqueda de Aduanas es lenta: se limita a 3 meses por consulta. */
export const DAM_MAX_DAYS = 92;

/** Importes de SUNAT (sin moneda: la lista no la informa), con 2 decimales. */
export const fmtDamAmount = (n: number): string => n.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Filtro de texto sobre DAM, exportador, consignatario, despachador y tipo de embarque. */
export function filterDams(items: DamItem[], q: string): DamItem[] {
  const t = q.trim().toLowerCase();
  if (!t) return items;
  return items.filter((d) => `${d.dam} ${d.exportador} ${d.consignatario} ${d.despachador} ${d.tipo_embarque}`.toLowerCase().includes(t));
}

/** ¿Alguna DAM trae solicitud de regularización? (la columna solo se muestra si hay datos). */
export const hasRegularizacion = (items: DamItem[]): boolean => items.some((d) => (d.regularizacion ?? '').trim() !== '');

/** Excel con la lista de DAM (una fila por DAM y totales al final). */
export async function exportDamExcel(res: DamResult, meta: { empresa: string; ruc: string }): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('DAM');
  sheet.addRow([`DAM de exportación — ${meta.empresa} (RUC ${meta.ruc})`]).font = { bold: true, size: 12 };
  sheet.addRow([`Numeradas del ${fmtDay(res.desde)} al ${fmtDay(res.hasta)} · ${res.total} DAM`]);
  sheet.addRow([]);
  const showReg = hasRegularizacion(res.items);
  const head = sheet.addRow([
    'DAM',
    'Fecha de numeración',
    'Despachador de aduana',
    'Exportador',
    'Consignatario',
    'Tipo de embarque',
    'Cláusula de venta',
    'Valor en aduana',
    ...(showReg ? ['Solicitud de regularización'] : []),
  ]);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.eachCell((c) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });
  for (const r of res.items) {
    sheet.addRow([r.dam, r.fec_numeracion, r.despachador, r.exportador, r.consignatario, r.tipo_embarque, r.clausula_venta, r.valor_aduana, ...(showReg ? [r.regularizacion ?? ''] : [])]);
  }
  sheet.addRow([]);
  sheet.addRow(['Total', '', '', '', '', '', res.total_clausula, res.total_valor]).font = { bold: true };
  [24, 18, 32, 32, 30, 16, 18, 18, 22].forEach((w, i) => {
    sheet.getColumn(i + 1).width = w;
  });
  sheet.getColumn(7).numFmt = '#,##0.00';
  sheet.getColumn(8).numFmt = '#,##0.00';
  sheet.views = [{ state: 'frozen', xSplit: 0, ySplit: 4 }];
  const buffer = await wb.xlsx.writeBuffer();
  saveAs(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `DAM-${meta.ruc}-${res.desde}_${res.hasta}.xlsx`);
  void notify.success('Excel descargado');
}
