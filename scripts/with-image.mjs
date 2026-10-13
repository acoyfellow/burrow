import { readFileSync, writeFileSync } from 'node:fs';

const image = process.env.NIX_IMAGE;

if (!image) {
  console.error('Set NIX_IMAGE to your nix-cf-proof image reference in your account registry.');
  process.exit(2);
}

const source = readFileSync('wrangler.jsonc', 'utf8');
const withImage = source.replace(
  '"dockerfile": "./computer/Dockerfile" }',
  `"dockerfile": "./computer/Dockerfile", "build_vars": { "NIX_IMAGE": ${JSON.stringify(image)}, "APK_PLAIN_HTTP": ${JSON.stringify(process.env.APK_PLAIN_HTTP ?? '0')} } }`,
);

if (withImage === source) {
  console.error('wrangler.jsonc has no computer image to configure');
  process.exit(2);
}

writeFileSync(process.env.COIL_WRANGLER_CONFIG ?? 'wrangler.local.jsonc', withImage);
