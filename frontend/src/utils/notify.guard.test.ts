import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Archivos de src/ (sin PDF ni pruebas) para revisar que nadie vuelva a las formas antiguas de avisar. */
function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'pdf' || name === 'node_modules') continue;
      sources(full, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

const ROOT = join(__dirname, '..');
const files = sources(ROOT);
const rel = (f: string) => f.slice(ROOT.length + 1).replace(/\\/g, '/');

describe('avisos tras una acción', () => {
  it('nadie envía el evento antiguo miweb:toast a mano (se usa notify.*)', () => {
    const offenders = files.filter((f) => !['utils/notify.ts', 'layouts/Layout.tsx'].includes(rel(f))).filter((f) => /CustomEvent\(\s*'miweb:toast'/.test(readFileSync(f, 'utf8')));
    expect(offenders.map(rel)).toEqual([]);
  });

  it('nadie usa window.confirm ni alert del navegador (se usa notify.confirm / notify.*)', () => {
    const offenders = files
      .filter((f) => rel(f) !== 'utils/notify.ts')
      .filter((f) => /(?<![\w.$])(?:window\.)?(?:confirm|alert)\(/.test(readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')));
    expect(offenders.map(rel)).toEqual([]);
  });
});
