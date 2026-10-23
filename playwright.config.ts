import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:3100', locale: 'fr-FR', trace: 'retain-on-failure' },
  projects: [{ name: 'chrome', use: { channel: 'chrome' } }],
  webServer: [
    {
      command: 'npm run build && node dist/server/main.js',
      url: 'http://localhost:3100/api/health',
      reuseExistingServer: false,
      timeout: 120_000,
      env: { PORT: '3100', DATABASE_PATH: 'tmp/e2e/shidokan.sqlite', WEB_DIST_DIR: 'dist/web', LOG: 'off' },
    },
    {
      // Rôle serveur (connexion obligatoire), démarré après la compilation du premier.
      command: 'node tests/e2e/serveur-server.mjs',
      url: 'http://localhost:3101/api/health',
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
