import { CAPABILITIES, type Capability, type Field } from './capabilities';
import { MAX_CALLS } from './run-module';

const GROUPS: readonly { readonly key: Capability['group']; readonly title: string }[] = [
  { key: 'threads', title: 'Threads' },
  { key: 'shell', title: 'Shell' },
  { key: 'files', title: 'Files' },
  { key: 'browser', title: 'Browser' },
  { key: 'computer', title: 'Computer' },
  { key: 'bases', title: 'Warm bases' },
];

const tsType = (field: Field) => {
  if (field.enum !== undefined) return field.enum.map((value) => JSON.stringify(value)).join(' | ');

  return field.type === 'array' ? 'string[]' : 'string';
};

const inputType = (capability: Capability) => {
  const entries = Object.entries(capability.input);

  if (entries.length === 0) return '{}';

  const fields = entries.map(
    ([key, field]) => `${key}${capability.required.includes(key) ? '' : '?'}: ${tsType(field)}`,
  );

  return `{ ${fields.join('; ')} }`;
};

export const describe = (): string =>
  [
    'declare const coil: {',
    ...CAPABILITIES.flatMap((capability) => [
      `  /** ${capability.summary} Returns ${capability.returns}. */`,
      `  ${capability.name}(input: ${inputType(capability)}): Promise<unknown>;`,
    ]),
    '};',
  ].join('\n');

const EXAMPLE = `const t = await coil.thread_create({ title: "demo" });
await coil.thread_exec({ name: t.name, command: "echo '<button>+</button>' > index.html && (busybox httpd -p 3000 &)" });
await coil.browser_open({ name: t.name, url: "localhost:3000" });
const page = await coil.browser_snapshot({ name: t.name });
await coil.browser_click({ name: t.name, ref: "e1" });
await coil.thread_pause({ name: t.name });
return { thread: t.name, page };`;

const fieldLine = (capability: Capability, key: string, field: Field) => {
  const required = capability.required.includes(key) ? ' (required)' : '';
  const choices = field.enum === undefined ? '' : ` One of ${field.enum.join(', ')}.`;

  return `- \`${key}\`${required}: ${field.description}${choices}`;
};

const capabilityLines = (capability: Capability) => [
  `### ${capability.name}`,
  '',
  capability.summary,
  '',
  ...Object.entries(capability.input).map(([key, field]) => fieldLine(capability, key, field)),
  ...(Object.keys(capability.input).length === 0 ? ['- No input.'] : []),
  `- Returns: ${capability.returns}`,
  '',
];

const groupLines = (group: (typeof GROUPS)[number]) => {
  const members = CAPABILITIES.filter((capability) => capability.group === group.key);

  return members.length === 0 ? [] : [`## ${group.title}`, '', ...members.flatMap(capabilityLines)];
};

export const llmsText = (origin: string): string =>
  [
    '# coil',
    '',
    '> Agent threads with their own Linux computer. Each thread has an agent, a shell, a browser, and a disk you can pause and fork.',
    '',
    '## How an agent uses coil',
    '',
    `Connect an MCP client to \`${origin}/mcp\`. Every request needs a Cloudflare Access token in the \`cf-access-token\` header.`,
    '',
    '1. Call `coil_describe` to get the TypeScript declaration of the `coil` object.',
    `2. Call \`coil_run\` with the body of an async function. Each \`await coil.<capability>(input)\` is one call, at most ${MAX_CALLS} per run. The script has no network access of its own.`,
    '3. Or call any capability below directly as its own MCP tool, or with REST.',
    '',
    'Example `coil_run` script:',
    '',
    '```js',
    EXAMPLE,
    '```',
    '',
    'The same list drives the MCP tools, `coil_run`, the REST endpoint, and these docs.',
    '',
    ...GROUPS.flatMap(groupLines),
    '## REST',
    '',
    `\`POST ${origin}/api/capabilities/<name>\` with the input as a JSON body runs one capability and returns its result as JSON.`,
    '',
  ].join('\n');

const ENTITIES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
};

const escapeHtml = (value: string) => value.replace(/[&<>"]/gu, (char) => ENTITIES[char] ?? char);

const inline = (value: string) => escapeHtml(value).replace(/`([^`]+)`/gu, '<code>$1</code>');

const slugOf = (value: string) => value.toLowerCase().replace(/[^a-z0-9_]+/gu, '-');

const markdownToHtml = (markdown: string): string => {
  const out: string[] = [];
  let code: string[] | null = null;
  let list = false;

  const closeList = () => {
    if (list) out.push('</ul>');
    list = false;
  };

  for (const line of markdown.split('\n')) {
    if (line.startsWith('```')) {
      closeList();
      if (code === null) code = [];
      else {
        out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
        code = null;
      }
    } else if (code !== null) code.push(line);
    else if (line.startsWith('### ') || line.startsWith('## ')) {
      closeList();
      const level = line.startsWith('### ') ? 3 : 2;
      const title = line.slice(level + 1);

      out.push(`<h${level} id="${slugOf(title)}">${inline(title)}</h${level}>`);
    } else if (line.startsWith('- ')) {
      if (!list) out.push('<ul>');
      list = true;
      out.push(`<li>${inline(line.slice(2))}</li>`);
    } else if (line.startsWith('> ')) {
      closeList();
      out.push(`<p class="lede">${inline(line.slice(2))}</p>`);
    } else {
      closeList();
      if (line.trim() !== '' && !line.startsWith('# ')) out.push(`<p>${inline(line)}</p>`);
    }
  }
  closeList();

  return out.join('\n');
};

const STYLE = `:root{color-scheme:light dark;--bg:#fff;--text:#18181b;--dim:#6b6b70;--line:#ebebe8;--raise:#f4f4f2}
@media (prefers-color-scheme:dark){:root{--bg:#141416;--text:#ececee;--dim:#9b9ba3;--line:#26262b;--raise:#1f1f23}}
body{margin:0;background:var(--bg);color:var(--text);font:400 14px/1.6 "Google Sans Flex",system-ui,sans-serif}
main{max-width:760px;margin:0 auto;padding:40px 24px 80px}
header{display:flex;align-items:center;justify-content:space-between;padding-bottom:20px;border-bottom:1px solid var(--line);margin-bottom:24px}
header a{color:var(--dim);font-size:13px}
h2{font-size:16px;font-weight:600;margin:32px 0 8px;padding-top:16px;border-top:1px solid var(--line)}
h3{font-size:14px;font-weight:600;margin:20px 0 4px;font-family:"Google Sans Code",ui-monospace,monospace}
p{margin:6px 0}.lede{color:var(--dim)}ul{margin:4px 0;padding-left:20px}li{margin:2px 0;color:var(--dim)}
code{font:400 .9em "Google Sans Code",ui-monospace,monospace;background:var(--raise);padding:1px 4px;border-radius:4px}
pre{background:var(--raise);padding:12px 14px;border-radius:10px;overflow:auto}pre code{background:none;padding:0}`;

export const docsPage = (origin: string): string => `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>coil docs</title>
<link rel="icon" href="/icons/favicon.svg" type="image/svg+xml">
<style>${STYLE}</style>
<main>
<header><img src="/brand/coil-wordmark.svg" alt="coil" height="22"><a href="/llms.txt">llms.txt</a></header>
${markdownToHtml(llmsText(origin))}
</main>
</html>`;
