import { fileURLToPath } from 'node:url';
import { foldkit } from '@foldkit/vite-plugin';
import { defineConfig } from 'vite';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [foldkit()],
  build: {
    outDir: '../public/app',
    emptyOutDir: true,
    manifest: true,
    rollupOptions: { input: fileURLToPath(new URL('./src/entry.ts', import.meta.url)) },
  },
});
