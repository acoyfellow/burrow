import { describe, expect, it } from 'vitest';
import { highlight } from '../src/highlight';

describe('docs syntax highlighting', () => {
  it('marks keywords, strings, the coil object and calls in JavaScript', () => {
    const html = highlight('js', 'const t = await coil.thread_create({ title: "demo" });');

    expect(html).toContain('<span class="tok-keyword">const</span>');
    expect(html).toContain('<span class="tok-keyword">await</span>');
    expect(html).toContain('<span class="tok-string">&quot;demo&quot;</span>');
    expect(html).toContain('<span class="tok-function">coil.thread_create</span>');
    expect(html).toContain('<span class="tok-property">title</span>');
  });

  it('marks commands, flags and strings in shell', () => {
    const html = highlight(
      'sh',
      "curl -X POST https://h/x \\\n  -H 'content-type: application/json'",
    );

    expect(html).toContain('<span class="tok-function">curl</span>');
    expect(html).toContain('<span class="tok-flag">-X</span>');
    expect(html).toContain('<span class="tok-flag">-H</span>');
    expect(html).toContain(
      '<span class="tok-string">&#39;content-type: application/json&#39;</span>'.replaceAll(
        '&#39;',
        "'",
      ),
    );
  });

  it('treats a command after an env prefix as the command', () => {
    const html = highlight(
      'sh',
      'openssl rand -hex 32 | CLOUDFLARE_ACCOUNT_ID=<id> npx wrangler secret put X',
    );

    expect(html).toContain('<span class="tok-function">openssl</span>');
    expect(html).toContain('<span class="tok-function">npx</span>');
  });

  it('escapes HTML in code', () => {
    const html = highlight('sh', 'echo "<script>" > index.html');

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
