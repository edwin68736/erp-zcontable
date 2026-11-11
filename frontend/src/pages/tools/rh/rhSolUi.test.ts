import { describe, expect, it } from 'vitest';
import type { RheSolItem } from '../../../services/rheSol';
import { totalsByMoneda } from './rhSolUi';

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
