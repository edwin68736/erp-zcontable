import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import type { DetraccionesListRow } from '../services/detracciones';
import { detraccionesStatusLabel, normalizeDetraccionesStatus } from '../components/activity/detraccionesConfig';
import { timelinessLabel } from '../components/activity/timelinessConfig';
import { buildExcelLetterhead, type ExcelLetterheadWorkspace } from './excelLetterhead';

// Mismo criterio de fuente que pdt621ExcelExport.ts/pdt601ExcelExport.ts — "Aptos Narrow" 10pt en
// todo el archivo, sin excepciones de tamaño.
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

/** Color de fila por estado — misma paleta que pdt621ExcelExport.ts (rojo = excluida/no aplica,
 * verde = resuelta favorablemente, celeste = en curso, naranja = pendiente). Suspendida pisa
 * cualquier estado real, igual que en pantalla (badge aparte junto a la razón social). */
const SUSPENDIDA_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
const VERIFICADO_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCFCE7' } };
const CARGADO_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0F2FE' } };
const PENDIENTE_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEDD5' } };
const SIN_CLAVE_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };

const ROW_FILL_BY_STATUS: Record<string, ExcelJS.Fill> = {
  pendiente: PENDIENTE_FILL,
  cargado: CARGADO_FILL,
  verificado: VERIFICADO_FILL,
  sin_clave: SIN_CLAVE_FILL,
  no_corresponde: SIN_CLAVE_FILL,
};

const HEADERS = [
  'CÓDIGO',
  'DÍGITO',
  'RAZÓN SOCIAL',
  'RUC',
  'ASISTENTE',
  'ESTADO',
  'SUSPENDIDA',
  'CUMPLIMIENTO',
  'FECHA ALMACENAMIENTO',
  'ARCHIVO',
];

const COLUMN_WIDTHS = [8, 8, 32, 13, 16, 15, 11, 14, 20, 32];

function formatDateTimeCell(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function styleCell(cell: ExcelJS.Cell, fill?: ExcelJS.Fill) {
  cell.font = { name: FONT_NAME, size: FONT_SIZE };
  cell.border = THIN_BORDER;
  if (fill) cell.fill = fill;
}

export async function exportDetraccionesReportExcel(options: {
  periodYm: string;
  rows: DetraccionesListRow[];
  workspace: ExcelLetterheadWorkspace;
}): Promise<void> {
  const { periodYm, rows, workspace } = options;
  if (rows.length === 0) {
    throw new Error('No hay datos para exportar.');
  }

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Control de Detracciones');
  const totalCols = HEADERS.length;

  await buildExcelLetterhead({
    sheet,
    totalCols,
    title: `CONTROL DE DETRACCIONES SUNAT${workspace === 'supervisor' ? ' — SUPERVISORES' : ' — ASISTENTES'}`,
    periodYm,
    companyCount: rows.length,
    workspace,
    fontName: FONT_NAME,
    fontSize: FONT_SIZE,
  });

  const headerRow = sheet.getRow(4);
  HEADERS.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h.toUpperCase();
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.border = THIN_BORDER;
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });
  headerRow.height = 30;

  let rowIdx = 5;
  for (const row of rows) {
    const suspendida = !!row.suspendida;
    const normalizedStatus = normalizeDetraccionesStatus(row.status);
    const rowFill: ExcelJS.Fill | undefined = suspendida ? SUSPENDIDA_FILL : ROW_FILL_BY_STATUS[normalizedStatus];

    const dataRow = sheet.getRow(rowIdx);
    let col = 1;
    // A pedido (mismo criterio que PDT601/621): todo el contenido del Excel va en mayúsculas.
    const setText = (v: string, align: 'left' | 'center' = 'left') => {
      const c = dataRow.getCell(col++);
      c.value = v.toUpperCase();
      styleCell(c, rowFill);
      c.alignment = { vertical: 'middle', horizontal: align, wrapText: align === 'left' };
    };

    setText(row.code || '—', 'center');
    setText(row.dig || '—', 'center');
    setText(row.business_name || '—');
    setText(row.ruc || '—', 'center');
    setText(row.assistant_username || '—');
    setText(detraccionesStatusLabel(row.status), 'center');
    setText(suspendida ? 'Sí' : 'No', 'center');
    setText(timelinessLabel(row.timeliness?.timeliness), 'center');
    setText(formatDateTimeCell(row.last_stored_at), 'center');
    setText(row.file_name || '');

    rowIdx += 1;
  }

  COLUMN_WIDTHS.forEach((w, i) => {
    sheet.getColumn(i + 1).width = w;
  });
  sheet.views = [{ state: 'frozen', xSplit: 0, ySplit: 4 }];

  const buffer = await workbook.xlsx.writeBuffer();
  saveAs(
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `reporte-detracciones-${periodYm}.xlsx`,
  );
}
