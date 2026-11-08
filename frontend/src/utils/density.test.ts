import { describe, expect, it } from 'vitest';
import { DENSITY_OPTIONS, parseDensityPref, resolveDensity } from './density';

describe('density', () => {
  it('lee la elección guardada; lo desconocido es automática', () => {
    expect(parseDensityPref('compact')).toBe('compact');
    expect(parseDensityPref('comfortable')).toBe('comfortable');
    expect(parseDensityPref('auto')).toBe('auto');
    expect(parseDensityPref(null)).toBe('auto');
    expect(parseDensityPref('otra')).toBe('auto');
  });

  it('una elección explícita manda sobre el tamaño de la ventana', () => {
    expect(resolveDensity('compact', 2560, 1440)).toBe('compact');
    expect(resolveDensity('comfortable', 1024, 600)).toBe('comfortable');
  });

  it('en automática, compacta en pantallas pequeñas y cómoda en las amplias', () => {
    expect(resolveDensity('auto', 1310, 690)).toBe('compact'); // portátil al 125 %
    expect(resolveDensity('auto', 1920, 700)).toBe('compact'); // ancha pero baja
    expect(resolveDensity('auto', 1499, 1000)).toBe('compact');
    expect(resolveDensity('auto', 1920, 1080)).toBe('comfortable');
    expect(resolveDensity('auto', 1500, 800)).toBe('comfortable');
  });

  it('ofrece las tres opciones', () => {
    expect(DENSITY_OPTIONS.map((o) => o.id)).toEqual(['auto', 'comfortable', 'compact']);
  });
});
