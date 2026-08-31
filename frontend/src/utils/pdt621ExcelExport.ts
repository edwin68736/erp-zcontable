import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import type { Pdt621ListRow } from '../services/pdt621';
import { pdt621StatusLabel } from '../components/activity/pdt621Config';

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
};

/** Mismo criterio de color que pdt621RowBgClass (tabla en pantalla): verde a tiempo, rojo
 * atrasado/sin declarar, sin color si no aplica regla. */
const ON_TIME_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCFCE7' } };
const LATE_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFECACA' } };

const SIRE_LABEL: Record<string, string> = { si: 'Sí', no: 'No' };

const HEADERS = [
  'CÓDIGO',
  'DÍGITO',
  'RAZÓN SOCIAL',
  'RUC',
  'RÉGIMEN',
  'ASISTENTE',
  'ESTADO',
  '1RA ENTREGA FECHA',
  '1RA ENTREGA HORA',
  'OBSERVACIÓN',
  '2DA ENTREGA FECHA',
  '2DA ENTREGA HORA',
  'FECHA DECLARACIÓN',
  'TOTAL VENTAS',
  'CANT. COMPROBANTES VENTA',
  'TOTAL COMPRAS',
  'CANT. COMPROBANTES COMPRA',
  'IGV',
  'RENTA',
  '¿ENVIÓ SIRE?',
  'FECHA ENVÍO SIRE',
  'MOTIVO NO ENVÍO',
  'ARCHIVOS',
];

const COLUMN_WIDTHS = [8, 8, 32, 13, 10, 16, 15, 14, 11, 26, 14, 11, 14, 13, 13, 13, 13, 11, 11, 11, 14, 22, 10];

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

export async function exportPdt621ReportExcel(options: { periodYm: string; rows: Pdt621ListRow[] }): Promise<void> {
  const { periodYm, rows } = options;
  if (rows.length === 0) {
    throw new Error('No hay datos para exportar.');
  }

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Control Vencimientos PDT 621');
  const totalCols = HEADERS.length;

  sheet.mergeCells(1, 1, 1, totalCols);
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = `CONTROL VENCIMIENTOS PDT 621 — ${periodYm}`;
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
    const rec = row.record;
    const rowFill =
      row.declaration_timeliness === 'on_time'
        ? ON_TIME_FILL
        : row.declaration_timeliness === 'missing' || row.declaration_timeliness === 'late'
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
    // Formato de 3 secciones (positivo;negativo;cero): un 0 real se muestra como "-" (un solo
    // guion), sin dejar de ser un número para filtros/sumas en el Excel.
    const setNum = (v: number | undefined) => {
      const c = dataRow.getCell(col++);
      c.value = v ?? 0;
      c.numFmt = '#,##0.00;-#,##0.00;"-"';
      styleCell(c, rowFill);
      c.alignment = { vertical: 'middle', horizontal: 'right' };
    };
    const setInt = (v: number | undefined) => {
      const c = dataRow.getCell(col++);
      c.value = v ?? 0;
      c.numFmt = '#,##0;-#,##0;"-"';
      styleCell(c, rowFill);
      c.alignment = { vertical: 'middle', horizontal: 'right' };
    };

    setText(row.code || '—', 'center');
    setText(row.dig || '—', 'center');
    setText(row.business_name || '—');
    setText(row.ruc || '—', 'center');
    setText(row.tax_regime || '', 'center');
    setText(row.assistant_username || '—');
    setText(pdt621StatusLabel(row.status), 'center');
    setText(formatDateCell(rec?.primera_entrega_fecha), 'center');
    setText(rec?.primera_entrega_hora || '', 'center');
    setText(rec?.observacion || '');
    setText(formatDateCell(rec?.segunda_entrega_fecha), 'center');
    setText(rec?.segunda_entrega_hora || '', 'center');
    setText(formatDateCell(rec?.fecha_declaracion), 'center');
    setNum(rec?.total_ventas);
    setInt(rec?.cantidad_comprobantes_venta);
    setNum(rec?.total_compras);
    setInt(rec?.cantidad_comprobantes_compra);
    setNum(rec?.igv);
    setNum(rec?.rta);
    setText(rec?.envio_sire ? (SIRE_LABEL[rec.envio_sire] ?? rec.envio_sire) : '', 'center');
    setText(formatDateCell(rec?.fecha_envio_sire), 'center');
    setText(rec?.motivo_no_envio || '');
    setInt(row.attachment_count);

    rowIdx += 1;
  }

  COLUMN_WIDTHS.forEach((w, i) => {
    sheet.getColumn(i + 1).width = w;
  });
  sheet.views = [{ state: 'frozen', xSplit: 0, ySplit: 4 }];

  const buffer = await workbook.xlsx.writeBuffer();
  saveAs(
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `reporte-pdt621-${periodYm}.xlsx`,
  );
}
