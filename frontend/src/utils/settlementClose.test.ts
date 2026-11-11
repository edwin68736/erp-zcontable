import { describe, expect, it } from 'vitest';
import { closeSettlementMessage, pendingDebtsAtClose } from './settlementClose';

describe('pendingDebtsAtClose', () => {
  it('cuenta solo las deudas con saldo y suma lo que se libera', () => {
    const r = pendingDebtsAtClose([{ balance_amount: 200 }, { balance_amount: 0 }, { balance_amount: '300.5' }, { balance_amount: 0.001 }]);
    expect(r).toEqual({ count: 2, total: 500.5 });
  });
  it('sin deudas pendientes da cero', () => {
    expect(pendingDebtsAtClose([])).toEqual({ count: 0, total: 0 });
  });
});

describe('closeSettlementMessage', () => {
  it('avisa cuántas deudas y cuántos soles quedan libres, y que cerrar no es pagar', () => {
    const m = closeSettlementMessage('LI-202609', { count: 2, total: 500 });
    expect(m).toContain('2 deudas');
    expect(m).toContain('500');
    expect(m).toContain('libres');
    expect(m).toContain('Cerrar no marca nada como pagado');
  });
  it('usa el singular con una sola deuda', () => {
    const m = closeSettlementMessage('LI-202609', { count: 1, total: 200 });
    expect(m).toContain('1 deuda con saldo pendiente');
    expect(m).toContain('quedará libre');
  });
  it('dice que no tiene pendientes cuando todo está pagado', () => {
    expect(closeSettlementMessage('LI-1', { count: 0, total: 0 })).toContain('No tiene deudas con saldo pendiente');
  });
  it('mientras no se conocen las deudas usa un texto general', () => {
    expect(closeSettlementMessage('LI-1', null)).toContain('quedarán libres');
  });
});
