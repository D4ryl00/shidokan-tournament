import { defineConfig } from 'vitest/config';

// Tests de durée, hors de `npm test` : un fichier à la fois, pour que la mesure ne dépende pas des autres tests.
export default defineConfig({
  test: {
    include: ['tests/perf/**/*.test.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 60_000,
  },
});
