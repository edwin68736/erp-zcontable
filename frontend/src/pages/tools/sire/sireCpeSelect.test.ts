import { describe, expect, it } from 'vitest';
import { cpeLineKey, type SireCpeLine } from '../../../services/sire';
import { CPE_BATCH, batchOf, chunk, countPending, fmtCpeTotal, isPending, lineProgress, nextPending, progressLabel } from './sireCpeSelect';

const line = (n: number, over: Partial<SireCpeLine> = {}): SireCpeLine => ({
  ruc: '20100000001',
  tipo: '01',
  serie: 'F001',
  numero: String(n),
  has_pdf: false,
  has_xml: false,
  has_cdr: false,
  ...over,
});
const ALL = ['pdf', 'xml', 'cdr'] as const;

describe('descarga de CPE por tandas', () => {
  it('el tope por tanda es 250 (igual que el servidor)', () => {
    expect(CPE_BATCH).toBe(250);
  });

  it('el avance depende de los formatos elegidos', () => {
    const soloPdf = line(1, { has_pdf: true, status: 'listo' });
    expect(lineProgress(soloPdf, ['pdf'])).toBe('completo');
    expect(lineProgress(soloPdf, [...ALL])).toBe('parcial');
    expect(lineProgress(soloPdf, ['xml'])).toBe('pendiente');
    expect(lineProgress(line(2), [...ALL])).toBe('pendiente');
    expect(lineProgress(line(3, { status: 'en_proceso' }), [...ALL])).toBe('en_proceso');
    // SUNAT dijo que no hay archivos: no se vuelve a pedir; un error sí se puede reintentar.
    expect(lineProgress(line(4, { status: 'sin_cpe' }), [...ALL])).toBe('sin_cpe');
    expect(lineProgress(line(5, { status: 'error' }), [...ALL])).toBe('pendiente');
    expect(isPending(line(4, { status: 'sin_cpe' }), [...ALL])).toBe(false);
    expect(isPending(line(5, { status: 'error' }), [...ALL])).toBe(true);
  });

  it('marca los primeros 250 pendientes y salta los ya descargados', () => {
    const lines = Array.from({ length: 600 }, (_, i) => line(i + 1, i < 100 ? { has_pdf: true, has_xml: true, has_cdr: true, status: 'listo' } : {}));
    const first = nextPending(lines, [...ALL]);
    expect(first).toHaveLength(250);
    expect(first[0]).toBe(cpeLineKey(lines[100])); // los 100 primeros ya están completos
    expect(first[249]).toBe(cpeLineKey(lines[349]));
    expect(countPending(lines, [...ALL])).toBe(500);
    // Con otro límite o sin pendientes.
    expect(nextPending(lines, [...ALL], 10)).toHaveLength(10);
    expect(nextPending(lines.slice(0, 100), [...ALL])).toEqual([]);
  });

  it('«los siguientes»: al terminar una tanda, lo que sigue son los próximos 250', () => {
    const lines = Array.from({ length: 600 }, (_, i) => line(i + 1));
    const tanda1 = nextPending(lines, [...ALL]);
    const hechos = new Set(tanda1);
    const despues = lines.map((l) =>
      hechos.has(cpeLineKey(l))
        ? {
            ...l,
            has_pdf: true,
            has_xml: true,
            has_cdr: true,
            status: 'listo' as const,
          }
        : l,
    );
    const tanda2 = nextPending(despues, [...ALL]);
    expect(tanda2).toHaveLength(250);
    expect(tanda2.some((k) => hechos.has(k))).toBe(false);
    expect(tanda2[0]).toBe(cpeLineKey(lines[250]));
    expect(countPending(despues, [...ALL])).toBe(350);
  });

  it('de lo marcado solo se manda una tanda, en el orden de la tabla', () => {
    const lines = Array.from({ length: 400 }, (_, i) => line(i + 1));
    const picked = new Set(lines.map(cpeLineKey)); // «todos los pendientes»
    const b = batchOf(lines, picked);
    expect(b).toHaveLength(250);
    expect(b[0]).toBe(cpeLineKey(lines[0]));
    expect(batchOf(lines, new Set([cpeLineKey(lines[5])]))).toEqual([cpeLineKey(lines[5])]);
  });

  it('parte una lista en tandas', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
  });

  it('textos de la columna «Descargado» y del total', () => {
    expect(progressLabel(line(1, { has_pdf: true, has_cdr: true, status: 'listo' }), [...ALL])).toEqual({ text: 'Parcial (PDF, CDR)', tone: 'warn' });
    expect(
      progressLabel(
        line(1, {
          has_pdf: true,
          has_xml: true,
          has_cdr: true,
          status: 'listo',
        }),
        [...ALL],
      ),
    ).toEqual({ text: 'Completo', tone: 'ok' });
    expect(progressLabel(line(1), [...ALL]).text).toBe('Pendiente');
    expect(progressLabel(line(1, { status: 'error' }), [...ALL]).text).toContain('reintentar');
    expect(fmtCpeTotal('1234.5')).toBe('1,234.50');
    expect(fmtCpeTotal('1,234.50')).toBe('1,234.50');
    expect(fmtCpeTotal(undefined)).toBe('—');
    expect(fmtCpeTotal('abc')).toBe('abc');
  });
});
