import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import sharp from 'sharp';

const BRAND = 'docs/brand';
const ICONS = 'public/icons';

execFileSync('python3', ['build.py'], { cwd: BRAND, stdio: 'inherit' });
mkdirSync(ICONS, { recursive: true });

const RASTERS = [
  ['coil-icon.svg', 'icon-192.png', 192],
  ['coil-icon.svg', 'icon-512.png', 512],
  ['coil-icon-maskable.svg', 'maskable-192.png', 192],
  ['coil-icon-maskable.svg', 'maskable-512.png', 512],
  ['coil-icon-apple.svg', 'apple-touch-icon.png', 180],
  ['coil-favicon.svg', 'favicon-32.png', 32],
  ['coil-favicon.svg', 'favicon-16.png', 16],
];

const viewBoxSize = (source) =>
  Number(readFileSync(`${BRAND}/${source}`, 'utf8').match(/viewBox="0 0 (\d+)/)[1]);

const render = (source, size) =>
  sharp(readFileSync(`${BRAND}/${source}`), { density: (72 * size * 4) / viewBoxSize(source) })
    .resize(size, size)
    .png({ compressionLevel: 9 });

for (const [source, target, size] of RASTERS)
  await render(source, size).toFile(`${ICONS}/${target}`);

await sharp(readFileSync(`${BRAND}/coil-social.svg`), { density: 144 })
  .resize(1200, 630)
  .png({ compressionLevel: 9 })
  .toFile(`${BRAND}/coil-social.png`);

copyFileSync(`${BRAND}/coil-icon.svg`, `${ICONS}/coil.svg`);
copyFileSync(`${BRAND}/coil-favicon.svg`, `${ICONS}/favicon.svg`);
copyFileSync(`${BRAND}/coil-mark.svg`, `${ICONS}/coil-mark.svg`);

console.log(`brand: ${RASTERS.length} PNGs and 3 SVGs in ${ICONS}, social card in ${BRAND}`);
