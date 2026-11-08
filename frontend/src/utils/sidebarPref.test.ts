import { describe, expect, it } from 'vitest';
import { SIDEBAR_AUTO_COLLAPSE_BELOW, initialSidebarCollapsed } from './sidebarPref';

describe('initialSidebarCollapsed', () => {
  it('respeta lo que la persona eligió, sin importar el ancho', () => {
    expect(initialSidebarCollapsed('1', 2560)).toBe(true);
    expect(initialSidebarCollapsed('0', 1024)).toBe(false);
  });

  it('sin elección previa, colapsa en pantallas angostas y expande en las amplias', () => {
    expect(initialSidebarCollapsed(null, 1309)).toBe(true);
    expect(initialSidebarCollapsed(null, SIDEBAR_AUTO_COLLAPSE_BELOW - 1)).toBe(true);
    expect(initialSidebarCollapsed(null, SIDEBAR_AUTO_COLLAPSE_BELOW)).toBe(false);
    expect(initialSidebarCollapsed(null, 1920)).toBe(false);
  });

  it('un valor desconocido se trata como sin elección', () => {
    expect(initialSidebarCollapsed('quizas', 1200)).toBe(true);
    expect(initialSidebarCollapsed('', 1600)).toBe(false);
  });
});
