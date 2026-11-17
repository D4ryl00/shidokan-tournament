import { afterEach, beforeEach, expect, test } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { closeDb, openDb, type AppDb } from '../../src/server/db/client.js';
import { recordJournal, withJournalGroup } from '../../src/server/journal/write.js';
import { runJournal } from '../../src/server/journal/context.js';
import { listJournal } from '../../src/server/repositories/journal.js';
import { createCompetition } from '../../src/server/repositories/competitions.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

let db: AppDb;
let id: string;
beforeEach(async () => {
  db = openDb(tmpDbPath());
  id = (await createCompetition(db, { name: 'Coupe', date: '2026-11-22' })).id;
});
afterEach(() => closeDb(db));

const add = (subject: string, type: 'inscription' | 'pesee' = 'inscription') =>
  recordJournal(db, id, { type, action: 'fighter-added', data: { subject } });

test('ordre, pages, total', () => {
  for (let i = 0; i < 150; i++) add(`Combattant ${i}`);
  const p1 = listJournal(db, id, {});
  expect(p1.total).toBe(151);
  expect(p1.entries).toHaveLength(100);
  expect(p1.entries[0]!.seq).toBe(151);
  expect(p1.entries.map((e) => e.seq)).toEqual([...p1.entries.map((e) => e.seq)].sort((a, b) => b - a));
  expect(p1.nextBefore).toBe(p1.entries[99]!.seq);
  const p2 = listJournal(db, id, { before: p1.nextBefore! });
  expect(p2.entries).toHaveLength(51);
  expect(p2.nextBefore).toBeNull();
  expect(p2.total).toBe(151);
  expect(listJournal(db, id, { limit: 5000 }).entries).toHaveLength(151);
});

test('recherche sans accent, plusieurs mots répartis entre nom et club', () => {
  add('DUPONT Léa (Shidokan Lyon)');
  add('MARTIN Hugo (Karaté Club Nice)');
  expect(listJournal(db, id, { q: 'lea lyon' }).entries.map((e) => e.data.subject)).toEqual(['DUPONT Léa (Shidokan Lyon)']);
  expect(listJournal(db, id, { q: '%' }).entries).toEqual([]);
});

test('mot trouvé dans une ligne de détail : entrée rendue, ouverte', () => {
  runJournal({}, () =>
    withJournalGroup(db, id, { type: 'pesee', action: 'weigh-in-closed', data: {} }, () => {
      recordJournal(db, id, { type: 'pesee', action: 'presence', data: { subject: 'LEROY Emma (Dojo Marseille)' } });
      recordJournal(db, id, { type: 'pesee', action: 'presence', data: { subject: 'AUTRE Zoé (Dojo Nice)' } });
    }),
  );
  const [e] = listJournal(db, id, { q: 'leroy' }).entries;
  expect(e!.action).toBe('weigh-in-closed');
  expect(e!.open).toBe(true);
  expect(e!.children).toHaveLength(2);
  const all = listJournal(db, id, { types: ['pesee'] }).entries[0]!;
  expect(all.open).toBe(false);
  expect(all.children.map((c) => c.seq)).toEqual([...all.children.map((c) => c.seq)].sort((a, b) => a - b));
});

test('filtre par types', () => {
  add('A');
  add('B', 'pesee');
  const r = listJournal(db, id, { types: ['pesee'] });
  expect(r.entries.map((e) => e.type)).toEqual(['pesee']);
  expect(r.total).toBe(3);
});

test('route : 404 compétition inconnue, types inconnus refusés (400)', async () => {
  const app = await buildApp({ dbPath: tmpDbPath() });
  const c = (await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Coupe', date: '2026-11-22' } })).json().id;
  expect((await app.inject({ url: '/api/competitions/nope/journal' })).statusCode).toBe(404);
  expect((await app.inject({ url: `/api/competitions/${c}/journal?types=bidon` })).statusCode).toBe(400);
  const ok = await app.inject({ url: `/api/competitions/${c}/journal?types=competition,pesee&limit=10&q=cree` });
  expect(ok.statusCode).toBe(200);
  expect(ok.json().entries).toHaveLength(1);
  expect(ok.json().total).toBe(1);
  await app.close();
});

test('recherche : la sous-requête des lignes de détail passe par l’index (pas de parcours de tout le journal par entrée)', () => {
  add('DUPONT Léa');
  const sqlite = db.$client;
  const seen: { sql: string; args: unknown[] }[] = [];
  const prepare = sqlite.prepare.bind(sqlite);
  sqlite.prepare = ((sql: string) => {
    const stmt = prepare(sql);
    const all = stmt.all.bind(stmt);
    stmt.all = ((...args: unknown[]) => (seen.push({ sql, args }), all(...args))) as typeof stmt.all;
    return stmt;
  }) as typeof sqlite.prepare;
  try {
    listJournal(db, id, { q: 'introuvable' });
  } finally {
    sqlite.prepare = prepare;
  }
  const search = seen.find((s) => s.sql.includes('exists'))!;
  const plan = (sqlite.prepare(`explain query plan ${search.sql}`).all(...search.args) as { detail: string }[]).map((r) => r.detail);
  expect(plan.some((d) => /^SCAN c\b/.test(d))).toBe(false);
  expect(plan.some((d) => /SEARCH c USING (COVERING )?INDEX journal_entries_parent/.test(d))).toBe(true);
});
