import { describe, expect, it } from 'vitest';
import type { ItfTable } from '../../../services/itf';
import type { ItfResult } from '../../../services/itf';
import { addMonths, buildItfWorkbook, colIndex, itfFileName, monthToPeriod, monthsBetween, parseAmount, periodLabel, periodToMonth, summarizeByPeriod } from './itfUi';

const table: ItfTable = {
  titulo: 'Movimientos Acumulados',
  columnas: ['RUC', 'Declarante', 'Periodo', 'Tipo', 'Cod. Oper.', 'Base', 'Impuesto'],
  filas: [
    ['20100000001', 'BANCO UNO', '202606', 'Afecta', '13', '16,000.00', '0.80'],
    ['20100000001', 'BANCO UNO', '202605', 'Afecta', '13', '1,000.00', '0.05'],
    ['20100000001', 'BANCO UNO', '202606', 'Afecta', '15', '13,000.00', '0.65'],
  ],
  registros: 3,
};

describe('itfUi', () => {
  it('convierte periodos y meses', () => {
    expect(periodLabel('202605')).toBe('05/2026');
    expect(periodLabel('xx')).toBe('xx');
    expect(monthToPeriod('2026-05')).toBe('202605');
    expect(periodToMonth('202605')).toBe('2026-05');
    expect(periodToMonth('')).toBe('');
  });

  it('suma y resta meses cruzando de año', () => {
    expect(addMonths('2026-11', -5)).toBe('2026-06');
    expect(addMonths('2026-02', -5)).toBe('2025-09');
    expect(addMonths('2026-12', 1)).toBe('2027-01');
  });

  it('cuenta los meses del rango (ambos incluidos)', () => {
    expect(monthsBetween('2026-01', '2026-01')).toBe(1);
    expect(monthsBetween('2025-11', '2026-02')).toBe(4);
    expect(monthsBetween('2026-03', '2026-01')).toBe(0);
    expect(monthsBetween('', '2026-01')).toBe(0);
  });

  it('lee importes con separador de miles', () => {
    expect(parseAmount('1,000.00')).toBe(1000);
    expect(parseAmount('0.05')).toBe(0.05);
    expect(parseAmount('')).toBe(0);
    expect(parseAmount(undefined)).toBe(0);
  });

  it('encuentra columnas sin importar tildes ni mayúsculas', () => {
    expect(colIndex(table, 'periodo')).toBe(2);
    expect(colIndex(table, 'Cod. Oper.')).toBe(4);
    expect(colIndex(table, 'no existe')).toBe(-1);
  });

  it('resume por periodo, ordenado, con base, impuesto y operaciones', () => {
    const r = summarizeByPeriod(table);
    expect(r.map((x) => x.periodo)).toEqual(['202605', '202606']);
    expect(r[1]).toMatchObject({ operaciones: 2, base: 29000 });
    expect(r[1].impuesto).toBeCloseTo(1.45, 5);
    expect(summarizeByPeriod({ ...table, columnas: ['A', 'B'] })).toEqual([]);
  });
});

const empty: ItfTable = { titulo: '', columnas: [], filas: [], registros: 0 };

describe('Excel del reporte de ITF (la forma de la referencia)', () => {
  const meta = { empresa: 'CORPORACION PILFRUT S.A.C.', ruc: '20611930641' };

  it('sin registros: tres hojas, identificación, encabezado en la fila 5 y totales en la fila 7', () => {
    const res: ItfResult = { desde: '202608', hasta: '202609', documento: '06 - RUC Nro. 20611930641', razon_social: 'CORPORACION PILFRUT S.A.C.', acumulados: empty, contra_asientos: empty, exoneraciones: empty };
    const wb = buildItfWorkbook(res, meta);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Movimientos Acumulados', 'Contra Asientos', 'Exoneraciones']);
    const ws = wb.getWorksheet('Movimientos Acumulados')!;
    expect(ws.getCell('A1').value).toBe('Documento:');
    expect(ws.getCell('B1').value).toBe('06 - RUC Nro. 20611930641');
    expect(ws.getCell('A2').value).toBe('Razón Social:');
    expect(ws.getCell('B2').value).toBe('CORPORACION PILFRUT S.A.C.');
    expect(ws.getRow(5).values).toEqual([undefined, 'RUC', 'Declarante', 'Tipo Doc', 'Contribuyente', 'Período', 'Tipo', 'Movimiento', 'Cod. Oper.', 'Base', 'Impuesto']);
    expect(ws.getCell('A7').value).toBe('Cantidad de registros: 0 Total Impuesto: 0.00 Total Movimientos: 0.00');
  });

  it('con registros: las filas empiezan en la 6, los importes son números y los totales van una fila después', () => {
    const t: ItfTable = {
      titulo: 'Movimientos Acumulados',
      columnas: ['RUC', 'Declarante', 'Tipo Doc', 'Contribuyente', 'Período', 'Tipo', 'Movimiento', 'Cod. Oper.', 'Base', 'Impuesto'],
      filas: [
        ['20100000001', 'BANCO UNO', '06', '20611930641', '202608', 'Afecta', 'Débito', '13', '16,000.00', '0.80'],
        ['20100000001', 'BANCO UNO', '06', '20611930641', '202609', 'Afecta', 'Débito', '15', '13,000.00', '0.65'],
      ],
      registros: 2,
    };
    const res: ItfResult = { desde: '202608', hasta: '202609', documento: '', razon_social: '', acumulados: t, contra_asientos: empty, exoneraciones: empty };
    const ws = buildItfWorkbook(res, meta).getWorksheet('Movimientos Acumulados')!;
    // Sin identificación de SUNAT se arma con la empresa.
    expect(ws.getCell('B1').value).toBe('06 - RUC Nro. 20611930641');
    expect(ws.getCell('B2').value).toBe('CORPORACION PILFRUT S.A.C.');
    expect(ws.getCell('I6').value).toBe(16000);
    expect(ws.getCell('J7').value).toBe(0.65);
    expect(ws.getCell('A8').value).toBeNull();
    // Sin totales de SUNAT se suman de las filas.
    expect(ws.getCell('A9').value).toBe('Cantidad de registros: 2 Total Impuesto: 1.45 Total Movimientos: 29000.00');
  });

  it('el archivo se llama como el de la referencia', () => {
    expect(itfFileName('20611930641', { desde: '202608', hasta: '202609' })).toBe('ITF_20611930641_202608-202609.xlsx');
  });
});
