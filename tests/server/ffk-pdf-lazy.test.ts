import { expect, test, vi } from 'vitest';
import { buildFfkPdf } from '../helpers/ffk-pdf.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

// pdfjs qui ne se charge pas (comme sans le module natif `@napi-rs/canvas` : « DOMMatrix is not defined »).
const pdfjs = vi.hoisted(() => ({ loads: 0 }));
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => {
  pdfjs.loads++;
  throw new ReferenceError('DOMMatrix is not defined');
});

test('pdfjs n’est pas chargé au démarrage : le serveur démarre, seule la lecture du PDF est refusée (503)', async () => {
  const { buildApp } = await import('../../src/server/app.js');
  await import('../../src/server/routes/ffk-pdf.js');
  const app = await buildApp({ clubServices: true, dbPath: tmpDbPath() });
  try {
    expect(pdfjs.loads).toBe(0);
    const created = await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Coupe', date: '2026-11-22', location: 'Nice' } });
    expect(created.statusCode).toBe(201);
    const pdf = await buildFfkPdf({ competition: 'Coupe Test - Combats', entity: '0000001 DOJO TEST', categories: [{ title: 'Senior Masculin -75 KG', fighters: ['DURAND LEO'] }] });
    const read = () => app.inject({
      method: 'POST', url: `/api/competitions/${created.json().id}/ffk-pdf?discipline=karate`,
      headers: { 'content-type': 'application/octet-stream' }, payload: Buffer.from(pdf),
    });
    const res = await read();
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('La lecture des PDF n’est pas disponible sur ce serveur.');
    expect(pdfjs.loads).toBe(1);
    // Le serveur tourne toujours ; une lecture suivante réessaie de charger pdfjs.
    expect((await app.inject({ method: 'GET', url: '/api/competitions' })).statusCode).toBe(200);
    expect((await read()).statusCode).toBe(503);
  } finally {
    await app.close();
  }
});
