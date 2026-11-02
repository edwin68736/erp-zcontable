import { describe, expect, it } from 'vitest';
import { P } from '../rbac/codes';
import { OPERATIONAL_MODULES } from './sidebarConfig';
import { TOOLS, findTool, toolPath } from './toolsConfig';

describe('módulo Herramientas', () => {
  it('tiene los 7 submenús pedidos, en orden', () => {
    expect(TOOLS.map((t) => t.label)).toEqual([
      'SIRE',
      'RH',
      'Consulta ITF',
      'Tipo de cambio',
      'Consulta de detracciones',
      'Consulta DAM',
      'Notificaciones SUNAT',
    ]);
  });

  it('cada herramienta tiene una ruta única y se encuentra por su slug', () => {
    const paths = TOOLS.map((t) => toolPath(t.slug));
    expect(new Set(paths).size).toBe(TOOLS.length);
    for (const t of TOOLS) expect(findTool(t.slug)).toBe(t);
    expect(findTool('inexistente')).toBeUndefined();
  });

  it('el sidebar las lista; solo SIRE exige permiso (ver Claves SOL), el resto son públicas', () => {
    const mod = OPERATIONAL_MODULES.find((m) => m.id === 'tools');
    expect(mod?.label).toBe('Herramientas');
    const group = mod?.entries[0];
    expect(group?.type).toBe('group');
    const items = group && group.type === 'group' ? group.items : [];
    expect(items.map((i) => i.to)).toEqual(TOOLS.map((t) => toolPath(t.slug)));
    for (const [i, t] of TOOLS.entries()) {
      if (t.permission) {
        expect(items[i].permission).toBe(t.permission);
        expect(items[i].public).toBeUndefined();
      } else {
        expect(items[i].public).toBe(true);
      }
    }
    expect(findTool('sire')?.permission).toBe(P.companyCredentialsView);
    expect(TOOLS.filter((t) => t.permission).map((t) => t.slug)).toEqual(['sire', 'rh']);
    expect(mod?.moduleGatePermission).toBeUndefined();
  });
});
