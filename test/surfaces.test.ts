import { describe, expect, it } from 'vitest';
import { normalizeUrl, nulFrames } from '../src/browser';
import { parseSize, resizeRequest, SESSION, tmuxArgs } from '../src/terminal';

describe('browser pipe framing', () => {
  it('splits NUL-separated CDP messages across chunk boundaries', () => {
    const split = nulFrames();
    const encode = (s: string) => new TextEncoder().encode(s);

    expect(split(encode('{"id":1}\0{"id"'))).toEqual(['{"id":1}']);
    expect(split(encode(':2}\0'))).toEqual(['{"id":2}']);
    expect(split(encode(''))).toEqual([]);
  });

  it('keeps multi-byte characters split across chunks intact', () => {
    const split = nulFrames();
    const bytes = new TextEncoder().encode('{"t":"é"}\0');

    expect(split(bytes.slice(0, 7))).toEqual([]);
    expect(split(bytes.slice(7))).toEqual(['{"t":"é"}']);
  });
});

describe('browser URLs', () => {
  it('treats host:port as a host, not a scheme', () => {
    expect(normalizeUrl('localhost:8080')).toBe('http://localhost:8080');
    expect(normalizeUrl(' example.com/a ')).toBe('http://example.com/a');
  });

  it('keeps real schemes', () => {
    expect(normalizeUrl('https://example.com')).toBe('https://example.com');
    expect(normalizeUrl('about:blank')).toBe('about:blank');
  });
});

describe('terminal sessions', () => {
  it('accepts sane sizes and rejects bad ones', () => {
    expect(parseSize('80', '24')).toEqual({ cols: 80, rows: 24 });
    expect(parseSize(1, 24)).toBeNull();
    expect(parseSize(80, 9999)).toBeNull();
    expect(parseSize('8.5', 24)).toBeNull();
  });

  it('reads resize control frames and ignores junk', () => {
    expect(resizeRequest('{"resize":[120,40]}')).toEqual({ cols: 120, rows: 40 });
    expect(resizeRequest('not json')).toBeNull();
    expect(resizeRequest('{"resize":[0,0]}')).toBeNull();
  });

  it('only allows plain session names', () => {
    expect(SESSION.test('t1')).toBe(true);
    expect(SESSION.test('t1;rm')).toBe(false);
    expect(SESSION.test('a.b')).toBe(false);
  });

  it('passes the session name as an argument, never inside the script', () => {
    const args = tmuxArgs('t2');

    expect(args.at(-1)).toBe('t2');
    expect(args[2]).not.toContain('t2');
    expect(args[2]).toContain('new-session -A');
    expect(args[2]).toContain('capture-pane');
  });
});
