import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import type { PreliminarVentasListRow, PreliminarVentasSlotStatus } from '../services/preliminarVentas';
import {
  PRELIMINAR_VENTAS_LATE_CELL_ARGB,
  preliminarVentasEntregadaFueraDePlazo,
  preliminarVentasSlotBadge,
} from '../components/activity/preliminarVentasConfig';
import { buildExcelLetterhead, type ExcelLetterheadWorkspace } from './excelLetterhead';

// Mismo estilo que pdt621ExcelExport.ts: "Aptos Narrow" 10pt en todo el archivo, todo en mayúsculas.
const FONT_NAME = 'Aptos Narrow';
const FONT_SIZE = 10;

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
const HEADER_FONT: Partial<ExcelJS.Font> = { name: FONT_NAME, size: FONT_SIZE, bold: true, color: { argb: 'FFFFFFFF' } };
const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
};
/** Celeste: entrega registrada después de su fecha del calendario (mismo color que la lista). */
const LATE_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PRELIMINAR_VENTAS_LATE_CELL_ARGB } };
const SUSPENDIDA_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3E8FF' } };

function formatDate(iso?: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return y && m && d ? `${d}/${m}/${y}` : '';
}

/** Fecha y hora en Lima (registro / envío). */
function formatDateTime(iso?: string | null): string {
  if (!iso) return '';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleString('es-PE', {
    timeZone: 'America/Lima',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export async function exportPreliminarVentasReportExcel(options: {
  periodYm: string;
  rows: PreliminarVentasListRow[];
  workspace: ExcelLetterheadWorkspace;
  /** Entregas a incluir (por defecto las 2). */
  slots?: Array<1 | 2>;
}): Promise<void> {
  const { periodYm, rows, workspace } = options;
  const slots: Array<1 | 2> = options.slots?.length ? [...options.slots].sort() : [1, 2];
  if (rows.length === 0) {
    throw new Error('No hay datos para exportar.');
  }
  const due1 = rows.find((r) => r.slot1.due_date)?.slot1.due_date;
  const due2 = rows.find((r) => r.slot2.due_date)?.slot2.due_date;
  const slotHeader = (n: number, due?: string) => `ENTREGA ${n}${due ? ` (${formatDate(due)})` : ''}`;

  const headers = ['CÓDIGO', 'DÍGITO', 'RAZÓN SOCIAL', 'RUC', 'ASISTENTE'];
  const widths = [8, 8, 34, 13, 14];
  for (const n of slots) {
    headers.push(`${slotHeader(n, n === 1 ? due1 : due2)} ESTADO`, `ENTREGA ${n} REGISTRADO`, `ENTREGA ${n} ENVIADO`);
    widths.push(24, 17, 17);
  }

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Preliminar de ventas');
  await buildExcelLetterhead({
    sheet,
    totalCols: headers.length,
    title: `PRELIMINAR DE VENTAS${slots.length === 1 ? ` — ENTREGA ${slots[0]}` : ''}${workspace === 'supervisor' ? ' — SUPERVISORES' : ' — ASISTENTES'}`,
    periodYm,
    companyCount: rows.length,
    workspace,
    fontName: FONT_NAME,
    fontSize: FONT_SIZE,
  });

  const headerRow = sheet.getRow(4);
  headers.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.border = THIN_BORDER;
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });
  headerRow.height = 30;

  let rowIdx = 5;
  for (const row of rows) {
    const dataRow = sheet.getRow(rowIdx);
    let col = 1;
    const setText = (v: string, align: 'left' | 'center' = 'left', fill?: ExcelJS.Fill) => {
      const c = dataRow.getCell(col++);
      c.value = v.toUpperCase();
      c.font = { name: FONT_NAME, size: FONT_SIZE };
      c.border = THIN_BORDER;
      if (fill) c.fill = fill;
      c.alignment = { vertical: 'middle', horizontal: align, wrapText: align === 'left' };
    };
    // Las 3 celdas de una entrega fuera de plazo van en celeste (igual que la lista).
    const setSlot = (slot: PreliminarVentasSlotStatus) => {
      const fill = row.suspendida
        ? SUSPENDIDA_FILL
        : preliminarVentasEntregadaFueraDePlazo(slot.status, slot.timeliness)
          ? LATE_FILL
          : undefined;
      const label = row.suspendida ? 'Suspendida' : preliminarVentasSlotBadge(slot.status, slot.timeliness).label;
      setText(label, 'center', fill);
      setText(row.suspendida ? '' : formatDateTime(slot.registrado_at), 'center', fill);
      setText(row.suspendida ? '' : formatDateTime(slot.sent_at), 'center', fill);
    };

    setText(row.code || '—', 'center');
    setText(row.dig || '—', 'center');
    setText(row.business_name || '—');
    setText(row.ruc || '—', 'center');
    setText(row.assistant_username || '—');
    for (const n of slots) setSlot(n === 1 ? row.slot1 : row.slot2);
    rowIdx += 1;
  }

  widths.forEach((w, i) => {
    sheet.getColumn(i + 1).width = w;
  });
  sheet.views = [{ state: 'frozen', xSplit: 0, ySplit: 4 }];

  const buffer = await workbook.xlsx.writeBuffer();
  saveAs(
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `reporte-preliminar-ventas-${periodYm}${slots.length === 1 ? `-entrega-${slots[0]}` : ''}.xlsx`,
  );
}
