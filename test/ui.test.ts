import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CLIENT } from '../src/ui/client';
import { STYLE } from '../src/ui/style';
import { serviceWorker } from '../src/ui/sw';

describe('browser code', () => {
  it('the client script parses', () => {
    expect(() => new Function(CLIENT)).not.toThrow();
  });

  it('the service worker parses and never caches the API', () => {
    const source = serviceWorker('test');

    expect(() => new Function('self', 'caches', source)).not.toThrow();
    expect(source).toContain("url.pathname.startsWith('/api/')");
    expect(source).toContain("url.pathname === '/mcp'");
  });
});

describe('web app manifest', () => {
  const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8')) as {
    name: string;
    start_url: string;
    display: string;
    icons: { src: string; sizes: string; purpose: string }[];
  };

  it('is installable', () => {
    expect(manifest.name).toBe('coil');
    expect(manifest.start_url).toBe('/');
    expect(manifest.display).toBe('standalone');
  });

  it('ships 192 and 512 icons, including maskable ones, that exist on disk', () => {
    for (const size of ['192x192', '512x512']) {
      expect(manifest.icons.some((i) => i.sizes === size && i.purpose === 'any')).toBe(true);
      expect(manifest.icons.some((i) => i.sizes === size && i.purpose === 'maskable')).toBe(true);
    }

    for (const icon of manifest.icons)
      expect(() => readFileSync(`public${icon.src}`)).not.toThrow();
  });
});

describe('phone text entry', () => {
  it('keeps every text-entry control at 16px on phones so iOS Safari does not zoom', () => {
    const rule = /@media \(max-width: 500px\)\{([^{]+)\{font-size:16px !important\}\}/.exec(STYLE);

    expect(rule).not.toBeNull();
    for (const selector of [
      'input:not([type=checkbox])',
      'select',
      'textarea',
      '[contenteditable]',
    ])
      expect(rule?.[1]).toContain(selector);
  });
});
