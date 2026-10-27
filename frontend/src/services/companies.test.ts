import { describe, expect, it } from 'vitest';
import { extractRucConflict, isCodeConflict } from './companies';

const apiError = (status: number, data: unknown) => ({ response: { status, data } });

describe('conflictos de RUC al crear una empresa', () => {
  const conflict = { kind: 'eliminada', company_id: 314, code: '0421', business_name: 'X', ruc: '20615941434', status: 'activo', reactivable: true };

  it('extrae el conflicto de una respuesta 409', () => {
    expect(extractRucConflict(apiError(409, { error: 'x', ruc_conflict: conflict }))).toEqual(conflict);
  });

  it('ignora otros errores', () => {
    expect(extractRucConflict(apiError(400, { error: 'x' }))).toBeNull();
    expect(extractRucConflict(apiError(409, { error: 'x' }))).toBeNull();
    expect(extractRucConflict(new Error('red'))).toBeNull();
    expect(extractRucConflict(undefined)).toBeNull();
  });

  it('reconoce el conflicto de código al reactivar', () => {
    expect(isCodeConflict(apiError(409, { code_conflict: true }))).toBe(true);
    expect(isCodeConflict(apiError(409, { error: 'x' }))).toBe(false);
  });
});
