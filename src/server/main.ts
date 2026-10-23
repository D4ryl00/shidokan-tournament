import { buildApp } from './app.js';

const port = Number(process.env.PORT ?? 3000);
const app = await buildApp({
  dbPath: process.env.DATABASE_PATH ?? './data/shidokan.sqlite',
  webDistDir: process.env.WEB_DIST_DIR ?? 'dist/web',
  logger: process.env.LOG !== 'off',
  backupIntervalMin: Number(process.env.BACKUP_INTERVAL_MIN ?? 5),
  instanceName: process.env.INSTANCE_NAME || process.env.COMPUTERNAME || 'PC',
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    app.close().then(() => process.exit(0));
  });
}

await app.listen({ port, host: '0.0.0.0' });
console.log(`Application disponible sur http://localhost:${port}`);
