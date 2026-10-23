import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterEach, expect, test } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { closeDb, openDb, type AppDb } from '../../src/server/db/client.js';
import { affiliationNumber } from '../../src/server/db/club-directory.js';
import { createCompetition } from '../../src/server/repositories/competitions.js';
import { updateClub, upsertClub } from '../../src/server/repositories/registrations.js';
import { fillClubForm } from '../helpers/club-form-fill.js';
import { buildFfkWorkbook } from '../helpers/ffk-fixture.js';
import { olderDb } from '../helpers/older-db.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

let db: AppDb | null = null;
let app: FastifyInstance | null = null;
afterEach(async () => {
  if (db) closeDb(db);
  if (app) await app.close();
  db = null;
  app = null;
});

interface Entry { id: string; name: string; affiliation_number: string | null; ffk_entity: string | null; coach_phone: string | null; coach_email: string | null }
const entryOf = (d: AppDb, clubId: string) =>
  d.$client.prepare('select e.* from clubs c join club_directory e on e.id = c.directory_club_id where c.id = ?').get(clubId) as Entry | undefined;
const entries = (d: AppDb) => d.$client.prepare('select * from club_directory order by name').all() as Entry[];

async function twoCompetitions() {
  db = openDb(tmpDbPath());
  const a = await createCompetition(db, { name: 'Coupe 2025', date: '2025-11-22' });
  const b = await createCompetition(db, { name: 'Coupe 2026', date: '2026-11-22' });
  return { d: db, a: a.id, b: b.id };
}

test('affiliationNumber : « 0060808 ISSA KYOKUSHIN SCHOOL » → « 0060808 » ; « ISSA » → null ; null → null', () => {
  expect(affiliationNumber('0060808 ISSA KYOKUSHIN SCHOOL')).toBe('0060808');
  expect(affiliationNumber('ISSA')).toBeNull();
  expect(affiliationNumber(null)).toBeNull();
});

test("même numéro d'affiliation, orthographes différentes (alias) → une seule entrée", async () => {
  const { d, a, b } = await twoCompetitions();
  const ffk = await upsertClub(d, a, { name: 'TANI DOJO', ffkEntity: '0060893 TANI DOJO' });
  d.$client.prepare("insert into club_aliases (name_key, club_entity) values ('DOJO TANI', '0060893 TANI DOJO')").run();
  const typed = await upsertClub(d, b, { name: 'Dojo Tani' });
  expect(entryOf(d, typed.id)!.id).toBe(entryOf(d, ffk.id)!.id);
  expect(entries(d)).toHaveLength(1);
  expect(entries(d)[0]).toMatchObject({ affiliation_number: '0060893', ffk_entity: '0060893 TANI DOJO' });
});

test("même numéro d'affiliation, nom de l'entité FFK changé entre deux exports → une seule entrée", async () => {
  const { d, a, b } = await twoCompetitions();
  const old = await upsertClub(d, a, { name: 'TANI DOJO', ffkEntity: '0060893 TANI DOJO' });
  const renamed = await upsertClub(d, b, { name: 'TANI DOJO NICE', ffkEntity: '0060893 TANI DOJO NICE' });
  expect(entryOf(d, renamed.id)!.id).toBe(entryOf(d, old.id)!.id);
  expect(entries(d)).toHaveLength(1);
});

test("même nom, numéros d'affiliation différents → deux entrées", async () => {
  const { d, a, b } = await twoCompetitions();
  const one = await upsertClub(d, a, { name: 'KARATE CLUB', ffkEntity: '0060001 KARATE CLUB' });
  const two = await upsertClub(d, b, { name: 'KARATE CLUB', ffkEntity: '0130002 KARATE CLUB' });
  expect(entryOf(d, one.id)!.id).not.toBe(entryOf(d, two.id)!.id);
  expect(entries(d)).toHaveLength(2);
});

test("une fiche importée ne change pas un téléphone déjà présent dans l'annuaire, mais remplit un e-mail vide", async () => {
  const { d, a, b } = await twoCompetitions();
  await upsertClub(d, a, { name: 'Tani Dojo', coachPhone: '0600000001' });
  const later = await upsertClub(d, b, { name: 'Tani Dojo', coachPhone: '0600000002', coachEmail: 'coach@example.org' });
  expect(entryOf(d, later.id)).toMatchObject({ coach_phone: '0600000001', coach_email: 'coach@example.org' });
});

test('renommer un club de compétition garde son entrée', async () => {
  const { d, a } = await twoCompetitions();
  const club = await upsertClub(d, a, { name: 'Tani Dojo' });
  const before = entryOf(d, club.id)!.id;
  await updateClub(d, a, club.id, { name: 'Club tout autre' });
  expect(entryOf(d, club.id)!.id).toBe(before);
  expect(entries(d)).toHaveLength(1);
});

