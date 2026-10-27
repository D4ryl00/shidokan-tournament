import { beforeEach, expect, test } from 'vitest';
import type { ClubFormParse } from '../../src/domain/club-form.js';
import { ffkDefaultGrid } from '../../src/domain/grid-ffk.js';
import type { RegistrationInput } from '../../src/domain/registration.js';
import { openDb, type AppDb } from '../../src/server/db/client.js';
import { GridValidationError, createCompetition, getGrid, replaceGrid } from '../../src/server/repositories/competitions.js';
import {
  RegistrationValidationError,
  createRegistration,
  deleteRegistration,
  importClubForm,
  listClubs,
  listRegistrations,
  upsertClub,
} from '../../src/server/repositories/registrations.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

let db: AppDb;
let cid: string;
beforeEach(async () => {
  db = openDb(tmpDbPath());
  cid = (await createCompetition(db, { name: 'Coupe', date: '2026-11-22' })).id;
});

const input = (over: Partial<RegistrationInput> = {}): RegistrationInput => ({
  clubId: null, lastName: 'MARTIN', firstName: 'Léa', sex: 'F', ageBandCode: 'cadet', discipline: 'karate',
  ruleset: 'jiyu', weightClassId: 'cadet:F:-54', otherDisciplines: [], source: 'manual', ...over,
});

const form = (club: string, names: string[], preApproval = false): ClubFormParse => ({
  header: { club, coachName: 'Coach', coachPhone: '0600', coachEmails: [], preApproval },
  rows: names.map((n, i) => ({ line: 12 + i, label: n, input: input({ lastName: n, source: 'club_form' }), errors: [], warnings: [] })),
});

test('karaté + kata pour le même combattant : un seul combattant', async () => {
  const club = await upsertClub(db, cid, { name: 'Tani Dojo', ffkEntity: null, coachName: null, coachPhone: null, coachEmails: [], preApproval: false });
  await createRegistration(db, cid, input({ clubId: club.id }));
  await createRegistration(db, cid, input({ clubId: club.id, discipline: 'kata', ruleset: null, weightClassId: null, firstName: 'léa ' }));
  const rows = await listRegistrations(db, cid);
  expect(rows).toHaveLength(2);
  expect(new Set(rows.map((r) => r.fighterId)).size).toBe(1);
  expect(rows[0]!.club?.name).toBe('Tani Dojo');
});

test('shobu minime refusé', async () => {
  await expect(
    createRegistration(db, cid, input({ ageBandCode: 'minime', ruleset: 'shobu', weightClassId: 'minime:F:-45' })),
  ).rejects.toThrow(RegistrationValidationError);
});

test('deuxième discipline de combat : avertissement', async () => {
  await createRegistration(db, cid, input());
  const { warning } = await createRegistration(db, cid, input({ discipline: 'shido-boxing' }));
  expect(warning).toMatch(/Karaté/);
});

test('supprimer la dernière inscription supprime le combattant', async () => {
  const { row } = await createRegistration(db, cid, input());
  await deleteRegistration(db, cid, row.id);
  expect(await listRegistrations(db, cid)).toEqual([]);
  const again = await createRegistration(db, cid, input());
  expect(again.row.fighterId).not.toBe(row.fighterId);
});

test('réimport de la fiche corrigée d’un club : remplace sans doublons, garde les saisies manuelles', async () => {
  const first = await importClubForm(db, cid, form('Tani Dojo', ['A', 'B', 'C']));
  expect(first).toMatchObject({ imported: 3, replaced: 0, skipped: 0 });
  await createRegistration(db, cid, input({ clubId: first.club.id, lastName: 'MANUEL' }));
  const second = await importClubForm(db, cid, form('TANI DOJO', ['A', 'D'], true));
  expect(second).toMatchObject({ imported: 2, replaced: 3 });
  const rows = await listRegistrations(db, cid);
  expect(rows.map((r) => r.fighter.lastName).sort()).toEqual(['A', 'D', 'MANUEL']);
  const clubs = await listClubs(db, cid);
  expect(clubs).toHaveLength(1);
  expect(clubs[0]!.preApproval).toBe(true);
  expect(clubs[0]!.coachPhone).toBe('0600');
});

test('lignes en erreur comptées comme ignorées', async () => {
  const f = form('Tani', ['A']);
  f.rows.push({ line: 13, label: 'X', input: null, errors: ['x'], warnings: [] });
  expect(await importClubForm(db, cid, f)).toMatchObject({ imported: 1, skipped: 1 });
});

test('grille : une catégorie utilisée ne peut pas être supprimée, une vide oui', async () => {
  await createRegistration(db, cid, input());
  const g = await getGrid(db, cid);
  const without54 = { ...g, weightClasses: g.weightClasses.filter((w) => w.id !== 'cadet:F:-54') };
  await expect(replaceGrid(db, cid, without54)).rejects.toThrow(GridValidationError);
  await expect(replaceGrid(db, cid, without54)).rejects.toThrow(/Cadets féminines -54 contient 1 inscription/);
  const without47 = { ...g, weightClasses: g.weightClasses.filter((w) => w.id !== 'cadet:F:-47') };
  await expect(replaceGrid(db, cid, without47)).resolves.toBeUndefined();
});

test('renommer une catégorie utilisée se propage', async () => {
  await createRegistration(db, cid, input());
  const g = ffkDefaultGrid();
  const wc = g.weightClasses.find((w) => w.id === 'cadet:F:-54')!;
  wc.label = '-55';
  wc.maxKg = 55;
  await replaceGrid(db, cid, g);
  const [row] = await listRegistrations(db, cid);
  expect(row!.weightClassId).toBe('cadet:F:-54');
  expect((await getGrid(db, cid)).weightClasses.find((w) => w.id === row!.weightClassId)!.label).toBe('-55');
});

test('réimport : identifiants, licence et entité FFK conservés', async () => {
  const first = await importClubForm(db, cid, form('Tani Dojo', ['A', 'B']));
  const before = await listRegistrations(db, cid);
  db.$client.prepare('update fighters set licence = ?').run('LIC123');
  db.$client.prepare('update clubs set ffk_entity = ?').run('0060893 TANI DOJO');
  await importClubForm(db, cid, form('Tani Dojo', ['A', 'B', 'C']));
  const after = await listRegistrations(db, cid);
  const ids = (rows: typeof before, name: string) => rows.filter((r) => r.fighter.lastName === name).map((r) => [r.id, r.fighterId]);
  expect(ids(after, 'A')).toEqual(ids(before, 'A'));
  expect(after.find((r) => r.fighter.lastName === 'A')!.fighter.licence).toBe('LIC123');
  expect((await listClubs(db, cid))[0]!.ffkEntity).toBe('0060893 TANI DOJO');
  expect(first.club.id).toBe((await listClubs(db, cid))[0]!.id);
});

test('upsertClub ne remplace pas les coordonnées existantes par des champs absents', async () => {
  await upsertClub(db, cid, { name: 'Tani', ffkEntity: null, coachName: 'Jean', coachPhone: '06', coachEmails: [], preApproval: true });
  const again = await upsertClub(db, cid, { name: 'TANI' });
  expect(again).toMatchObject({ coachName: 'Jean', coachPhone: '06', preApproval: true });
});
