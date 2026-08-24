import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**', 'templates/**'],
    environment: 'node',
    // No globals: every test imports `describe` / `it` / `expect` from 'vitest' explicitly.
    globals: false,
    restoreMocks: true,
    clearMocks: true,
    unstubEnvs: true,
    // Generator tests touch the real filesystem and shell out to package managers.
    testTimeout: 20_000,
  },
});
