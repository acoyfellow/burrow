import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'worker', include: ['test/**/*.test.ts'], exclude: ['test/client.test.ts'] } },
      { test: { name: 'client', include: ['test/client.test.ts'], environment: 'happy-dom' } },
    ],
  },
});
