import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const [baseArg, thread, folder, target] = process.argv.slice(2);

if (!baseArg || !thread || !folder || !target?.startsWith('uploads/')) {
  console.error(
    'usage: node scripts/upload-folder.mjs <base> <thread> <local folder> uploads/<name>',
  );
  process.exit(2);
}

const base = baseArg.replace(/\/$/u, '');
const local = /^http:\/\/(localhost|127\.0\.0\.1)/u.test(base);
const token = local
  ? null
  : execFileSync('cloudflared', ['access', 'token', '-app', base], { encoding: 'utf8' }).trim();
const headers = {
  'content-type': 'application/json',
  ...(token === null ? {} : { 'cf-access-token': token }),
};
const SKIPPED = new Set(['node_modules', '.git', 'dist', '.wrangler']);

const filesUnder = (root) =>
  readdirSync(root).flatMap((name) => {
    if (SKIPPED.has(name)) return [];
    const path = join(root, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });

const write = async (path, content, attempt = 0) => {
  const response = await fetch(`${base}/api/capabilities/thread_write_file`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: thread, path, content }),
  }).catch((error) => (attempt < 3 ? null : Promise.reject(error)));

  if (response === null || (response.status >= 500 && attempt < 3)) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    return write(path, content, attempt + 1);
  }

  if (!response.ok) throw new Error(`write ${path}: ${response.status} ${await response.text()}`);
};

const files = filesUnder(folder);

for (const file of files)
  await write(`${target}/${relative(folder, file)}`, readFileSync(file, 'utf8'));

console.log(`uploaded ${files.length} files to /workspace/${target}`);
