import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

execFileSync('npx', ['vite', 'build', '--config', 'client/vite.config.ts', '--logLevel', 'warn'], {
  stdio: 'inherit',
});

const manifest = JSON.parse(readFileSync('public/app/.vite/manifest.json', 'utf8'));
const entry = Object.values(manifest).find((chunk) => chunk.isEntry);

if (!entry) throw new Error('vite produced no entry chunk');

writeFileSync(
  'src/ui/app.generated.ts',
  `export const APP_ENTRY = ${JSON.stringify(`/app/${entry.file}`)};\n`,
);
console.log(`client /app/${entry.file}`);
