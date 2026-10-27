import { describe, expect, it } from 'vitest';
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

  it('el sidebar los lista sin permisos (visibles para cualquier usuario autenticado)', () => {
    const mod = OPERATIONAL_MODULES.find((m) => m.id === 'tools');
    expect(mod?.label).toBe('Herramientas');
    const group = mod?.entries[0];
    expect(group?.type).toBe('group');
    const items = group && group.type === 'group' ? group.items : [];
    expect(items.map((i) => i.to)).toEqual(TOOLS.map((t) => toolPath(t.slug)));
    expect(items.every((i) => i.public === true && !i.permission)).toBe(true);
    expect(mod?.moduleGatePermission).toBeUndefined();
  });
});
