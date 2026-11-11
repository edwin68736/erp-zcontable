import { describe, expect, it } from 'vitest';
import type { RheSolItem } from '../../../services/rheSol';
import { rheSolTxt, totalsByMoneda } from './rhSolUi';

const item = (over: Partial<RheSolItem>): RheSolItem => ({
  fec_emision: '2026-06-04', tipo: 'RH', comprobante: 'E001-1', estado: 'NO ANULADO', anulado: false, emisor_tipo_doc: 'RUC', emisor_doc: '10730328716',
  emisor_nombre: 'X', tipo_renta: 'A', gratuito: false, descripcion: '', observacion: '', moneda: 'PEN', renta_bruta: 100, impuesto_renta: 8, renta_neta: 92,
  monto_pendiente: 0, ...over,
});

describe('totalsByMoneda', () => {
  it('suma por moneda sin mezclar soles y dólares', () => {
    const t = totalsByMoneda([item({}), item({ comprobante: 'E001-2', renta_bruta: 50, impuesto_renta: 0, renta_neta: 50 }), item({ moneda: 'USD', renta_bruta: 10, impuesto_renta: 0, renta_neta: 10 })]);
    expect(t).toEqual([
      { moneda: 'PEN', bruta: 150, impuesto: 8, neta: 142, cantidad: 2 },
      { moneda: 'USD', bruta: 10, impuesto: 0, neta: 10, cantidad: 1 },
    ]);
  });

  it('deja fuera los anulados y las notas de crédito', () => {
    const t = totalsByMoneda([item({}), item({ anulado: true, estado: 'ANULADO' }), item({ tipo: 'NC' })]);
    expect(t).toEqual([{ moneda: 'PEN', bruta: 100, impuesto: 8, neta: 92, cantidad: 1 }]);
  });

  it('sin comprobantes vigentes no hay totales', () => {
    expect(totalsByMoneda([])).toEqual([]);
    expect(totalsByMoneda([item({ anulado: true })])).toEqual([]);
  });
});

describe('rheSolTxt', () => {
  it('arma el reporte con las 16 columnas de SUNAT y «|» al final de cada línea', () => {
    const txt = rheSolTxt([
      item({ fec_emision: '2026-10-06', comprobante: 'E001-129', emisor_doc: '10454539252', emisor_nombre: 'MENDOZA ZAMORA LUZ MARINA', descripcion: 'REDACCION DE INFORMES', renta_bruta: 500, impuesto_renta: 0, renta_neta: 500 }),
      item({ moneda: 'USD', gratuito: true, anulado: true, estado: 'ANULADO', observacion: 'MODALIDAD MENSUAL', renta_bruta: 1900.5, monto_pendiente: 100 }),
    ]);
    const lines = txt.split('\r\n');
    expect(lines).toHaveLength(4); // encabezado + 2 filas + línea final vacía
    expect(lines[0].split('|')).toHaveLength(17); // 16 columnas + el cierre
    expect(lines[0].startsWith('Fecha de Emisión|Tipo Doc. Emitido|')).toBe(true);
    expect(lines[1]).toBe('06/10/2026|RH|E001-129|NO ANULADO|RUC|10454539252|MENDOZA ZAMORA LUZ MARINA|A|NO|REDACCION DE INFORMES|-|SOLES|500.00|0.00|500.00|0.00|');
    expect(lines[2]).toContain('|ANULADO|');
    expect(lines[2]).toContain('|SI|-|MODALIDAD MENSUAL|DOLARES|1900.50|8.00|92.00|100.00|');
  });
});
