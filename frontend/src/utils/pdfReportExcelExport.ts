import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import type { PdfReportListRow } from '../services/pdfReports';
import { formatDateOnly, pdfReportDisplayStatus, type PdfReportModuleConfig } from '../components/activity/pdfReportConfig';
import { timelinessLabel } from '../components/activity/timelinessConfig';
import { buildExcelLetterhead, type ExcelLetterheadWorkspace } from './excelLetterhead';

// Mismo criterio que pdt601ExcelExport.ts/detraccionesExcelExport.ts: "Aptos Narrow" 10pt en todo el
// archivo y todo el contenido en mayúsculas.
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

/** Color de fila por estado mostrado: rojo suspendida, verde entregado a tiempo, celeste entregado
 * fuera de fecha, naranja para lo que aún no es terminal (pendiente / por revisar / observado). */
const fill = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const ROW_FILL_BY_STATUS: Record<string, ExcelJS.Fill> = {
  suspendida: fill('FFFEE2E2'),
  entregado: fill('FFDCFCE7'),
  entregado_fuera_de_fecha: fill('FFE0F2FE'),
  pendiente: fill('FFFFEDD5'),
  por_revisar: fill('FFFFEDD5'),
  observado: fill('FFFFEDD5'),
};

const HEADERS = [
  'CÓDIGO',
  'DÍGITO',
  'RAZÓN SOCIAL',
  'RUC',
  'ASISTENTE',
  'ESTADO',
  'FECHA LÍMITE',
  'FECHA DE CUMPLIMIENTO',
  'CUMPLIMIENTO',
  'ARCHIVO',
  'FECHA DE CARGA',
  'OBSERVACIÓN',
];

const COLUMN_WIDTHS = [8, 8, 32, 13, 16, 17, 13, 16, 15, 32, 18, 36];

function formatDateTimeCell(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function styleCell(cell: ExcelJS.Cell, rowFill?: ExcelJS.Fill) {
  cell.font = { name: FONT_NAME, size: FONT_SIZE };
  cell.border = THIN_BORDER;
  if (rowFill) cell.fill = rowFill;
}

export async function exportPdfReportExcel(options: {
  module: PdfReportModuleConfig;
  periodYm: string;
  rows: PdfReportListRow[];
  workspace: ExcelLetterheadWorkspace;
}): Promise<void> {
  const { module, periodYm, rows, workspace } = options;
  if (rows.length === 0) {
    throw new Error('No hay datos para exportar.');
  }

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(module.sheetName);

  await buildExcelLetterhead({
    sheet,
    totalCols: HEADERS.length,
    title: `${module.excelTitle}${workspace === 'supervisor' ? ' — SUPERVISORES' : ' — ASISTENTES'}`,
    periodYm,
    companyCount: rows.length,
    workspace,
    fontName: FONT_NAME,
    fontSize: FONT_SIZE,
  });

  const headerRow = sheet.getRow(4);
  HEADERS.forEach((h, i) => {
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
    const display = pdfReportDisplayStatus({ status: row.status, suspendida: row.suspendida, timeliness: row.timeliness });
    const rowFill = ROW_FILL_BY_STATUS[display.value];

    const dataRow = sheet.getRow(rowIdx);
    let col = 1;
    const setText = (v: string, align: 'left' | 'center' = 'left') => {
      const c = dataRow.getCell(col++);
      c.value = v.toUpperCase();
      styleCell(c, rowFill);
      c.alignment = { vertical: 'middle', horizontal: align, wrapText: align === 'left' };
    };
    const blank = (v: string) => (v === '—' ? '' : v);

    setText(row.code || '—', 'center');
    setText(row.dig || '—', 'center');
    setText(row.business_name || '—');
    setText(row.ruc || '—', 'center');
    setText(row.assistant_username || '—');
    setText(display.label, 'center');
    setText(blank(formatDateOnly(row.due_date)), 'center');
    setText(blank(formatDateOnly(row.fecha_entrega)), 'center');
    // Suspendida no tiene plazo que cumplir; sin entrega todavía se muestra Pendiente/Vencido.
    setText(timelinessLabel(row.timeliness), 'center');
    setText(row.file_name || '');
    setText(formatDateTimeCell(row.last_stored_at), 'center');
    setText(row.observacion || '');

    rowIdx += 1;
  }

  COLUMN_WIDTHS.forEach((w, i) => {
    sheet.getColumn(i + 1).width = w;
  });
  sheet.views = [{ state: 'frozen', xSplit: 0, ySplit: 4 }];

  const buffer = await workbook.xlsx.writeBuffer();
  saveAs(
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `${module.excelFilePrefix}-${periodYm}.xlsx`,
  );
}
