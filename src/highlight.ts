export type Language = 'js' | 'sh';

const ENTITIES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
};

const escapeHtml = (value: string) => value.replace(/[&<>"]/gu, (char) => ENTITIES[char] ?? char);

const JS_KEYWORDS = new Set([
  'const',
  'let',
  'await',
  'async',
  'return',
  'function',
  'new',
  'if',
  'else',
  'true',
  'false',
  'null',
]);

const SH_COMMANDS = new Set([
  'git',
  'cd',
  'bun',
  'cp',
  'curl',
  'npx',
  'openssl',
  'wrangler',
  'node',
  'echo',
]);

const TOKEN =
  /(?<string>'[^'\n]*'|"[^"\n]*"|`[^`]*`)|(?<variable>\$[A-Z_]+|<[a-z-]+>)|(?<flag>(?<=\s)--?[a-zA-Z][\w-]*)|(?<number>\b\d+\b)|(?<word>[A-Za-z_][\w.-]*)|(?<punct>[{}()[\];,:=|&\\])/gu;

const span = (kind: string, text: string) => `<span class="tok-${kind}">${escapeHtml(text)}</span>`;

const isCall = (source: string, end: number) => source[end] === '(';

const wordKind = (
  language: Language,
  word: string,
  source: string,
  end: number,
  lineStart: boolean,
) => {
  if (language === 'js') {
    if (JS_KEYWORDS.has(word)) return 'keyword';
    if (word === 'coil') return 'object';
    if (isCall(source, end)) return 'function';
    if (source[end] === ':') return 'property';

    return null;
  }

  if (lineStart && SH_COMMANDS.has(word)) return 'function';

  return null;
};

const startsCommand = (source: string, index: number) => {
  const before = source
    .slice(0, index)
    .replace(/(?:[A-Z_]+=\S+[ \t]+)+$/u, '')
    .replace(/[ \t]+$/u, '');

  return before === '' || /(\n|&&|\|)$/u.test(before);
};

export const highlight = (language: Language, source: string): string => {
  let out = '';
  let cursor = 0;

  for (const match of source.matchAll(TOKEN)) {
    const index = match.index;
    const text = match[0];
    const groups = match.groups ?? {};

    out += escapeHtml(source.slice(cursor, index));
    cursor = index + text.length;

    if (groups.string !== undefined) out += span('string', text);
    else if (groups.variable !== undefined) out += span('variable', text);
    else if (groups.flag !== undefined && language === 'sh') out += span('flag', text);
    else if (groups.number !== undefined) out += span('number', text);
    else if (groups.word !== undefined) {
      const kind = wordKind(language, text, source, cursor, startsCommand(source, index));

      out += kind === null ? escapeHtml(text) : span(kind, text);
    } else if (groups.punct !== undefined) out += span('punct', text);
    else out += escapeHtml(text);
  }

  return out + escapeHtml(source.slice(cursor));
};
