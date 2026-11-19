import { afterEach, beforeEach, expect, test } from 'vitest';
import type { AuthorizationSituation } from '../../src/domain/authorizations.js';
import { closeDb, openDb, type AppDb } from '../../src/server/db/client.js';
import { grantAnswer, listAnswers, removeAnswer } from '../../src/server/repositories/authorizations.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

let db: AppDb;
beforeEach(() => {
  db = openDb(tmpDbPath());
  db.$client.exec(`
    INSERT INTO competitions (id, name, date, settings_json) VALUES ('c1', 'Coupe', '2026-11-22', '{}'), ('c2', 'Autre', '2026-11-22', '{}');
    INSERT INTO fighters (id, competition_id, last_name, first_name, name_key, sex, age_band_code) VALUES ('f1', 'c1', 'A', 'a', 'a a', 'M', 'cadet');
    INSERT INTO registrations (id, competition_id, fighter_id, discipline, source) VALUES ('r1', 'c1', 'f1', 'karate', 'manual');
  `);
});
afterEach(() => closeDb(db));

const weight = (gapKg: number): AuthorizationSituation => ({ kind: 'weight', ownClassId: 'a', heaviestClassId: 'b', gapKg });

test('grantAnswer enregistre, listAnswers rend la réponse de la compétition', () => {
  grantAnswer(db, 'c1', 'r1', 'weight', weight(7));
  const answers = listAnswers(db, 'c1');
  expect(answers).toHaveLength(1);
  expect(answers[0]).toMatchObject({ registrationId: 'r1', kind: 'weight', situation: weight(7) });
  expect(Number.isNaN(Date.parse(answers[0]!.answeredAt))).toBe(false);
  expect(listAnswers(db, 'c2')).toEqual([]);
});

test('grantAnswer remplace la situation et la date (upsert)', () => {
  grantAnswer(db, 'c1', 'r1', 'weight', weight(7));
  grantAnswer(db, 'c1', 'r1', 'weight', weight(9));
  const answers = listAnswers(db, 'c1');
  expect(answers).toHaveLength(1);
  expect(answers[0]!.situation).toEqual(weight(9));
});

test('removeAnswer retire seulement le type demandé', () => {
  grantAnswer(db, 'c1', 'r1', 'weight', weight(7));
  grantAnswer(db, 'c1', 'r1', 'mixite', { kind: 'mixite' });
  removeAnswer(db, 'c1', 'r1', 'weight');
  expect(listAnswers(db, 'c1').map((a) => a.kind)).toEqual(['mixite']);
});
