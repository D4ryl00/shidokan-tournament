import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/domain/**/*.test.ts', 'tests/server/**/*.test.ts', 'tests/web/**/*.test.ts'],
    environment: 'node',
  },
});
