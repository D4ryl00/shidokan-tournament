import fs from 'node:fs';
import path from 'node:path';
import { request } from '@playwright/test';
import { SERVER_SESSION } from './helpers.js';

export default async function globalSetup() {
  fs.rmSync('tmp/e2e', { recursive: true, force: true });
  // Une seule connexion pour les tests du rôle serveur (10 connexions par IP en 15 minutes) : les fichiers qui n'ont pas besoin de tester la connexion réutilisent cette session.
  fs.mkdirSync(path.dirname(SERVER_SESSION), { recursive: true });
  const api = await request.newContext({ baseURL: 'http://localhost:3101' });
  const res = await api.post('/api/auth/login', { data: { email: 'orga@e2e.example', password: 'mot-de-passe-e2e' } });
  if (!res.ok()) throw new Error(`Connexion e2e impossible (${res.status()}).`);
  await api.storageState({ path: SERVER_SESSION });
  await api.dispose();
}
