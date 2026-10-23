import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/domain/**/*.test.ts', 'tests/server/**/*.test.ts', 'tests/web/**/*.test.ts'],
    environment: 'node',
    // Les tests qui montent deux installations complètes dépassent parfois 5 s sur une machine chargée (CI).
    testTimeout: 30_000,
  },
});
