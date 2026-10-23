// Troisième serveur des tests e2e : un portable de zone (rôle local), sur le port 3102, relié au PC principal (port 3100).
// Attend que le premier serveur ait fini la compilation, puis démarre sur sa propre base.
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const env = { ...process.env, PORT: '3102', DATABASE_PATH: 'tmp/e2e-portable/shidokan.sqlite', WEB_DIST_DIR: 'dist/web', LOG: 'off', INSTANCE_NAME: 'PORTABLE-T1' };
for (let i = 0; i < 240; i++) {
  try {
    if ((await fetch('http://localhost:3100/api/health')).ok) break;
  } catch {
    /* pas encore prêt */
  }
  await new Promise((r) => setTimeout(r, 500));
}
fs.rmSync('tmp/e2e-portable', { recursive: true, force: true });
const server = spawn('node', ['dist/server/main.js'], { env, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.kill(signal));
server.on('exit', (code) => process.exit(code ?? 0));
