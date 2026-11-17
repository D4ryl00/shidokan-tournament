import { expect, test } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { JOURNAL_COVERED, JOURNAL_EXEMPT, JOURNAL_PENDING } from '../../src/server/journal/coverage.js';
import { registeredRoutes } from '../helpers/routes.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

/** Routes d'écriture des deux rôles, avec les services aux clubs (inscription en ligne, mails) et le compte Google. */
async function allWrites(): Promise<string[]> {
  const out = new Set<string>();
  for (const role of ['local', 'serveur'] as const) {
    const app = await buildApp({ dbPath: tmpDbPath(), role, clubServices: true, publicUrl: 'https://exemple.fr', google: { clientId: 'x', clientSecret: 'y' } });
    await app.ready();
    for (const r of registeredRoutes(app)) if (!['GET', 'HEAD'].includes(r.method)) out.add(`${r.method} ${r.pattern}`);
    await app.close();
  }
  return [...out];
}

test('chaque route d’écriture est détaillée, exclue ou à venir — une seule fois', async () => {
  const all = await allWrites();
  const writes = all.filter((w) => /^\S+ \/api\/(competitions|inscription)\b/.test(w));
  expect(writes.length).toBeGreaterThan(90);
  const known = [...JOURNAL_COVERED, ...JOURNAL_EXEMPT, ...JOURNAL_PENDING];
  expect(writes.filter((w) => !known.includes(w))).toEqual([]);
  // Aucune route classée qui n'existe pas (les routes hors compétition qui en modifient sont dans PENDING : elles existent aussi).
  expect(known.filter((k) => !all.includes(k))).toEqual([]);
  expect(new Set(known).size).toBe(known.length);
});
