import { describe, expect, it } from 'vitest';
import { formatAmount, formatDate, formatDateTime, formatDateTimeSeconds, formatMoneyPen, formatTime } from './format';

describe('formatAmount / formatMoneyPen', () => {
  it('separa miles con coma y siempre muestra 2 decimales', () => {
    expect(formatAmount(12500.5)).toBe('12,500.50');
    expect(formatAmount(0)).toBe('0.00');
    expect(formatAmount(999.999)).toBe('1,000.00');
    expect(formatAmount(1234567.891)).toBe('1,234,567.89');
    expect(formatMoneyPen(12500.5)).toBe('S/ 12,500.50');
  });

  it('negativos y cadenas numéricas', () => {
    expect(formatAmount(-1500)).toBe('-1,500.00');
    expect(formatAmount('2500.5')).toBe('2,500.50');
  });

  it('vacío, nulo o no numérico se ve como cero y no rompe la pantalla', () => {
    expect(formatAmount(null)).toBe('0.00');
    expect(formatAmount(undefined)).toBe('0.00');
    expect(formatAmount('abc')).toBe('0.00');
    expect(formatAmount(Number.NaN)).toBe('0.00');
    expect(formatMoneyPen(undefined)).toBe('S/ 0.00');
  });
});

describe('fechas en hora de Perú', () => {
  // 2026-11-08 20:30:45 UTC = 15:30:45 en Lima (UTC-5), sin importar la zona ni el idioma de la PC.
  const iso = '2026-11-08T20:30:45Z';

  it('día, hora y segundos con formato fijo dd/MM/yyyy y 24 h', () => {
    expect(formatDate(iso)).toBe('08/11/2026');
    expect(formatDateTime(iso)).toBe('08/11/2026 15:30');
    expect(formatDateTimeSeconds(iso)).toBe('08/11/2026 15:30:45');
    expect(formatTime(iso)).toBe('15:30');
  });

  it('cerca de medianoche usa el día de Perú, no el UTC', () => {
    expect(formatDate('2026-11-09T03:00:00Z')).toBe('08/11/2026'); // 22:00 del 8 en Lima
    expect(formatDate('2026-11-09T05:00:00Z')).toBe('09/11/2026'); // 00:00 del 9 en Lima
  });

  it('acepta Date y números; vacío o inválido es «—»', () => {
    expect(formatDate(new Date(iso))).toBe('08/11/2026');
    expect(formatDateTime(Date.parse(iso))).toBe('08/11/2026 15:30');
    expect(formatDate('')).toBe('—');
    expect(formatDate(null)).toBe('—');
    expect(formatDate(undefined)).toBe('—');
    expect(formatDateTime('no es fecha')).toBe('—');
  });
});
