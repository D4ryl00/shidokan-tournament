import { afterEach, beforeEach, expect, test } from 'vitest';
import { closeDb, openDb, type AppDb } from '../../src/server/db/client.js';
import { currentJournal, runJournal } from '../../src/server/journal/context.js';
import { recordJournal, withJournalGroup } from '../../src/server/journal/write.js';
import { createCompetition, deleteCompetition } from '../../src/server/repositories/competitions.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

let db: AppDb;
let c1: string;
beforeEach(async () => {
  db = openDb(tmpDbPath());
  c1 = (await createCompetition(db, { name: 'Coupe', date: '2026-11-22' })).id;
});
afterEach(() => closeDb(db));

const raw = (sql: string, ...args: unknown[]) => db.$client.prepare(sql).all(...args) as Record<string, any>[];
const maxSeq = () => raw('select coalesce(max(seq), 0) m from journal_entries where competition_id = ?', c1)[0]!.m as number;

test('numéros croissants par compétition, acteur et manière du contexte', () => {
  const start = maxSeq();
  runJournal({ actor: { kind: 'poste', poste: 'table' }, via: 'sur-place' }, () => {
    recordJournal(db, c1, { type: 'inscription', action: 'fighter-added', data: { subject: 'A' } });
    recordJournal(db, c1, { type: 'inscription', action: 'fighter-added', data: { subject: 'B' } });
  });
  const rows = raw('select seq, actor_json, via, search_text from journal_entries where competition_id = ? and action = ? order by seq', c1, 'fighter-added');
  expect(rows.map((r) => r.seq)).toEqual([start + 1, start + 2]);
  expect(JSON.parse(rows[0]!.actor_json)).toEqual({ kind: 'poste', poste: 'table' });
  expect(rows[0]!.via).toBe('sur-place');
  expect(rows[0]!.search_text).toContain('INSCRIPTION SUR PLACE');
});

test('sans contexte : acteur appli, manière autre', () => {
  recordJournal(db, c1, { type: 'inscription', action: 'fighter-added', data: {} });
  const r = raw('select actor_json, via from journal_entries where action = ?', 'fighter-added')[0]!;
  expect(JSON.parse(r.actor_json)).toEqual({ kind: 'app' });
  expect(r.via).toBe('autre');
});

test('groupe : lignes de détail rattachées au parent', () => {
  const parentId = runJournal({}, () =>
    withJournalGroup(db, c1, { type: 'pesee', action: 'weigh-in-closed', data: {} }, () => {
      recordJournal(db, c1, { type: 'pesee', action: 'presence', data: { subject: 'X' } });
      return currentJournal()!.parentId;
    }),
  );
  expect(raw('select count(*) n from journal_entries where parent_id = ?', parentId)[0]!.n).toBe(1);
});

test('annulée avec la transaction', () => {
  expect(() =>
    db.transaction(() => {
      recordJournal(db, c1, { type: 'inscription', action: 'fighter-added', data: {} });
      throw new Error('x');
    }),
  ).toThrow();
  expect(raw('select count(*) n from journal_entries where action = ?', 'fighter-added')[0]!.n).toBe(0);
});

test('supprimée avec la compétition', async () => {
  recordJournal(db, c1, { type: 'inscription', action: 'fighter-added', data: {} });
  await deleteCompetition(db, c1);
  expect(raw('select count(*) n from journal_entries where competition_id = ?', c1)[0]!.n).toBe(0);
});
