import { describe, expect, it } from 'vitest';
import type { DamItem } from '../../../services/dam';
import { filterDams, fmtDamAmount, hasRegularizacion } from './damUi';

const dam = (n: string, over: Partial<DamItem> = {}): DamItem => ({
  dam: `118-2026-40-${n}`,
  fec_numeracion: '15/10/2026',
  despachador: 'AGENCIA DE ADUANA UNO S.A.',
  exportador: 'EMPRESA DE PRUEBA S.A.C.',
  consignatario: 'IMPORT CO LLC',
  tipo_embarque: 'TOTAL',
  clausula_venta: 15234.5,
  valor_aduana: 14980.25,
  ...over,
});

describe('damUi', () => {
  it('formatea importes con dos decimales', () => {
    expect(fmtDamAmount(15234.5)).toMatch(/15[\s.,]?234[.,]50$/);
    expect(fmtDamAmount(0)).toMatch(/0[.,]00$/);
  });

  it('filtra por DAM, exportador, consignatario, despachador y embarque sin distinguir mayúsculas', () => {
    const items = [dam('000123'), dam('000140', { consignatario: 'OTRO IMPORT INC', tipo_embarque: 'PARCIAL' })];
    expect(filterDams(items, '')).toHaveLength(2);
    expect(filterDams(items, '  ')).toHaveLength(2);
    expect(filterDams(items, '000140').map((d) => d.dam)).toEqual(['118-2026-40-000140']);
    expect(filterDams(items, 'otro import')).toHaveLength(1);
    expect(filterDams(items, 'parcial')).toHaveLength(1);
    expect(filterDams(items, 'agencia')).toHaveLength(2);
    expect(filterDams(items, 'no existe')).toHaveLength(0);
  });

  it('muestra la columna de regularización solo si alguna DAM la trae', () => {
    expect(hasRegularizacion([dam('1'), dam('2', { regularizacion: '  ' })])).toBe(false);
    expect(hasRegularizacion([dam('1'), dam('2', { regularizacion: 'SI' })])).toBe(true);
    expect(hasRegularizacion([])).toBe(false);
  });
});
