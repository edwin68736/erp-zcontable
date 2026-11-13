import { describe, expect, it } from 'vitest';
import type { SpotFilter } from '../../../services/spot';
import { SPOT_MAX_DAYS, aniosDisponibles, filterError, mesesDelAnio, pagosParaCuenta, periodoDe, rangoTexto, resumenTexto } from './spotUi';

const base: SpotFilter = { tipo_cuenta: '1', tipo_pago: 'individuales', modo: 'fecha', desde: '2026-10-15', hasta: '2026-11-13', periodo: '' };

describe('detracciones: filtros como los de SUNAT', () => {
  it('los tipos de pago dependen del tipo de cuenta', () => {
    expect(pagosParaCuenta('1')).toEqual(['individuales', 'masivos', 'pasajeros']);
    expect(pagosParaCuenta('2')).toEqual(['individuales']);
    expect(pagosParaCuenta('3')).toEqual(['individuales', 'masivos']);
  });

  it('por fecha: máximo 30 días, sin fechas al revés ni futuras', () => {
    expect(SPOT_MAX_DAYS).toBe(30);
    expect(filterError(base, '2026-11-13')).toBe('');
    expect(filterError({ ...base, desde: '2026-10-14' }, '2026-11-13')).toContain('30 días');
    expect(filterError({ ...base, desde: '2026-11-10', hasta: '2026-11-01' }, '2026-11-13')).toContain('no puede ser mayor');
    expect(filterError({ ...base, desde: '2026-11-10', hasta: '2026-11-14' }, '2026-11-13')).toContain('posterior a hoy');
    expect(filterError({ ...base, desde: '' }, '2026-11-13')).toContain('las dos fechas');
  });

  it('por periodo: solo pagos individuales y con un periodo AAAAMM', () => {
    const p: SpotFilter = { ...base, modo: 'periodo', periodo: '202608' };
    expect(filterError(p, '2026-11-13')).toBe('');
    expect(filterError({ ...p, periodo: '' }, '2026-11-13')).toContain('año y el mes');
    expect(filterError({ ...p, tipo_pago: 'masivos' }, '2026-11-13')).toContain('solo se consultan los pagos individuales');
  });

  it('un tipo de pago que la cuenta no ofrece es un error', () => {
    expect(filterError({ ...base, tipo_cuenta: '2', tipo_pago: 'masivos' }, '2026-11-13')).toContain('no existe para el tipo de cuenta');
  });

  it('año y mes: ningún mes posterior al actual', () => {
    const hoy = new Date(2026, 10, 13); // 13/11/2026
    expect(aniosDisponibles(hoy, 3)).toEqual([2026, 2025, 2024]);
    expect(mesesDelAnio(2026, hoy)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(mesesDelAnio(2025, hoy)).toHaveLength(12);
    expect(periodoDe(2026, 8)).toBe('202608');
    expect(periodoDe(2026, 11)).toBe('202611');
  });

  it('textos del historial como la referencia', () => {
    expect(rangoTexto({ modo: 'periodo', periodo: '202608', desde: '', hasta: '' })).toBe('Periodo: 202608');
    expect(rangoTexto({ modo: 'fecha', periodo: '', desde: '2026-11-01', hasta: '2026-11-13' })).toBe('01/11/2026 – 13/11/2026');
    expect(rangoTexto({ modo: 'fecha', periodo: '', desde: '2026-11-04', hasta: '2026-11-04' })).toBe('04/11/2026');
    expect(resumenTexto({ status: 'listo', total: 3 })).toBe('Descarga Finalizada: 3 detracciones');
    expect(resumenTexto({ status: 'listo', total: 1 })).toBe('Descarga Finalizada: 1 detracción');
    expect(resumenTexto({ status: 'sin_datos', total: 0 })).toContain('No se encontraron registros');
  });
});
