import JSZip from 'jszip';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RheSolItem } from '../../../services/rheSol';

const saved: { blob: Blob; name: string }[] = [];
vi.mock('file-saver', () => ({ saveAs: (blob: Blob, name: string) => saved.push({ blob, name }) }));
const files = vi.fn();
vi.mock('../../../services/rheSol', () => ({ rheSolService: { files: (...a: unknown[]) => files(...a) } }));

import { RH_BATCH, RH_NO_FORMATS, isPdfPending, nextPdfPending, runRhDownloads } from './rhProcess';

const item = (n: number): RheSolItem => ({
  fec_emision: '2026-10-14', tipo: 'RH', comprobante: `E001-${n}`, estado: 'NO ANULADO', anulado: false, emisor_tipo_doc: 'RUC', emisor_doc: '10737771704',
  emisor_nombre: 'ROCHA', tipo_renta: 'A', gratuito: false, descripcion: 'X', observacion: '', moneda: 'PEN', renta_bruta: 50, impuesto_renta: 0, renta_neta: 50, monto_pendiente: 0,
});

async function serverZip(entries: Record<string, string>): Promise<Blob> {
  const z = new JSZip();
  for (const [k, v] of Object.entries(entries)) z.file(k, v);
  return z.generateAsync({ type: 'blob' });
}

const base = { companyId: 1, empresa: 'Z CONTABLE', ruc: '20610043098', desde: '2026-10-01', hasta: '2026-10-31' };

