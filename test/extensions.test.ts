import { describe, expect, it } from 'vitest';
import { ExtensionSourceError, parseSource, workspaceTarget } from '../src/extensions';

describe('pi extension sources', () => {
  it('reads a git URL, a ref, and a subfolder', () => {
    expect(parseSource('https://github.com/acoyfellow/pi-ext-durable')).toEqual({
      kind: 'git',
      url: 'https://github.com/acoyfellow/pi-ext-durable',
      ref: null,
      subdir: null,
    });
    expect(parseSource('https://github.com/acoyfellow/pi-ext-durable#main:machine')).toEqual({
      kind: 'git',
      url: 'https://github.com/acoyfellow/pi-ext-durable',
      ref: 'main',
      subdir: 'machine',
    });
    expect(parseSource('https://github.com/o/r#:pkg')).toMatchObject({ ref: null, subdir: 'pkg' });
  });

  it('reads a folder inside the workspace', () => {
    expect(parseSource('./uploads/pi-browser')).toEqual({
      kind: 'local',
      path: '/workspace/uploads/pi-browser',
    });
  });

  it('refuses anything that could escape or run elsewhere', () => {
    for (const source of [
      'http://example.com/repo',
      '/etc/passwd',
      './../../etc',
      'https://github.com/o/r#main:../../x',
      'git@github.com:o/r.git',
      "https://github.com/o/r';id;'",
      'https://github.com/o/r$(id)',
      'https://github.com/o/r`id`',
      "https://github.com/o/r';rm -rf /;'",
    ])
      expect(() => parseSource(source)).toThrow(ExtensionSourceError);
  });
});

describe('workspace upload targets', () => {
  it('keeps uploads inside /workspace', () => {
    expect(workspaceTarget('uploads/pi-browser/src/index.ts')).toBe(
      '/workspace/uploads/pi-browser/src/index.ts',
    );
    expect(workspaceTarget('./notes.md')).toBe('/workspace/notes.md');

    for (const path of ['/etc/passwd', '../x', 'a/../../x', 'a/..', ''])
      expect(() => workspaceTarget(path)).toThrow(ExtensionSourceError);
  });
});
