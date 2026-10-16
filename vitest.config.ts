import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 20000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'worker/auth.ts'],
      exclude: ['src/cli.ts'],
      thresholds: { statements: 80, branches: 80, functions: 80, lines: 80 },
    },
  },
});