describe('runRhDownloads', () => {
  beforeEach(() => {
    saved.length = 0;
    files.mockReset();
  });

  it('sin formatos no consulta ni guarda nada', async () => {
    const r = await runRhDownloads({ ...base, lado: 'receptor', items: [item(20)], formats: RH_NO_FORMATS });
    expect(saved).toHaveLength(0);
    expect(files).not.toHaveBeenCalled();
    expect(r.saved).toBe('');
  });

  it('solo Excel se guarda tal cual, sin ZIP ni pedir PDF', async () => {
    const r = await runRhDownloads({ ...base, lado: 'receptor', items: [item(20)], formats: { ...RH_NO_FORMATS, excel: true } });
    expect(files).not.toHaveBeenCalled();
    expect(saved).toHaveLength(1);
    expect(saved[0].name).toBe('RH-recibidos-20610043098-2026-10-01_2026-10-31.xlsx');
    expect(r.excel).toBe(true);
  });

  it('PDF + Excel: un ZIP con la carpeta PDF/ y el Excel', async () => {
    files.mockResolvedValue({ blob: await serverZip({ 'PDF/RHE1.pdf': 'pdf1', 'PDF/RHE2.pdf': 'pdf2' }), ok: 2, files: 2, failed: 0, errors: [] });
    const r = await runRhDownloads({ ...base, lado: 'receptor', items: [item(20), item(21)], formats: { pdf: true, excel: true } });
    expect(files).toHaveBeenCalledTimes(1);
    expect(files.mock.calls[0][2]).toEqual(['pdf']);
    expect(r).toMatchObject({ pdf: 2, excel: true, saved: 'RH-REC-20610043098-2026-10-01_2026-10-31.zip' });
    const zip = await JSZip.loadAsync(saved[0].blob);
    const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir).sort();
    expect(names).toEqual(['PDF/RHE1.pdf', 'PDF/RHE2.pdf', 'RH-recibidos-20610043098-2026-10-01_2026-10-31.xlsx']);
  });

  it('lo que SUNAT no entrega queda en avisos y en errores.txt del ZIP', async () => {
    files.mockResolvedValue({ blob: await serverZip({ 'PDF/RHE1.pdf': 'pdf1' }), ok: 1, files: 1, failed: 1, errors: ['E001-21: SUNAT no encontró el recibo.'] });
    const r = await runRhDownloads({ ...base, lado: 'receptor', items: [item(20), item(21)], formats: { ...RH_NO_FORMATS, pdf: true } });
    expect(r.pdf).toBe(1);
    expect(r.notes).toEqual(['E001-21: SUNAT no encontró el recibo.']);
    const zip = await JSZip.loadAsync(saved[0].blob);
    expect(await zip.file('errores.txt')?.async('string')).toContain('E001-21');
  });

  it('emitidos: el PDF no se pide; el Excel sí', async () => {
    const r = await runRhDownloads({ ...base, lado: 'emisor', items: [item(20)], formats: { pdf: true, excel: true } });
    expect(files).not.toHaveBeenCalled();
    expect(r.pdf).toBe(0);
    expect(r.notes[0]).toContain('solo está disponible para los recibos recibidos');
    expect(saved[0].name).toBe('RH-emitidos-20610043098-2026-10-01_2026-10-31.xlsx');
  });

  it('con más de 100 recibos pide los PDF por tandas', async () => {
    files.mockImplementation(async () => ({ blob: await serverZip({}), ok: 0, files: 0, failed: 0, errors: [] }));
    const items = Array.from({ length: 205 }, (_, i) => item(i + 1));
    await runRhDownloads({ ...base, lado: 'receptor', items, formats: { ...RH_NO_FORMATS, pdf: true } });
    expect(files.mock.calls.map((c) => (c[1] as unknown[]).length)).toEqual([100, 100, 5]);
  });

  it('una tanda baja como máximo 250 PDF, solo de los pendientes, y avisa cuántos quedan', async () => {
    expect(RH_BATCH).toBe(250);
    files.mockImplementation(async (_c: unknown, refs: unknown) => {
      const entries: Record<string, string> = {};
      (refs as { comprobante: string }[]).forEach((r) => (entries[`PDF/${r.comprobante}.pdf`] = 'pdf'));
      return { blob: await serverZip(entries), ok: 0, files: 0, failed: 0, errors: [] };
    });
    // 600 recibos: los 100 primeros ya tienen su PDF; uno está anulado.
    const items = Array.from({ length: 600 }, (_, i) => ({ ...item(i + 1), pdf_bajado: i < 100, anulado: i === 100 }));
    const r = await runRhDownloads({ ...base, lado: 'receptor', items, formats: { ...RH_NO_FORMATS, pdf: true } });
    const pedidos = files.mock.calls.flatMap((c) => (c[1] as { comprobante: string }[]).map((x) => x.comprobante));
    expect(pedidos).toHaveLength(250);
    expect(pedidos[0]).toBe('E001-102'); // salta los 100 ya descargados y el anulado
    expect(files.mock.calls.map((c) => (c[1] as unknown[]).length)).toEqual([100, 100, 50]);
    expect(r.pdf).toBe(250);
    expect(r.pdfPending).toBe(249); // 499 pendientes - 250 bajados
    expect(r.notes.join(' ')).toContain('quedan 249 recibos con el PDF pendiente');
  });

  it('si todos los PDF ya estaban descargados no pide ninguno (el Excel sí sale)', async () => {
    const items = [{ ...item(20), pdf_bajado: true }, { ...item(21), pdf_bajado: true }];
    const r = await runRhDownloads({ ...base, lado: 'receptor', items, formats: { pdf: true, excel: true } });
    expect(files).not.toHaveBeenCalled();
    expect(r.pdf).toBe(0);
    expect(r.excel).toBe(true);
    expect(r.notes[0]).toContain('ya estaban descargados');
    expect(saved[0].name).toContain('.xlsx');
  });

  it('pendientes: sin PDF y no anulados, en el orden de la lista', () => {
    const a = { ...item(1), pdf_bajado: true };
    const b = { ...item(2), anulado: true };
    const c = item(3);
    expect(isPdfPending(a)).toBe(false);
    expect(isPdfPending(b)).toBe(false);
    expect(isPdfPending(c)).toBe(true);
    expect(nextPdfPending([a, b, c, item(4)], 1).map((x) => x.comprobante)).toEqual(['E001-3']);
  });
});
