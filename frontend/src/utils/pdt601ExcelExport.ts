import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import type { Pdt601ListRow } from '../services/pdt601';
import { pdt601StatusLabel } from '../components/activity/pdt601Config';
import { buildExcelLetterhead, type ExcelLetterheadWorkspace } from './excelLetterhead';

// Fuente única para TODO el Excel (título, encabezado y datos) — a pedido: "Aptos Narrow" 10pt en
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

/** Mismo criterio de color que pdt601RowBgClass (tabla en pantalla): morado si está suspendida,
 * gris si no tiene planilla, verde si se entregó a tiempo, rojo si sigue pendiente o se entregó
 * tarde. */
const SIN_PLANILLA_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
const SUSPENDIDA_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDE9FE' } };
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
  'SCTR',
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

const COLUMN_WIDTHS = [8, 8, 32, 13, 16, 15, 9, 9, 10, 11, 11, 11, 11, 11, 11, 11, 11, 13, 13, 13, 26, 15, 12, 13, 18, 20];

function formatDateCell(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

function styleCell(cell: ExcelJS.Cell, fill?: ExcelJS.Fill) {
  cell.font = { name: FONT_NAME, size: FONT_SIZE };
  cell.border = THIN_BORDER;
  if (fill) cell.fill = fill;
}

export async function exportPdt601ReportExcel(options: {
  periodYm: string;
  rows: Pdt601ListRow[];
  workspace: ExcelLetterheadWorkspace;
}): Promise<void> {
  const { periodYm, rows, workspace } = options;
  if (rows.length === 0) {
    throw new Error('No hay datos para exportar.');
  }

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Control Planillas PDT 601');
  const totalCols = HEADERS.length;

  await buildExcelLetterhead({
    sheet,
    totalCols,
    title: `CONTROL DE DECLARACIONES PDT 601 — PLANILLA ELECTRÓNICA${
      workspace === 'supervisor' ? ' — SUPERVISORES' : ' — ASISTENTES'
    }`,
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
    const pl = row.planilla;
    const sinPlanilla = !!pl?.sin_planilla;
    const suspendida = !!pl?.suspendida;
    // "Suspendida" tiene prioridad sobre "sin planilla" (mutuamente excluyentes) y bloquea
    // CUALQUIER otro dato — ver Pdt601DetailPage.tsx.
    const blocked = suspendida || sinPlanilla;
    const rowFill = suspendida
      ? SUSPENDIDA_FILL
      : sinPlanilla
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
    // "Sin planilla"/"suspendida" dejan los campos numéricos en blanco (no aplica) en vez de 0 —
    // igual que la tabla en pantalla, que directamente los oculta.
    // Formato de 3 secciones (positivo;negativo;cero): un 0 real se muestra como "-" (un solo
    // guion), sin dejar de ser un número para filtros/sumas en el Excel.
    const setNum = (v: number | undefined) => {
      const c = dataRow.getCell(col++);
      if (!blocked) {
        c.value = v ?? 0;
        c.numFmt = '#,##0.00;-#,##0.00;"-"';
      }
      styleCell(c, rowFill);
      c.alignment = { vertical: 'middle', horizontal: 'right' };
    };
    const setInt = (v: number | undefined) => {
      const c = dataRow.getCell(col++);
      if (!blocked) {
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
    // Igual que la tabla en pantalla: "sin_planilla"/"suspendida" no son estados reales de la
    // declaración, pero se muestran en su lugar para no decir "Pendiente"/"Aprobado" en una
    // empresa sin planilla o suspendida.
    setText(pdt601StatusLabel(suspendida ? 'suspendida' : sinPlanilla ? 'sin_planilla' : row.status), 'center');
    setInt(pl?.trabajadores_onp);
    setInt(pl?.trabajadores_afp);
    setInt(pl?.trabajadores_total);
    setNum(pl?.essalud);
    setNum(pl?.onp);
    setNum(pl?.afp);
    setNum(pl?.sis);
    setNum(pl?.rta_4ta);
    setNum(pl?.rta_5ta);
    setNum(pl?.sctr);
    setNum(pl?.rh);
    setNum(pl?.total_aportes);
    // Sin planilla/suspendida no hay seguimiento que registrar (ver Pdt601DetailPage.tsx): estas
    // columnas quedan en blanco aunque el dato guardado tuviera algo (defensivo ante registros
    // previos a este fix, que sí podían arrastrar una fecha/hora de entrega autocompletada por
    // error). Observaciones NO se blanquea: en "suspendida" el backend ya fuerza ahí la nota fija
    // "Empresa suspendida", que sí debe verse acá.
    setText(blocked ? '' : formatDateCell(pl?.fecha_entrega), 'center');
    setText(blocked ? '' : pl?.hora_entrega || '', 'center');
    setText(pl?.observaciones || '');
    setText(blocked ? '' : formatDateCell(pl?.fecha_declaracion_pdt), 'center');
    setText(blocked ? '' : pl?.nps || '', 'center');
    setText(blocked ? '' : pl?.ticket_afp || '', 'center');
    setText(blocked ? '' : pl?.estado_envio_boletas || '', 'center');
    setText(blocked ? '' : formatDateCell(pl?.fecha_envio_nps_tickets_boletas), 'center');

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
