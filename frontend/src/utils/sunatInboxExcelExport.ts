import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import type { SunatInboxListRow, SunatInboxMailboxSide, SunatInboxWeekOption } from '../services/sunatInbox';

const DAY_NAMES = ['DOMINGO', 'LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO'];

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
const SUPERVISOR_LABEL_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF000000' } };
const OK_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC6EFCE' } };
const PENDIENTE_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } };
const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
};

type ReportColumn = {
  key: string;
  weekStart: string;
  slotIndex: number;
  headerLabel: string;
  sortKey: string;
};

type AssistantRow = {
  assistant: string;
  supervisor: string;
  statuses: Map<string, { sunat: SunatInboxMailboxSide[]; sunafil: SunatInboxMailboxSide[] }>;
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

function columnKey(weekStart: string, slotIndex: number): string {
  return `${weekStart}:${slotIndex}`;
}

function buildReportColumns(
  weeks: SunatInboxWeekOption[],
  weeksData: Record<string, SunatInboxListRow[]>,
  capturesPerWeek: number,
): ReportColumn[] {
  const cols: ReportColumn[] = [];
  for (const week of weeks) {
    const rows = weeksData[week.week_start] ?? [];
    for (let slotIndex = 1; slotIndex <= capturesPerWeek; slotIndex++) {
      let dueAt = '';
      for (const row of rows) {
        const slot = row.slots.find((s) => s.slot_index === slotIndex);
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
      cols.push({
        key: columnKey(week.week_start, slotIndex),
        weekStart: week.week_start,
        slotIndex,
        headerLabel,
        sortKey,
      });
    }
  }
  cols.sort((a, b) => a.sortKey.localeCompare(b.sortKey) || a.slotIndex - b.slotIndex);
  return cols;
}

function companyHasRealSlotsForWeek(row: SunatInboxListRow): boolean {
  return row.slots.some((s) => s.id != null && s.id > 0);
}

function collectAssistantRows(
  weeks: SunatInboxWeekOption[],
  weeksData: Record<string, SunatInboxListRow[]>,
): AssistantRow[] {
  const byAssistant = new Map<string, AssistantRow>();

  for (const week of weeks) {
    const rows = weeksData[week.week_start] ?? [];
    for (const row of rows) {
      if (!row.control_id || !companyHasRealSlotsForWeek(row)) continue;

      const assistant = (row.assistant_username || 'SIN ASIGNAR').trim().toUpperCase();
      const supervisor = (row.supervisor_username || 'SIN SUPERVISOR').trim().toUpperCase();
      const mapKey = `${supervisor}::${assistant}`;
      let agg = byAssistant.get(mapKey);
      if (!agg) {
        agg = { assistant, supervisor, statuses: new Map() };
        byAssistant.set(mapKey, agg);
      }
      for (const slot of row.slots) {
        if (!slot.id) continue;
        const key = columnKey(week.week_start, slot.slot_index);
        let cell = agg.statuses.get(key);
        if (!cell) {
          cell = { sunat: [], sunafil: [] };
          agg.statuses.set(key, cell);
        }
        cell.sunat.push(slot.sunat ?? { status: 'pendiente' });
        cell.sunafil.push(slot.sunafil ?? { status: 'pendiente' });
      }
    }
  }

  return Array.from(byAssistant.values()).sort(
    (a, b) => a.supervisor.localeCompare(b.supervisor) || a.assistant.localeCompare(b.assistant),
  );
}

/** OK cuando el buzón está verificado (misma lógica que «Semana completa» en el listado). */
function isMailboxSideOk(side?: SunatInboxMailboxSide): boolean {
  const status = (side?.status ?? '').trim().toLowerCase();
  if (status === 'verificado') return true;
  if (side?.verified_at) return true;
  return false;
}

function aggregateReportStatus(sides: SunatInboxMailboxSide[]): 'OK' | 'PENDIENTE' {
  if (sides.length === 0) return 'PENDIENTE';
  return sides.every((side) => isMailboxSideOk(side)) ? 'OK' : 'PENDIENTE';
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
  weeksData: Record<string, SunatInboxListRow[]>;
  capturesPerWeek: number;
  workspace: 'supervisor' | 'assistant';
}): Promise<void> {
  const { periodYm, weeks, weeksData, capturesPerWeek, workspace } = options;
  const columns = buildReportColumns(weeks, weeksData, capturesPerWeek);
  const assistants = collectAssistantRows(weeks, weeksData);
  if (assistants.length === 0) {
    throw new Error('No hay datos para exportar.');
  }

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Buzones SUNAT-SUNAFIL');
  const fixedCols = 2;
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
  sheet.mergeCells(2, 1, 2, totalCols);
  sheet.getCell(2, 1).value = `Período: ${periodLabel} · Vista: ${workspace === 'assistant' ? 'Asistente' : 'Supervisor'}`;
  sheet.getCell(2, 1).font = { size: 10, color: { argb: 'FF64748B' } };

  let rowIdx = 4;
  const supervisors = [...new Set(assistants.map((a) => a.supervisor))].sort((a, b) => a.localeCompare(b));

  for (const supervisor of supervisors) {
    const group = assistants.filter((a) => a.supervisor === supervisor);
    if (group.length === 0) continue;

    const supLabel = sheet.getCell(rowIdx, 1);
    supLabel.value = 'SUPERVISOR:';
    supLabel.fill = SUPERVISOR_LABEL_FILL;
    supLabel.font = HEADER_FONT;
    supLabel.border = THIN_BORDER;

    sheet.mergeCells(rowIdx, 2, rowIdx, totalCols);
    const supName = sheet.getCell(rowIdx, 2);
    supName.value = supervisor;
    supName.font = { bold: true, size: 11 };
    supName.border = THIN_BORDER;
    supName.alignment = { horizontal: 'left', vertical: 'middle' };
    rowIdx += 1;

    const headerRow1 = sheet.getRow(rowIdx);
    headerRow1.getCell(1).value = 'NRO';
    headerRow1.getCell(2).value = 'ASISTENTE';
    for (let i = 0; i < columns.length; i++) {
      const startCol = fixedCols + i * 2 + 1;
      sheet.mergeCells(rowIdx, startCol, rowIdx, startCol + 1);
      headerRow1.getCell(startCol).value = columns[i].headerLabel;
    }
    applyHeaderRow(headerRow1, totalCols);
    rowIdx += 1;

    const headerRow2 = sheet.getRow(rowIdx);
    headerRow2.getCell(1).value = '';
    headerRow2.getCell(2).value = '';
    for (let i = 0; i < columns.length; i++) {
      const startCol = fixedCols + i * 2 + 1;
      headerRow2.getCell(startCol).value = 'SUNAT';
      headerRow2.getCell(startCol + 1).value = 'SUNAFIL';
    }
    applyHeaderRow(headerRow2, totalCols);
    rowIdx += 1;

    let nro = 0;
    for (const assistantRow of group) {
      nro += 1;
      const dataRow = sheet.getRow(rowIdx);
      dataRow.getCell(1).value = nro;
      dataRow.getCell(2).value = assistantRow.assistant;
      dataRow.getCell(2).alignment = { horizontal: 'left', vertical: 'middle' };
      styleCell(dataRow.getCell(1));

      for (let i = 0; i < columns.length; i++) {
        const col = columns[i];
        const cellData = assistantRow.statuses.get(col.key);
        const sunatStatus = aggregateReportStatus(cellData?.sunat ?? []);
        const sunafilStatus = aggregateReportStatus(cellData?.sunafil ?? []);
        const startCol = fixedCols + i * 2 + 1;
        const sunatCell = dataRow.getCell(startCol);
        const sunafilCell = dataRow.getCell(startCol + 1);
        sunatCell.value = sunatStatus;
        sunafilCell.value = sunafilStatus;
        styleCell(sunatCell, sunatStatus === 'OK' ? OK_FILL : PENDIENTE_FILL);
        styleCell(sunafilCell, sunafilStatus === 'OK' ? OK_FILL : PENDIENTE_FILL);
        sunatCell.font = { bold: true };
        sunafilCell.font = { bold: true };
      }
      styleCell(dataRow.getCell(2));
      rowIdx += 1;
    }

    rowIdx += 1;
  }

  sheet.getColumn(1).width = 6;
  sheet.getColumn(2).width = 22;
  for (let c = 3; c <= totalCols; c++) {
    sheet.getColumn(c).width = 11;
  }

  const buffer = await workbook.xlsx.writeBuffer();
  saveAs(
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `reporte-buzones-sunat-${periodYm}.xlsx`,
  );
}