test('import FFK : club créé → relié avec son numéro ; lien sûr vers un club existant → son entrée reçoit le numéro', async () => {
  const dbPath = tmpDbPath();
  app = await buildApp({ dbPath });
  const base = `/api/competitions/${(await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Coupe', date: '2026-11-22' } })).json().id}`;
  const tpl = (await app.inject({ method: 'GET', url: `${base}/club-form.ods` })).rawPayload;
  const form = fillClubForm(tpl, ['Tani Dojo', 'Coach', null, null, 'Non'], [['MARTIN', 'Léa', 'Féminin', 'Cadets', '-54', 'Karaté', 'Jiyu', '2', null, null]]);
  const send = (url: string, file: Buffer) => app!.inject({ method: 'POST', url, payload: file, headers: { 'content-type': 'application/octet-stream', 'x-file-name': 'export.xlsx' } });
  expect((await send(`${base}/club-forms/import`, form)).statusCode).toBe(200);
  const ffk = buildFfkWorkbook({
    'Coupe Shidokan Karate': [
      ['MARTIN LEA', null, 'L001', '0060893 TANI DOJO', 'Feminine', 'Karate', 'Cadet', -61, null],
      ['DURAND HUGO', null, 'L003', '0060789 SHINSENGUMI DOJO VESUBIE', 'Masculin', 'Karate', 'Senior', '+84', 'Shobu'],
    ],
  });
  const up = (await send(`${base}/ffk-imports`, ffk)).json();
  const commit = await app.inject({ method: 'POST', url: `${base}/ffk-imports/${up.uploadId}/commit`, payload: { sheets: up.sheets } });
  expect(commit.statusCode).toBe(200);
  const r = new Database(dbPath, { readonly: true });
  const rows = r.prepare('select c.name as club, e.affiliation_number as number from clubs c join club_directory e on e.id = c.directory_club_id order by c.name').all();
  r.close();
  expect(rows).toEqual([
    { club: 'SHINSENGUMI DOJO VESUBIE', number: '0060789' },
    { club: 'Tani Dojo', number: '0060893' },
  ]);
});

test("base de l'étape 14 (olderDb(13)) avec trois clubs, dont deux de même nom dans deux compétitions → après ouverture, tous reliés, deux entrées", () => {
  const file = olderDb(13);
  const r = new Database(file);
  r.exec(`
    INSERT INTO competitions (id, name, date, settings_json) VALUES ('c2025', 'Coupe 2025', '2025-11-22', '{}'), ('c2026', 'Coupe 2026', '2026-11-22', '{}');
    INSERT INTO clubs (id, competition_id, name, name_key, coach_phone, pre_approval) VALUES
      ('k1', 'c2025', 'Tani Dojo', 'TANI DOJO', '0600000001', 0),
      ('k2', 'c2026', 'Tani Dojo', 'TANI DOJO', '0600000002', 0),
      ('k3', 'c2026', 'Issa', 'ISSA', null, 0);
  `);
  r.close();
  db = openDb(file);
  expect(db.$client.prepare('select count(*) as n from clubs where directory_club_id is null').get()).toEqual({ n: 0 });
  expect(entries(db).map((e) => [e.name, e.coach_phone])).toEqual([
    ['Issa', null],
    ['Tani Dojo', '0600000002'],
  ]);
});

test('club relié à une entrée sans numéro, qui reçoit ensuite un numéro déjà tenu par une autre entrée → relié à cette autre entrée', async () => {
  const { d, a, b } = await twoCompetitions();
  const ffk = await upsertClub(d, a, { name: 'TANI DOJO', ffkEntity: '0060893 TANI DOJO' });
  const typed = await upsertClub(d, b, { name: 'Dojo Tani' });
  expect(entryOf(d, typed.id)!.id).not.toBe(entryOf(d, ffk.id)!.id);
  await updateClub(d, b, typed.id, { ffkEntity: '0060893 TANI DOJO' });
  expect(entryOf(d, typed.id)!.id).toBe(entryOf(d, ffk.id)!.id);
});

test('club sans numéro, plusieurs entrées numérotées de même nom → nouvelle entrée (ambigu), pas un choix au hasard', async () => {
  const { d, a, b } = await twoCompetitions();
  await upsertClub(d, a, { name: 'KARATE CLUB', ffkEntity: '0060001 KARATE CLUB' });
  const c = await createCompetition(d, { name: 'Coupe 2027', date: '2027-11-22' });
  await upsertClub(d, c.id, { name: 'KARATE CLUB', ffkEntity: '0130002 KARATE CLUB' });
  const typed = await upsertClub(d, b, { name: 'Karate Club' });
  const entry = entryOf(d, typed.id)!;
  expect(entry.affiliation_number).toBeNull();
  expect(entries(d)).toHaveLength(3);
});

test('club sans numéro, une seule entrée numérotée de même nom → reliée à elle', async () => {
  const { d, a, b } = await twoCompetitions();
  const ffk = await upsertClub(d, a, { name: 'KARATE CLUB', ffkEntity: '0060001 KARATE CLUB' });
  const typed = await upsertClub(d, b, { name: 'Karate Club' });
  expect(entryOf(d, typed.id)!.id).toBe(entryOf(d, ffk.id)!.id);
});
