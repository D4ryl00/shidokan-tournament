// Second serveur des tests e2e : rôle « serveur » (connexion obligatoire), sur le port 3101, avec un compte organisateur.
// Attend que le premier serveur (port 3100) ait fini la compilation, puis démarre sur sa propre base.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';

const env = { ...process.env, PORT: '3101', DATABASE_PATH: 'tmp/e2e-serveur/shidokan.sqlite', WEB_DIST_DIR: 'dist/web', LOG: 'off', INSTANCE_ROLE: 'serveur', PUBLIC_URL: 'http://localhost:3101', GOOGLE_CLIENT_ID: 'e2e-client', GOOGLE_CLIENT_SECRET: 'e2e-secret' };
for (let i = 0; i < 240; i++) {
  try {
    if ((await fetch('http://localhost:3100/api/health')).ok) break;
  } catch {
    /* pas encore prêt */
  }
  await new Promise((r) => setTimeout(r, 500));
}
fs.rmSync('tmp/e2e-serveur', { recursive: true, force: true });
fs.mkdirSync('tmp/e2e-serveur', { recursive: true });
execFileSync('node', ['dist/server/cli.js', 'add-user', 'orga@e2e.example'], { env, input: 'mot-de-passe-e2e\n' });
const server = spawn('node', ['dist/server/main.js'], { env, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.kill(signal));
server.on('exit', (code) => process.exit(code ?? 0));
