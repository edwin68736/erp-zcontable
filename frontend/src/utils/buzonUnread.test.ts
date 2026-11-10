import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BuzonUnreadSummary } from '../services/sunatBuzon';

const unread = vi.fn();
vi.mock('../services/sunatBuzon', () => ({ sunatBuzonService: { unread: (...a: unknown[]) => unread(...a) } }));

const summary = (total: number): BuzonUnreadSummary => ({
  total,
  urgent: 0,
  companies: total ? [{ company_id: 1, code: '001', business_name: 'EMPRESA', ruc: '20111111111', unread: total, urgent: 0 }] : [],
  unchecked: { rejected: 0, error: 0 },
});

describe('buzonUnread', () => {
  let mod: typeof import('./buzonUnread');
  beforeEach(async () => {
    unread.mockReset();
    vi.stubGlobal('window', { dispatchEvent: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() });
    mod = await import('./buzonUnread');
    mod.__resetBuzonUnreadForTests();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('guarda lo que responde el servidor', async () => {
    unread.mockResolvedValue(summary(3));
    await mod.refreshBuzonUnread();
    const s = mod.getBuzonUnreadSnapshot();
    expect(s.data?.total).toBe(3);
    expect(s.error).toBe(false);
    expect(s.loading).toBe(false);
  });

  it('un fallo no borra lo último que se vio', async () => {
    unread.mockResolvedValueOnce(summary(2)).mockRejectedValueOnce(new Error('red'));
    await mod.refreshBuzonUnread();
    await mod.refreshBuzonUnread();
    const s = mod.getBuzonUnreadSnapshot();
    expect(s.data?.total).toBe(2);
    expect(s.error).toBe(true);
  });

  it('dos lecturas a la vez piden una sola vez', async () => {
    let resolve: (v: BuzonUnreadSummary) => void = () => undefined;
    unread.mockReturnValue(new Promise<BuzonUnreadSummary>((r) => (resolve = r)));
    const a = mod.refreshBuzonUnread();
    const b = mod.refreshBuzonUnread();
    resolve(summary(1));
    await Promise.all([a, b]);
    expect(unread).toHaveBeenCalledTimes(1);
  });

  it('el evento de «buzón actualizado» avisa a las pantallas', () => {
    mod.emitBuzonUpdated();
    expect((window.dispatchEvent as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0].type).toBe(mod.BUZON_UPDATED_EVENT);
  });
});
