import JSZip from 'jszip';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RheSolItem } from '../../../services/rheSol';

const saved: { blob: Blob; name: string }[] = [];
vi.mock('file-saver', () => ({ saveAs: (blob: Blob, name: string) => saved.push({ blob, name }) }));
const files = vi.fn();
vi.mock('../../../services/rheSol', () => ({ rheSolService: { files: (...a: unknown[]) => files(...a) } }));

import { RH_NO_FORMATS, runRhDownloads } from './rhProcess';

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

  it('un solo formato (TXT) se guarda tal cual, sin ZIP ni consultar archivos', async () => {
    const r = await runRhDownloads({ ...base, lado: 'receptor', items: [item(20)], formats: { ...RH_NO_FORMATS, txt: true } });
    expect(files).not.toHaveBeenCalled();
    expect(saved).toHaveLength(1);
    expect(saved[0].name).toBe('RH-REC-20610043098-01102026_a_31102026.txt');
    expect(r.txt).toBe(true);
  });

  it('PDF + XML + TXT + Excel: un ZIP con carpetas PDF/, XML/, TXT/ y el Excel', async () => {
    files.mockResolvedValue({ blob: await serverZip({ 'PDF/RHE1.pdf': 'pdf1', 'XML/RHE1.xml': '<x/>', 'PDF/RHE2.pdf': 'pdf2', 'XML/RHE2.xml': '<y/>' }), ok: 2, files: 4, failed: 0, errors: [] });
    const r = await runRhDownloads({ ...base, lado: 'receptor', items: [item(20), item(21)], formats: { pdf: true, xml: true, txt: true, excel: true } });
    expect(files).toHaveBeenCalledTimes(1);
    expect(files.mock.calls[0][2]).toEqual(['pdf', 'xml']);
    expect(r).toMatchObject({ pdf: 2, xml: 2, txt: true, excel: true, saved: 'RH-REC-20610043098-2026-10-01_2026-10-31.zip' });
    const zip = await JSZip.loadAsync(saved[0].blob);
    const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir).sort();
    expect(names).toEqual(['PDF/RHE1.pdf', 'PDF/RHE2.pdf', 'RH-recibidos-20610043098-2026-10-01_2026-10-31.xlsx', 'TXT/RH-REC-20610043098-01102026_a_31102026.txt', 'XML/RHE1.xml', 'XML/RHE2.xml']);
  });

  it('lo que SUNAT no entrega queda en avisos y en errores.txt del ZIP', async () => {
    files.mockResolvedValue({ blob: await serverZip({ 'PDF/RHE1.pdf': 'pdf1' }), ok: 1, files: 1, failed: 1, errors: ['E001-21: SUNAT no encontró el recibo.'] });
    const r = await runRhDownloads({ ...base, lado: 'receptor', items: [item(20), item(21)], formats: { ...RH_NO_FORMATS, pdf: true } });
    expect(r.pdf).toBe(1);
    expect(r.notes).toEqual(['E001-21: SUNAT no encontró el recibo.']);
    const zip = await JSZip.loadAsync(saved[0].blob);
    expect(await zip.file('errores.txt')?.async('string')).toContain('E001-21');
  });

  it('emitidos: el PDF y el XML no se piden; el Excel y el TXT sí', async () => {
    const r = await runRhDownloads({ ...base, lado: 'emisor', items: [item(20)], formats: { pdf: true, xml: true, txt: true, excel: true } });
    expect(files).not.toHaveBeenCalled();
    expect(r.pdf).toBe(0);
    expect(r.notes[0]).toContain('solo están disponibles para los recibos recibidos');
    expect(saved[0].name).toBe('RH-EMI-20610043098-2026-10-01_2026-10-31.zip');
  });

  it('con más de 100 recibos pide los archivos por tandas', async () => {
    files.mockImplementation(async () => ({ blob: await serverZip({}), ok: 0, files: 0, failed: 0, errors: [] }));
    const items = Array.from({ length: 205 }, (_, i) => item(i + 1));
    await runRhDownloads({ ...base, lado: 'receptor', items, formats: { ...RH_NO_FORMATS, pdf: true } });
    expect(files.mock.calls.map((c) => (c[1] as unknown[]).length)).toEqual([100, 100, 5]);
  });
});
