import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import type { Pdt601ListRow } from '../services/pdt601';
import { pdt601StatusLabel } from '../components/activity/pdt601Config';

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
};

/** Mismo criterio de color que pdt601RowBgClass (tabla en pantalla): gris si no tiene planilla,
 * verde si se entregó a tiempo, rojo si sigue pendiente o se entregó tarde. */
const SIN_PLANILLA_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
const ON_TIME_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCFCE7' } };
const LATE_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFECACA' } };

const HEADERS = [
  'CÓDIGO',
  'DÍGITO',
  'RAZÓN SOCIAL',
  'RUC',
  'ASISTENTE',
  'ESTADO',
  'N° TRAB. ONP',
  'N° TRAB. AFP',
  'N° TRAB. TOTAL',
  'ESSALUD',
  'ONP',
  'AFP',
  'SIS',
  '4TA',
  '5TA',
  'RH',
  'TOTAL APORTES',
  'FECHA ENTREGA',
  'HORA ENTREGA',
  'OBSERVACIONES',
  'FECHA DECL. PDT',
  'NPS',
  'TICKET AFP',
  'ESTADO ENVÍO BOLETAS',
  'FECHA ENVÍO NPS/TICKETS/BOLETAS',
];

const COLUMN_WIDTHS = [8, 8, 32, 13, 16, 15, 9, 9, 10, 11, 11, 11, 11, 11, 11, 11, 13, 13, 13, 26, 15, 12, 13, 18, 20];

function formatDateCell(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

function styleCell(cell: ExcelJS.Cell, fill?: ExcelJS.Fill) {
  cell.border = THIN_BORDER;
  if (fill) cell.fill = fill;
}

export async function exportPdt601ReportExcel(options: { periodYm: string; rows: Pdt601ListRow[] }): Promise<void> {
  const { periodYm, rows } = options;
  if (rows.length === 0) {
    throw new Error('No hay datos para exportar.');
  }

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Control Planillas PDT 601');
  const totalCols = HEADERS.length;

  sheet.mergeCells(1, 1, 1, totalCols);
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = `CONTROL PLANILLAS PDT 601 — ${periodYm}`;
  titleCell.font = { size: 14, bold: true };
  titleCell.alignment = { horizontal: 'left' };

  sheet.mergeCells(2, 1, 2, totalCols);
  sheet.getCell(2, 1).value = `Período: ${periodYm} · ${rows.length} empresa${rows.length === 1 ? '' : 's'}`;
  sheet.getCell(2, 1).font = { size: 10, color: { argb: 'FF64748B' } };

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
    const pl = row.planilla;
    const sinPlanilla = !!pl?.sin_planilla;
    const rowFill = sinPlanilla
      ? SIN_PLANILLA_FILL
      : row.timeliness === 'on_time'
        ? ON_TIME_FILL
        : row.timeliness === 'missing' || row.timeliness === 'late'
          ? LATE_FILL
          : undefined;

    const dataRow = sheet.getRow(rowIdx);
    let col = 1;
    const setText = (v: string, align: 'left' | 'center' = 'left') => {
      const c = dataRow.getCell(col++);
      c.value = v;
      styleCell(c, rowFill);
      c.alignment = { vertical: 'middle', horizontal: align, wrapText: align === 'left' };
    };
    // "Sin planilla" deja los campos numéricos en blanco (no aplica) en vez de 0 — igual que la
    // tabla en pantalla, que directamente los oculta.
    // Formato de 3 secciones (positivo;negativo;cero): un 0 real se muestra como "-" (un solo
    // guion), sin dejar de ser un número para filtros/sumas en el Excel.
    const setNum = (v: number | undefined) => {
      const c = dataRow.getCell(col++);
      if (!sinPlanilla) {
        c.value = v ?? 0;
        c.numFmt = '#,##0.00;-#,##0.00;"-"';
      }
      styleCell(c, rowFill);
      c.alignment = { vertical: 'middle', horizontal: 'right' };
    };
    const setInt = (v: number | undefined) => {
      const c = dataRow.getCell(col++);
      if (!sinPlanilla) {
        c.value = v ?? 0;
        c.numFmt = '#,##0;-#,##0;"-"';
      }
      styleCell(c, rowFill);
      c.alignment = { vertical: 'middle', horizontal: 'right' };
    };

    setText(row.code || '—', 'center');
    setText(row.dig || '—', 'center');
    setText(row.business_name || '—');
    setText(row.ruc || '—', 'center');
    setText(row.assistant_username || '—');
    setText(pdt601StatusLabel(row.status), 'center');
    setInt(pl?.trabajadores_onp);
    setInt(pl?.trabajadores_afp);
    setInt(pl?.trabajadores_total);
    setNum(pl?.essalud);
    setNum(pl?.onp);
    setNum(pl?.afp);
    setNum(pl?.sis);
    setNum(pl?.rta_4ta);
    setNum(pl?.rta_5ta);
    setNum(pl?.rh);
    setNum(pl?.total_aportes);
    setText(formatDateCell(pl?.fecha_entrega), 'center');
    setText(pl?.hora_entrega || '', 'center');
    setText(pl?.observaciones || '');
    setText(formatDateCell(pl?.fecha_declaracion_pdt), 'center');
    setText(pl?.nps || '', 'center');
    setText(pl?.ticket_afp || '', 'center');
    setText(pl?.estado_envio_boletas || '', 'center');
    setText(formatDateCell(pl?.fecha_envio_nps_tickets_boletas), 'center');

    rowIdx += 1;
  }

  COLUMN_WIDTHS.forEach((w, i) => {
    sheet.getColumn(i + 1).width = w;
  });
  sheet.views = [{ state: 'frozen', xSplit: 0, ySplit: 4 }];

  const buffer = await workbook.xlsx.writeBuffer();
  saveAs(
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `reporte-pdt601-${periodYm}.xlsx`,
  );
}
