import { describe, expect, it } from 'vitest';
import { parseSunatAmount } from './sunatAmount';

describe('importes de SUNAT', () => {
  it('formato peruano: punto de miles y coma decimal', () => {
    expect(parseSunatAmount('78.000,00')).toBe(78000);
    expect(parseSunatAmount('3,90')).toBe(3.9);
    expect(parseSunatAmount('0,10')).toBe(0.1);
    expect(parseSunatAmount('1.234.567,89')).toBe(1234567.89);
    expect(parseSunatAmount('-1.250,50')).toBe(-1250.5);
  });

  it('formato inglés', () => {
    expect(parseSunatAmount('78,000.00')).toBe(78000);
    expect(parseSunatAmount('1,000.00')).toBe(1000);
    expect(parseSunatAmount('0.05')).toBe(0.05);
    expect(parseSunatAmount('93.00')).toBe(93);
  });

  it('un solo separador en grupos de tres son miles', () => {
    expect(parseSunatAmount('1,234')).toBe(1234);
    expect(parseSunatAmount('78.000')).toBe(78000);
    expect(parseSunatAmount('400')).toBe(400);
  });

  it('S/ y espacios no estorban; lo que no es número da null', () => {
    expect(parseSunatAmount(' S/ 774.0 ')).toBe(774);
    expect(parseSunatAmount('')).toBeNull();
    expect(parseSunatAmount(undefined)).toBeNull();
    expect(parseSunatAmount('abc')).toBeNull();
  });
});
