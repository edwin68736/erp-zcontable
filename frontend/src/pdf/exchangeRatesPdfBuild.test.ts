import { writeFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import type { ExchangeMonth } from '../services/exchangeRates';
import { buildExchangeRatesPdf, exchangeRatesPdfFileName } from './exchangeRatesPdfBuild';

// Octubre de 2026 (valores del calendario de SUNAT de prueba).
const october: ExchangeMonth = {
  year: 2026,
  month: 10,
  currency: 'USD',
  missing: [],
  fetched: 0,
  days: Array.from({ length: 31 }, (_, i) => ({
    currency: 'USD',
    date: `2026-10-${String(i + 1).padStart(2, '0')}`,
    compra: 3.423 + ((i * 7) % 36) / 1000,
    venta: 3.431 + ((i * 7) % 36) / 1000,
  })),
};

describe('exchangeRatesPdfBuild', () => {
  it('arma el nombre del archivo', () => {
    expect(exchangeRatesPdfFileName(2026, 10)).toBe('tipo-de-cambio-2026-10.pdf');
    expect(exchangeRatesPdfFileName(2027, 1)).toBe('tipo-de-cambio-2027-01.pdf');
  });

  it('genera un PDF de una página A4 horizontal con el calendario del mes', async () => {
    const bytes = await buildExchangeRatesPdf(october, { firmName: 'Estudio Contable' });
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe('%PDF-');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    const { width, height } = doc.getPage(0).getSize();
    expect(width).toBeGreaterThan(height);
    // Para revisar el diseño a ojo: PDF_OUT=ruta.pdf npx vitest run src/pdf/exchangeRatesPdfBuild.test.ts
    if (process.env.PDF_OUT) writeFileSync(process.env.PDF_OUT, bytes);
  });

  it('un mes sin datos también genera el PDF (solo la cuadrícula)', async () => {
    const bytes = await buildExchangeRatesPdf({ ...october, month: 2, days: [] });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });
});
