import ExcelJS from 'exceljs';
import { describe, expect, it, vi } from 'vitest';
import type { PreliminarVentasListRow } from '../services/preliminarVentas';

let saved: Blob | null = null;
vi.mock('file-saver', () => ({ saveAs: (b: Blob) => (saved = b) }));
vi.mock('./excelLetterhead', () => ({ buildExcelLetterhead: async () => undefined }));

import { exportPreliminarVentasReportExcel } from './preliminarVentasExcelExport';

const row = (id: number, slot1: PreliminarVentasListRow['slot1'], slot2: PreliminarVentasListRow['slot2'], suspendida = false): PreliminarVentasListRow => ({
  company_id: id, code: String(id), dig: '0', business_name: `Empresa ${id}`, ruc: `2000000000${id}`, assistant_username: 'ana', suspendida, slot1, slot2,
});

describe('exportPreliminarVentasReportExcel', () => {
  it('pinta el estado de cada entrega con las reglas de color de los demás Excel', async () => {
    const day = { due_date: '2026-10-19' };
    await exportPreliminarVentasReportExcel({
      periodYm: '2026-10',
      workspace: 'supervisor',
      rows: [
        row(1, { ...day, status: 'enviado', timeliness: 'on_time' }, { ...day, status: 'pendiente', timeliness: 'missing' }),
        row(2, { ...day, status: 'enviado', timeliness: 'late' }, { ...day, status: 'registrado', timeliness: 'pending' }),
        row(3, { ...day, status: 'pendiente' }, { ...day, status: 'enviado' }, true),
      ],
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await saved!.arrayBuffer());
    const ws = wb.worksheets[0];
    const fill = (r: number, c: number) => (ws.getRow(r).getCell(c).fill as ExcelJS.FillPattern | undefined)?.fgColor?.argb;
    // columnas: 6-8 = entrega 1 (estado, registrado, enviado); 9-11 = entrega 2
    expect([6, 7, 8].map((c) => fill(5, c))).toEqual(['FFDCFCE7', 'FFDCFCE7', 'FFDCFCE7']); // enviado a tiempo: verde
    expect(fill(5, 9)).toBe('FFFFEDD5'); // pendiente vencido: naranja
    expect(fill(6, 6)).toBe('FFE0F2FE'); // enviado fuera de plazo: celeste
    expect(fill(6, 9)).toBe('FFFFEDD5'); // registrado sin enviar: naranja
    expect([6, 9].map((c) => fill(7, c))).toEqual(['FFFEE2E2', 'FFFEE2E2']); // suspendida: rosado
  });
});
