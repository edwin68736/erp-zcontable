import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import type { SunatInboxCaptureSlot, SunatInboxExportRow, SunatInboxMailboxSide, SunatInboxWeekOption } from '../services/sunatInbox';

const DAY_NAMES = ['DOMINGO', 'LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO'];

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
const SUPERVISOR_LABEL_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF000000' } };
const VERIFICADO_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC6EFCE' } };
const CARGADO_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE699' } };
const PENDIENTE_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } };
const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
};

/** Mismos 3 estados que la celda en pantalla (MailboxCaptureSlotCell / sunatInboxConfig.ts). */
type SideStatus = 'pendiente' | 'cargado' | 'verificado';

const STATUS_LABEL: Record<SideStatus, string> = {
  pendiente: 'PENDIENTE',
  cargado: 'CARGADO',
  verificado: 'VERIFICADO',
};

const STATUS_FILL: Record<SideStatus, ExcelJS.Fill> = {
  pendiente: PENDIENTE_FILL,
  cargado: CARGADO_FILL,
  verificado: VERIFICADO_FILL,
};

type ReportColumn = {
  weekStart: string;
  slotIndex: number;
  headerLabel: string;
  sortKey: string;
};

function parseDateOnly(value: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const d = new Date(trimmed);
  if (!Number.isNaN(d.getTime())) return d;
  const m = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function formatDueDateHeader(dueAt?: string, weekStart?: string, slotIndex = 1, capturesPerWeek = 2): string {
  let date = dueAt ? parseDateOnly(dueAt) : null;
  if (!date && weekStart) {
    const parts = weekStart.split('-');
    if (parts.length === 3) {
      const ws = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
      if (capturesPerWeek <= 1) {
        date = ws;
      } else {
        const span = 6;
        const offset = ((slotIndex - 1) * span) / (capturesPerWeek - 1);
        const d = new Date(ws);
        d.setDate(d.getDate() + Math.min(span, Math.round(offset)));
        date = d;
      }
    }
  }
  if (!date) return `CARGA ${slotIndex}`;
  const day = DAY_NAMES[date.getDay()];
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yy = String(date.getFullYear()).slice(-2);
  return `${day} ${dd}/${mm}/${yy}`;
}

function buildReportColumns(
  weeks: SunatInboxWeekOption[],
  rows: SunatInboxExportRow[],
  capturesPerWeek: number,
): ReportColumn[] {
  const cols: ReportColumn[] = [];
  for (const week of weeks) {
    for (let slotIndex = 1; slotIndex <= capturesPerWeek; slotIndex++) {
      let dueAt = '';
      for (const row of rows) {
        const slot = row.weeks[week.week_start]?.find((s) => s.slot_index === slotIndex);
        if (slot?.sunat?.timeliness?.due_at) {
          dueAt = slot.sunat.timeliness.due_at;
          break;
        }
        if (slot?.sunafil?.timeliness?.due_at) {
          dueAt = slot.sunafil.timeliness.due_at;
          break;
        }
      }
      const headerLabel = formatDueDateHeader(dueAt, week.week_start, slotIndex, capturesPerWeek);
      const sortKey = dueAt || `${week.week_start}#${slotIndex}`;
      cols.push({ weekStart: week.week_start, slotIndex, headerLabel, sortKey });
    }
  }
  cols.sort((a, b) => a.sortKey.localeCompare(b.sortKey) || a.slotIndex - b.slotIndex);
  return cols;
}

function findSlot(slots: SunatInboxCaptureSlot[] | undefined, slotIndex: number): SunatInboxCaptureSlot | undefined {
  return slots?.find((s) => s.slot_index === slotIndex);
}

/** Mismo criterio que la grilla en pantalla: usa el status tal cual viene del backend (pendiente por
 * defecto para semanas sin actividad — nunca se omite la empresa/semana). */
function sideStatus(side?: SunatInboxMailboxSide): SideStatus {
  const status = (side?.status ?? '').trim().toLowerCase();
  if (status === 'verificado') return 'verificado';
  if (status === 'cargado') return 'cargado';
  return 'pendiente';
}

function styleCell(cell: ExcelJS.Cell, fill?: ExcelJS.Fill) {
  cell.border = THIN_BORDER;
  cell.alignment = { vertical: 'middle', horizontal: 'center' };
  if (fill) cell.fill = fill;
}

function applyHeaderRow(row: ExcelJS.Row, colCount: number) {
  for (let c = 1; c <= colCount; c++) {
    const cell = row.getCell(c);
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.border = THIN_BORDER;
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  }
}

export async function exportSunatInboxReportExcel(options: {
  periodYm: string;
  weeks: SunatInboxWeekOption[];
  rows: SunatInboxExportRow[];
  capturesPerWeek: number;
  workspace: 'supervisor' | 'assistant';
  /** 'week' cuando el backend ya restringió `weeks`/`rows` a una sola semana (igual que la tabla en
   * modo semana); 'month' para el reporte de todas las semanas del período. Solo afecta el subtítulo
   * y el nombre de archivo — la estructura de columnas ya sigue naturalmente el largo de `weeks`. */
  scope: 'week' | 'month';
}): Promise<void> {
  const { periodYm, weeks, rows, capturesPerWeek, workspace, scope } = options;
  if (rows.length === 0) {
    throw new Error('No hay datos para exportar.');
  }
  const columns = buildReportColumns(weeks, rows, capturesPerWeek);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Buzones SUNAT-SUNAFIL');
  // NRO, CÓDIGO, RUC, RAZÓN SOCIAL, ASISTENTE — mismas columnas identificatorias que la tabla en pantalla.
  const fixedCols = 5;
  const totalCols = fixedCols + columns.length * 2;

  sheet.mergeCells(1, 1, 1, totalCols);
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = `REPORTE BUZONES SUNAT / SUNAFIL — ${periodYm}`;
  titleCell.font = { size: 14, bold: true };
  titleCell.alignment = { horizontal: 'left' };

  const periodParts = periodYm.split('-');
  let periodLabel = periodYm;
  if (periodParts.length === 2) {
    const y = Number(periodParts[0]);
    const m = Number(periodParts[1]) - 1;
    if (Number.isFinite(y) && Number.isFinite(m)) {
      const first = new Date(y, m, 1);
      const last = new Date(y, m + 1, 0);
      const fmt = (d: Date) =>
        `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
      periodLabel = `${fmt(first)} – ${fmt(last)}`;
    }
  }
  const scopeLabel =
    scope === 'week' && weeks.length === 1
      ? `Semana ${weeks[0].week_index}${weeks[0].date_range ? ` (${weeks[0].date_range})` : ''}`
      : `Mes completo (${weeks.length} semana${weeks.length === 1 ? '' : 's'})`;
  sheet.mergeCells(2, 1, 2, totalCols);
  sheet.getCell(2, 1).value =
    `Período: ${periodLabel} · Alcance: ${scopeLabel} · Vista: ${workspace === 'assistant' ? 'Asistente' : 'Supervisor'} · ${rows.length} empresa${rows.length === 1 ? '' : 's'}`;
  sheet.getCell(2, 1).font = { size: 10, color: { argb: 'FF64748B' } };

  let rowIdx = 4;
  const supervisors = [...new Set(rows.map((r) => (r.supervisor_username || 'SIN SUPERVISOR').trim().toUpperCase()))].sort(
    (a, b) => a.localeCompare(b),
  );

  for (const supervisor of supervisors) {
    const group = rows
      .filter((r) => (r.supervisor_username || 'SIN SUPERVISOR').trim().toUpperCase() === supervisor)
      .sort((a, b) => (a.code || '').localeCompare(b.code || '') || a.business_name.localeCompare(b.business_name));
    if (group.length === 0) continue;

    const supLabel = sheet.getCell(rowIdx, 1);
    supLabel.value = 'SUPERVISOR:';
    supLabel.fill = SUPERVISOR_LABEL_FILL;
    supLabel.font = HEADER_FONT;
    supLabel.border = THIN_BORDER;

    sheet.mergeCells(rowIdx, 2, rowIdx, totalCols);
    const supName = sheet.getCell(rowIdx, 2);
    supName.value = `${supervisor} (${group.length} empresa${group.length === 1 ? '' : 's'})`;
    supName.font = { bold: true, size: 11 };
    supName.border = THIN_BORDER;
    supName.alignment = { horizontal: 'left', vertical: 'middle' };
    rowIdx += 1;

    const headerRow1 = sheet.getRow(rowIdx);
    headerRow1.getCell(1).value = 'NRO';
    headerRow1.getCell(2).value = 'CÓDIGO';
    headerRow1.getCell(3).value = 'RUC';
    headerRow1.getCell(4).value = 'RAZÓN SOCIAL';
    headerRow1.getCell(5).value = 'ASISTENTE';
    for (let i = 0; i < columns.length; i++) {
      const startCol = fixedCols + i * 2 + 1;
      sheet.mergeCells(rowIdx, startCol, rowIdx, startCol + 1);
      headerRow1.getCell(startCol).value = columns[i].headerLabel;
    }
    applyHeaderRow(headerRow1, totalCols);
    rowIdx += 1;

    const headerRow2 = sheet.getRow(rowIdx);
    for (let c = 1; c <= fixedCols; c++) headerRow2.getCell(c).value = '';
    for (let i = 0; i < columns.length; i++) {
      const startCol = fixedCols + i * 2 + 1;
      headerRow2.getCell(startCol).value = 'SUNAT';
      headerRow2.getCell(startCol + 1).value = 'SUNAFIL';
    }
    applyHeaderRow(headerRow2, totalCols);
    rowIdx += 1;

    // Las columnas fijas (NRO, CÓDIGO, RUC, RAZÓN SOCIAL, ASISTENTE) ocupan ambas filas de cabecera.
    for (let c = 1; c <= fixedCols; c++) {
      sheet.mergeCells(rowIdx - 2, c, rowIdx - 1, c);
    }

    let nro = 0;
    for (const row of group) {
      nro += 1;
      const dataRow = sheet.getRow(rowIdx);
      dataRow.getCell(1).value = nro;
      dataRow.getCell(2).value = row.code || '—';
      dataRow.getCell(3).value = row.ruc || '—';
      dataRow.getCell(4).value = row.business_name || '—';
      dataRow.getCell(4).alignment = { horizontal: 'left', vertical: 'middle' };
      dataRow.getCell(5).value = row.assistant_username || 'SIN ASIGNAR';
      dataRow.getCell(5).alignment = { horizontal: 'left', vertical: 'middle' };
      for (let c = 1; c <= 3; c++) styleCell(dataRow.getCell(c));
      styleCell(dataRow.getCell(4));
      styleCell(dataRow.getCell(5));

      for (let i = 0; i < columns.length; i++) {
        const col = columns[i];
        const slot = findSlot(row.weeks[col.weekStart], col.slotIndex);
        const sunatStatus = sideStatus(slot?.sunat);
        const sunafilStatus = sideStatus(slot?.sunafil);
        const startCol = fixedCols + i * 2 + 1;
        const sunatCell = dataRow.getCell(startCol);
        const sunafilCell = dataRow.getCell(startCol + 1);
        sunatCell.value = STATUS_LABEL[sunatStatus];
        sunafilCell.value = STATUS_LABEL[sunafilStatus];
        styleCell(sunatCell, STATUS_FILL[sunatStatus]);
        styleCell(sunafilCell, STATUS_FILL[sunafilStatus]);
        sunatCell.font = { bold: true, size: 9 };
        sunafilCell.font = { bold: true, size: 9 };
      }
      rowIdx += 1;
    }

    rowIdx += 1;
  }

  sheet.getColumn(1).width = 6;
  sheet.getColumn(2).width = 12;
  sheet.getColumn(3).width = 13;
  sheet.getColumn(4).width = 32;
  sheet.getColumn(5).width = 18;
  for (let c = fixedCols + 1; c <= totalCols; c++) {
    sheet.getColumn(c).width = 11;
  }

  const scopeSuffix = scope === 'week' && weeks.length === 1 ? `-semana${weeks[0].week_index}` : '-mes-completo';
  const buffer = await workbook.xlsx.writeBuffer();
  saveAs(
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `reporte-buzones-sunat-${workspace}-${periodYm}${scopeSuffix}.xlsx`,
  );
}
