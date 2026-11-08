import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { mergePeriodExcels, periodsBetween } from './sireExcel';

async function sample(period: string, total: number): Promise<Blob> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Reporte Ventas');
  ws.addRow(['Ruc', 'Periodo', 'Nro CP', 'Total CP']);
  ws.addRow(['20123456789', period, 516, total]);
  return new Blob([await wb.xlsx.writeBuffer()]);
}

describe('mergePeriodExcels', () => {
  it('una hoja por periodo con los mismos valores y tipos', async () => {
    const merged = await mergePeriodExcels([
      { period: '202609', blob: await sample('202609', 100.5) },
      { period: '202610', blob: await sample('202610', 200) },
    ]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await merged.arrayBuffer());
    expect(wb.worksheets.map((w) => w.name)).toEqual(['202609', '202610']);
    const ws = wb.getWorksheet('202610')!;
    expect(ws.getRow(1).values).toEqual([undefined, 'Ruc', 'Periodo', 'Nro CP', 'Total CP']);
    expect(ws.getRow(2).getCell(1).value).toBe('20123456789'); // texto
    expect(ws.getRow(2).getCell(3).value).toBe(516); // número
    expect(ws.getRow(2).getCell(4).value).toBe(200);
  });
});

describe('periodsBetween', () => {
  it('recorre meses y cruza de año', () => {
    expect(periodsBetween('202611', '202702')).toEqual(['202611', '202612', '202701', '202702']);
    expect(periodsBetween('202610', '202610')).toEqual(['202610']);
    expect(periodsBetween('202611', '202610')).toEqual([]);
  });
});
