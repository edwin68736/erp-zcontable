import { describe, expect, it } from 'vitest';
import { EVENT_LABEL, describeUserAgent } from './securityUi';

describe('securityUi', () => {
  it('reconoce navegador y sistema del User-Agent', () => {
    expect(describeUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36')).toBe('Chrome · Windows');
    expect(describeUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0')).toBe('Edge · Windows');
    expect(describeUserAgent('Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0')).toBe('Firefox · Linux');
    expect(describeUserAgent('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36')).toBe('Chrome · Android');
    expect(describeUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605 Version/17 Safari/604')).toBe('Safari · iOS');
    expect(describeUserAgent('curl/8.0')).toBe('Navegador');
    expect(describeUserAgent('')).toBe('—');
  });

  it('tiene etiqueta para cada tipo de evento que registra el servidor', () => {
    for (const t of ['login_ok', 'login_fail', 'login_blocked', 'password_change', 'password_change_fail', 'password_reset']) {
      expect(EVENT_LABEL[t]?.label).toBeTruthy();
    }
  });
});
