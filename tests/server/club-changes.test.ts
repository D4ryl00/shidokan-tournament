import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { onCompetitionChange } from '../../src/server/events.js';
import type { ClubFormParse } from '../../src/domain/club-form.js';
import { buildApp } from '../../src/server/app.js';
import { openDb } from '../../src/server/db/client.js';
import { createCompetition } from '../../src/server/repositories/competitions.js';
import { importClubForm } from '../../src/server/repositories/registrations.js';
import { BLANK, buildFfkWorkbook, type FfkLine } from '../helpers/ffk-fixture.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

/** Date locale `AAAA-MM-JJ` à n jours d'aujourd'hui : les compétitions « à venir » des tests le restent quelle que soit la date d'exécution. */
function inDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const p = (v: number) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
let app: FastifyInstance;
let dbPath: string;
let base: string;
let token: string;
let clubId: string;
let entryId: string;
const EMPTY = { affiliationNumber: null, coachName: null, coachPhone: null, coachEmails: [], notes: null };

async function createEntry(payload: Record<string, unknown>) {
  return (await app.inject({ method: 'POST', url: '/api/club-directory', payload: { ...EMPTY, ...payload } })).json().id as string;
}
async function invite(competition: string, id: string) {
  await app.inject({ method: 'POST', url: `${competition}/invitations`, payload: { directoryIds: [id] } });
  const [row] = (await app.inject({ method: 'GET', url: `${competition}/invitations` })).json();
  const link = (await app.inject({ method: 'POST', url: `${competition}/invitations/${row.clubId}/links` })).json();
  await app.inject({ method: 'PATCH', url: `${competition}/club-entry`, payload: { status: 'open', deadline: inDays(5) } });
  return { token: link.token as string, clubId: link.clubId as string };
}
beforeEach(async () => {
  dbPath = tmpDbPath();
  app = await buildApp({ clubServices: true, dbPath });
  base = `/api/competitions/${(await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Coupe', date: inDays(10), location: 'Nice' } })).json().id}`;
  entryId = await createEntry({ name: 'Tani Dojo', coachName: 'Jean', coachPhone: '0600000000', coachEmails: ['jean@tani.example'] });
  ({ token, clubId } = await invite(base, entryId));
});
afterEach(async () => app.close());

const header = (over: Record<string, unknown> = {}) => ({ coachName: 'Jean', coachPhone: '0600000000', coachEmails: ['jean@tani.example'], preApproval: false, affiliationNumber: null, ...over });
const patchClub = (over: Record<string, unknown> = {}) => app.inject({ method: 'PATCH', url: `/api/inscription/${token}/club`, payload: header(over) });
const pageView = async () => (await app.inject({ method: 'GET', url: `/api/inscription/${token}` })).json().club as { coachPhone: string | null; coachEmails: string[]; affiliationNumber: string | null };
const directory = async () => ((await app.inject({ method: 'GET', url: '/api/club-directory' })).json() as Record<string, unknown>[]).find((e) => e.id === entryId)!;
type Change = { club_id: string; origin: string; ignored: number; values_json: string };
const changes = () => {
  const db = new Database(dbPath, { readonly: true });
  const rows = db.prepare('select * from club_changes').all() as Change[];
  db.close();
  return rows;
};
const raw = (sql: string, ...params: unknown[]) => {
  const db = new Database(dbPath);
  db.prepare(sql).run(...params);
  db.close();
};

test('page du club : la fiche ne change pas, un changement d’origine « club » est enregistré', async () => {
  const res = await patchClub({ coachName: 'Paul', coachPhone: '0611111111', coachEmails: ['paul@tani.example'], affiliationNumber: '0060893' });
  expect(res.statusCode).toBe(200);
  expect(await directory()).toMatchObject({ coachName: 'Jean', coachPhone: '0600000000', coachEmails: ['jean@tani.example'], affiliationNumber: null });
  const [change] = changes();
  expect(change).toMatchObject({ club_id: clubId, origin: 'club', ignored: 0 });
  expect(JSON.parse(change!.values_json)).toMatchObject({ coachPhone: '0611111111', affiliationNumber: '0060893' });
});

test('sans différence : réenregistrer les valeurs de la fiche supprime la ligne', async () => {
  await patchClub({ coachPhone: '0611111111' });
  expect(changes()).toHaveLength(1);
  await patchClub();
  expect(changes()).toHaveLength(0);
});

test('un coach sans numéro, sur une fiche sans numéro, ne crée pas de différence', async () => {
  expect((await patchClub()).statusCode).toBe(200);
  expect(changes()).toHaveLength(0);
});

test('ignoré : mêmes valeurs → reste ignoré ; valeur différente → à examiner de nouveau', async () => {
  await patchClub({ coachPhone: '0611111111' });
  raw('update club_changes set ignored = 1');
  await patchClub({ coachPhone: '0611111111' });
  expect(changes()[0]!.ignored).toBe(1);
  await patchClub({ coachPhone: '0622222222' });
  expect(changes()[0]!.ignored).toBe(0);
});

test('effacement : téléphone et adresses effacés → différence ; la fiche garde ses valeurs ; la page ne les réaffiche pas', async () => {
  const res = await patchClub({ coachPhone: null, coachEmails: [] });
  expect(res.statusCode).toBe(200);
  expect(changes()).toHaveLength(1);
  expect(await directory()).toMatchObject({ coachPhone: '0600000000', coachEmails: ['jean@tani.example'] });
  expect(await pageView()).toMatchObject({ coachPhone: null, coachEmails: [] });
});

test('numéro : un numéro libre n’est pas écrit dans la fiche et la page le renvoie', async () => {
  await patchClub({ affiliationNumber: '0060893' });
  expect((await directory()).affiliationNumber).toBeNull();
  expect((await pageView()).affiliationNumber).toBe('0060893');
  expect(changes()).toHaveLength(1);
});

test('numéro : celui de la fiche, laissé en place, ne crée pas de différence', async () => {
  const withNumber = await createEntry({ name: 'Autre Dojo', affiliationNumber: '0061111' });
  const other = (await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Open', date: inDays(25), location: 'Lyon' } })).json().id;
  const access = await invite(`/api/competitions/${other}`, withNumber);
  const get = async () => (await app.inject({ method: 'GET', url: `/api/inscription/${access.token}` })).json().club;
  expect((await get()).affiliationNumber).toBe('0061111');
  const res = await app.inject({ method: 'PATCH', url: `/api/inscription/${access.token}/club`, payload: header({ coachName: null, coachPhone: null, coachEmails: [], affiliationNumber: '0061111' }) });
  expect(res.statusCode).toBe(200);
  expect(changes().filter((c) => c.club_id === access.clubId)).toHaveLength(0);
});

test('numéro effacé alors que la fiche en a un : null, et une différence', async () => {
  await patchClub({ affiliationNumber: null });
  raw('update club_directory set affiliation_number = ? where id = ?', '0060893', entryId);
  const res = await patchClub({ affiliationNumber: null });
  expect(res.statusCode).toBe(200);
  expect(res.json().affiliationNumber).toBeNull();
  expect((await pageView()).affiliationNumber).toBeNull();
  expect(changes()).toHaveLength(1);
  expect((await directory()).affiliationNumber).toBe('0060893');
});

test('numéro : refus conservés, sans rien écrire', async () => {
  await createEntry({ name: 'Autre Club', affiliationNumber: '0069999' });
  const taken = await patchClub({ affiliationNumber: '0069999' });
  expect(taken.statusCode).toBe(400);
  expect(taken.json().error).toBe('Ce numéro d’affiliation est celui d’un autre club de l’annuaire : contactez l’organisateur.');
  raw('update club_directory set affiliation_number = ? where id = ?', '0060893', entryId);
  const other = await patchClub({ affiliationNumber: '0130002' });
  expect(other.statusCode).toBe(400);
  expect(other.json().error).toBe('Ce club a déjà le numéro d’affiliation 0060893 : contactez l’organisateur.');
  expect(changes()).toHaveLength(0);
});

test('onglet Clubs : un nouveau nom et un téléphone créent un changement d’origine « competition », la fiche reste, même vide', async () => {
  const bare = await createEntry({ name: 'Sans Coordonnées' });
  const other = (await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Open', date: inDays(25), location: 'Lyon' } })).json().id;
  const otherBase = `/api/competitions/${other}`;
  const club = (await app.inject({ method: 'POST', url: `${otherBase}/clubs/from-directory`, payload: { directoryId: bare } })).json();
  expect(changes()).toHaveLength(0);
  const res = await app.inject({ method: 'PATCH', url: `${otherBase}/clubs/${club.id}`, payload: { name: 'Sans Coordonnées 2', coachPhone: '0633333333' } });
  expect(res.statusCode).toBe(200);
  const [change] = changes();
  expect(change).toMatchObject({ club_id: club.id, origin: 'competition' });
  const entry = ((await app.inject({ method: 'GET', url: '/api/club-directory' })).json() as Record<string, unknown>[]).find((e) => e.id === bare)!;
  expect(entry).toMatchObject({ name: 'Sans Coordonnées', coachPhone: null });
});

test('onglet Clubs : un patch sans coordonnées ne crée rien', async () => {
  const res = await app.inject({ method: 'PATCH', url: `${base}/clubs/${clubId}`, payload: { ffkEntity: '0060808 TANI' } });
  expect(res.statusCode).toBe(200);
  expect(changes()).toHaveLength(0);
  expect(await directory()).toMatchObject({ ffkEntity: null, affiliationNumber: null });
  // Renommer vers un nom de la table des alias ne complète pas la fiche non plus.
  const renamed = await app.inject({ method: 'PATCH', url: `${base}/clubs/${clubId}`, payload: { preApproval: true } });
  expect(renamed.statusCode).toBe(200);
  expect(await directory()).toMatchObject({ ffkEntity: null, affiliationNumber: null });
});

test('autres chemins : import d’une fiche et ajout d’un combattant ne créent pas de ligne', async () => {
  const dir = await createEntry({ name: 'Venu Dojo', coachPhone: '0644444444' });
  const club = (await app.inject({ method: 'POST', url: `${base}/clubs/from-directory`, payload: { directoryId: dir } })).json();
  await app.inject({ method: 'POST', url: `${base}/registrations`, payload: { clubId: club.id, lastName: 'DURAND', firstName: 'Hugo', sex: 'M', ageBandCode: 'senior', discipline: 'kata', ruleset: null, weightClassId: null, source: 'manual' } });
  expect(changes()).toHaveLength(0);
});

test('club sans fiche : la fiche créée par linkClub prend les valeurs du club, sans ligne', async () => {
  raw('update clubs set directory_club_id = null where id = ?', clubId);
  raw('delete from club_directory where id = ?', entryId);
  const res = await patchClub({ coachName: 'Paul', coachPhone: '0611111111', coachEmails: ['paul@tani.example'], affiliationNumber: '0060893' });
  expect(res.statusCode).toBe(200);
  const created = ((await app.inject({ method: 'GET', url: '/api/club-directory' })).json() as Record<string, unknown>[]).find((e) => e.name === 'Tani Dojo')!;
  expect(created).toMatchObject({ coachName: 'Paul', coachPhone: '0611111111', coachEmails: ['paul@tani.example'], affiliationNumber: '0060893' });
  expect(changes()).toHaveLength(0);
});

/** Fiche vide d'un club "Vide Dojo" et son accès, dans une autre compétition. */
async function emptyFicheAccess() {
  const id = await createEntry({ name: 'Vide Dojo' });
  const other = (await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Open', date: inDays(25), location: 'Lyon' } })).json().id;
  const access = await invite(`/api/competitions/${other}`, id);
  const save = (over: Record<string, unknown>) => app.inject({ method: 'PATCH', url: `/api/inscription/${access.token}/club`, payload: header({ coachName: null, coachPhone: null, coachEmails: [], ...over }) });
  const fiche = async () => ((await app.inject({ method: 'GET', url: '/api/club-directory' })).json() as Record<string, unknown>[]).find((e) => e.id === id)!;
  return { ...access, id, other, save, fiche };
}

test('un club déjà relié ne remplit plus la fiche : POST /clubs du même nom après une saisie du coach', async () => {
  const a = await emptyFicheAccess();
  await a.save({ coachPhone: '0655555555' });
  const res = await app.inject({ method: 'POST', url: `/api/competitions/${a.other}/clubs`, payload: { name: 'Vide Dojo', coachPhone: '0655555555' } });
  expect(res.statusCode).toBe(201);
  expect(await a.fiche()).toMatchObject({ coachPhone: null });
  expect(changes().filter((c) => c.club_id === a.clubId)).toHaveLength(1);
});

test('import d’une fiche club après une saisie du coach : la fiche reste vide, la ligne reste', async () => {
  const a = await emptyFicheAccess();
  await a.save({ coachName: 'Paul', coachPhone: '0655555555' });
  const repoDb = openDb(dbPath);
  const parse: ClubFormParse = { header: { club: 'Vide Dojo', coachName: 'Paul', coachPhone: '0655555555', coachEmails: ['p@vide.example'], preApproval: false }, rows: [] };
  await importClubForm(repoDb, a.other, parse);
  repoDb.$client.close();
  expect(await a.fiche()).toMatchObject({ coachName: null, coachPhone: null, coachEmails: [] });
  expect(changes().filter((c) => c.club_id === a.clubId)).toHaveLength(1);
});

test('import FFK après une saisie du coach : pas de ligne créée, la ligne existante reste, coordonnées de la fiche inchangées', async () => {
  const a = await emptyFicheAccess();
  await a.save({ coachPhone: '0655555555' });
  const lines: FfkLine[] = [['MARTIN LEA', null, 'L001', '0060893 VIDE DOJO', 'Feminine', 'Karate', 'Cadet', -61, null], BLANK];
  const file = buildFfkWorkbook({ 'Coupe Shidokan Karate': lines });
  const up = (await app.inject({ method: 'POST', url: `/api/competitions/${a.other}/ffk-imports`, payload: file, headers: { 'content-type': 'application/octet-stream', 'x-file-name': 'export.xlsx' } })).json();
  const commit = await app.inject({ method: 'POST', url: `/api/competitions/${a.other}/ffk-imports/${up.uploadId}/commit`, payload: { sheets: up.sheets } });
  expect(commit.statusCode).toBe(200);
  expect(await a.fiche()).toMatchObject({ coachPhone: null });
  expect(changes().filter((c) => c.club_id === a.clubId)).toHaveLength(1);
});

test('import d’une fiche et import FFK d’un club neuf ne créent aucune ligne', async () => {
  const repoDb = openDb(dbPath);
  const other = (await createCompetition(repoDb, { name: 'Autre', date: inDays(32) })).id;
  await importClubForm(repoDb, other, { header: { club: 'Neuf Dojo', coachName: 'Z', coachPhone: '0600', coachEmails: [], preApproval: false }, rows: [] });
  repoDb.$client.close();
  expect(changes()).toHaveLength(0);
  const file = buildFfkWorkbook({ 'Coupe Shidokan Karate': [['MARTIN LEA', null, 'L001', '0060999 AUTRE DOJO', 'Feminine', 'Karate', 'Cadet', -61, null], BLANK] });
  const up = (await app.inject({ method: 'POST', url: `/api/competitions/${other}/ffk-imports`, payload: file, headers: { 'content-type': 'application/octet-stream', 'x-file-name': 'export.xlsx' } })).json();
  expect((await app.inject({ method: 'POST', url: `/api/competitions/${other}/ffk-imports/${up.uploadId}/commit`, payload: { sheets: up.sheets } })).statusCode).toBe(200);
  expect(changes()).toHaveLength(0);
});

test('club sans lien rapproché d’une fiche existante vide : la fiche n’est pas remplie, la différence est proposée', async () => {
  const empty = await createEntry({ name: 'Tani Dojo' }); // même nom, fiche vide
  raw('update club_directory set coach_name = null, coach_phone = null, coach_emails = ? where id = ?', '[]', entryId);
  raw('update clubs set directory_club_id = null where id = ?', clubId);
  raw('delete from club_directory where id = ?', empty);
  const res = await patchClub({ coachName: 'Paul', coachPhone: '0611111111', coachEmails: ['p@tani.example'], affiliationNumber: '0060893' });
  expect(res.statusCode).toBe(200);
  expect(await directory()).toMatchObject({ coachName: null, coachPhone: null, coachEmails: [], affiliationNumber: null });
  expect(changes()).toHaveLength(1);
  expect((await pageView()).affiliationNumber).toBe('0060893');
});

test('numéro gardé pour le club : une correction de la fiche ne bloque pas un réenregistrement identique', async () => {
  await patchClub({ affiliationNumber: '0060893' });
  raw('update club_directory set affiliation_number = ? where id = ?', '0061234', entryId);
  expect((await patchClub({ affiliationNumber: '0060893' })).statusCode).toBe(200);
});

test('numéro gardé pour le club : pris ensuite par une autre fiche, un changement de téléphone passe', async () => {
  await patchClub({ affiliationNumber: '0060893' });
  await createEntry({ name: 'Autre Club', affiliationNumber: '0060893' });
  const res = await patchClub({ affiliationNumber: '0060893', coachPhone: '0622222222' });
  expect(res.statusCode).toBe(200);
});

test('numéro de la fiche laissé en place : non gardé pour le club, aucune modification par le club', async () => {
  raw('update club_directory set affiliation_number = ? where id = ?', '0060893', entryId);
  expect((await patchClub({ affiliationNumber: '0060893' })).statusCode).toBe(200);
  raw('update clubs set affiliation_number = affiliation_number where id = ?', clubId);
  const db = new Database(dbPath, { readonly: true });
  expect(db.prepare('select affiliation_number as n from clubs where id = ?').get(clubId)).toEqual({ n: null });
  db.close();
  expect(changes()).toHaveLength(0);
  // Si l'organisateur corrige la fiche ensuite, le club suit.
  raw('update club_directory set affiliation_number = ? where id = ?', '0061234', entryId);
  expect((await pageView()).affiliationNumber).toBe('0061234');
});

test('sans changement de champ comparé : aucune ligne créée ni redatée, origine inchangée', async () => {
  // L'organisateur retire les adresses de la fiche ; le coach ne change que le pré-accord.
  raw('update club_directory set coach_emails = ? where id = ?', '[]', entryId);
  await patchClub({ preApproval: true });
  expect(changes()).toHaveLength(0);
  // Avec une ligne existante d'origine « competition » : un enregistrement sans changement de champ ne la redate pas.
  await app.inject({ method: 'PATCH', url: `${base}/clubs/${clubId}`, payload: { coachPhone: '0699999999' } });
  const [before] = changes();
  expect(before!.origin).toBe('competition');
  raw("update club_changes set changed_at = '2020-01-01T00:00:00.000Z'");
  await patchClub({ coachPhone: '0699999999', preApproval: false });
  const [after] = changes();
  expect(after).toMatchObject({ origin: 'competition' });
  expect((new Database(dbPath, { readonly: true }).prepare('select changed_at as c from club_changes').get() as { c: string }).c).toBe('2020-01-01T00:00:00.000Z');
});

test('nouveau lien sans coordonnées : le changement existant se rattache à la nouvelle fiche', async () => {
  const holder = await createEntry({ name: 'Autre Fiche', affiliationNumber: '0060808' });
  await patchClub({ coachPhone: '0611111111' });
  expect(changes()).toHaveLength(1);
  const res = await app.inject({ method: 'PATCH', url: `${base}/clubs/${clubId}`, payload: { ffkEntity: '0060808 TANI DOJO' } });
  expect(res.statusCode).toBe(200);
  const db = new Database(dbPath, { readonly: true });
  expect(db.prepare('select directory_id as d from club_changes').get()).toEqual({ d: holder });
  db.close();
});

test('numéro effacé : « » seulement si la fiche a un numéro', async () => {
  await patchClub({ affiliationNumber: '0060893' }); // numéro du club, fiche sans numéro
  await patchClub({ affiliationNumber: null });
  const db = new Database(dbPath, { readonly: true });
  expect(db.prepare('select affiliation_number as n from clubs where id = ?').get(clubId)).toEqual({ n: null });
  db.close();
});

// --- Décisions et report vers les compétitions à venir ---

type View = { clubId: string; competitionId: string; directoryVersion: number; changedAt: string; fields: string[]; values: Record<string, unknown>; directory: Record<string, unknown>; managedHere: boolean; upcoming: boolean };
const list = async (query = '') => (await app.inject({ method: 'GET', url: `/api/club-changes${query}` })).json() as View[];
const resolve = (id: string, view: { directoryVersion: number; changedAt: string }, values: Record<string, unknown>, applyToClub = false) =>
  app.inject({ method: 'POST', url: `/api/club-changes/${id}/resolve`, payload: { directoryVersion: view.directoryVersion, changedAt: view.changedAt, values: { affiliationNumber: null, coachName: null, coachPhone: null, coachEmails: [], name: 'Tani Dojo', ...values }, applyToClub } });
const patchEntry = async (payload: Record<string, unknown>, id = entryId) => app.inject({ method: 'PATCH', url: `/api/club-directory/${id}`, payload });
const ignore = (id: string, view: { changedAt: string }) => app.inject({ method: 'POST', url: `/api/club-changes/${id}/ignore`, payload: { changedAt: view.changedAt } });
const applyToClubs = (items: unknown[], id = entryId) => app.inject({ method: 'POST', url: `/api/club-directory/${id}/apply-to-clubs`, payload: { items } });
const shown = (field: string, clubValue: unknown, directoryValue: unknown) => ({ field, clubValue, directoryValue });
type Line = { clubId: string; competitionName: string; managedHere: boolean; field: string; kind: string; clubValue: unknown; directoryValue: unknown };
const clubRow = (id: string) => {
  const db = new Database(dbPath, { readonly: true });
  const row = db.prepare('select name, name_key, coach_phone, affiliation_number from clubs where id = ?').get(id) as { name: string; name_key: string; coach_phone: string | null; affiliation_number: string | null };
  db.close();
  return row;
};
/** Une autre compétition où un club relié à la fiche existe. */
async function otherCompetition(name: string, date: string, coachPhone: string | null = '0600000000') {
  const id = (await app.inject({ method: 'POST', url: '/api/competitions', payload: { name, date, location: 'Lyon' } })).json().id as string;
  const club = (await app.inject({ method: 'POST', url: `/api/competitions/${id}/clubs/from-directory`, payload: { directoryId: entryId } })).json();
  if (coachPhone !== '0600000000') await app.inject({ method: 'PATCH', url: `/api/competitions/${id}/clubs/${club.id}`, payload: { coachPhone } });
  return { id, clubId: club.id as string };
}

test('GET /api/club-changes : ignoré et archivé absents, désarchiver fait revenir, filtre par compétition, ligne identique supprimée', async () => {
  await patchClub({ coachPhone: '0611111111' });
  const [view] = await list();
  expect(view).toMatchObject({ clubId, competitionId: base.split('/').pop(), fields: ['coachPhone'], managedHere: true, upcoming: true });
  expect(view!.values).toMatchObject({ coachPhone: '0611111111' });
  expect(view!.directory).toMatchObject({ coachPhone: '0600000000' });
  expect(await list('?competitionId=autre')).toHaveLength(0);
  expect(await list(`?competitionId=${view!.competitionId}`)).toHaveLength(1);
  await patchEntry({ archived: true });
  expect(await list()).toHaveLength(0);
  await patchEntry({ archived: false });
  expect(await list()).toHaveLength(1);
  expect((await ignore(clubId, view!)).statusCode).toBe(204);
  expect(await list()).toHaveLength(0);
  expect(changes()).toHaveLength(1);
  await patchClub({ coachPhone: '0622222222' });
  expect(await list()).toHaveLength(1);
  // la fiche prend la valeur du club : la ligne n'a plus de différence et disparaît
  await patchEntry({ coachPhone: '0622222222' });
  expect(await list()).toHaveLength(0);
  expect(changes()).toHaveLength(0);
});

test('resolve : la fiche prend les valeurs, le club aussi avec applyToClub, la ligne disparaît', async () => {
  await patchClub({ coachPhone: '0611111111', coachName: 'Paul' });
  const [view] = await list();
  const res = await resolve(clubId, view!, { coachName: 'Paul', coachPhone: '0633333333', coachEmails: ['jean@tani.example'], affiliationNumber: '0060893' }, true);
  expect(res.statusCode).toBe(204);
  expect(await directory()).toMatchObject({ coachName: 'Paul', coachPhone: '0633333333', affiliationNumber: '0060893' });
  expect(clubRow(clubId)).toMatchObject({ coach_phone: '0633333333', affiliation_number: null });
  expect(changes()).toHaveLength(0);
});

test('resolve sans applyToClub : le club garde ses valeurs', async () => {
  await patchClub({ coachPhone: '0611111111' });
  const [view] = await list();
  expect((await resolve(clubId, view!, { coachName: 'Jean', coachPhone: '0644444444', coachEmails: ['jean@tani.example'] })).statusCode).toBe(204);
  expect(await directory()).toMatchObject({ coachPhone: '0644444444' });
  expect(clubRow(clubId).coach_phone).toBe('0611111111');
  expect(changes()).toHaveLength(0);
});

test('resolve : effacement choisi → la fiche est vidée', async () => {
  await patchClub({ coachPhone: null, coachEmails: [] });
  const [view] = await list();
  expect(view!.fields).toEqual(['coachPhone', 'coachEmails']);
  expect((await resolve(clubId, view!, { coachName: 'Jean' })).statusCode).toBe(204);
  expect(await directory()).toMatchObject({ coachPhone: null, coachEmails: [] });
});

test('resolve : un autre changement sur la même fiche devient identique → supprimé, sinon gardé', async () => {
  const same = await otherCompetition('Open A', inDays(20), '0611111111');
  const different = await otherCompetition('Open B', inDays(30), '0699999999');
  await patchClub({ coachPhone: '0611111111' });
  expect(changes()).toHaveLength(3);
  // les clubs modifiés par l'organisateur ont aussi une ligne
  expect((await list()).map((v) => v.clubId).sort()).toEqual([clubId, same.clubId, different.clubId].sort());
  const mine = (await list()).find((v) => v.clubId === clubId)!;
  expect((await resolve(clubId, mine, { coachName: 'Jean', coachPhone: '0611111111', coachEmails: ['jean@tani.example'] })).statusCode).toBe(204);
  expect((await list()).map((v) => v.clubId)).toEqual([different.clubId]);
});

test('resolve, refus : fiche modifiée depuis l’ouverture (409), rien d’écrit', async () => {
  await patchClub({ coachPhone: '0611111111' });
  const [view] = await list();
  await patchEntry({ notes: 'modifiée entre-temps' });
  const res = await resolve(clubId, view!, { coachName: 'Jean', coachPhone: '0655555555', coachEmails: ['jean@tani.example'] }, true);
  expect(res.statusCode).toBe(409);
  expect(res.json().error).toBe('Cette fiche vient de changer : rouvrez la comparaison.');
  expect(await directory()).toMatchObject({ coachPhone: '0600000000' });
  expect(clubRow(clubId).coach_phone).toBe('0611111111');
  expect(changes()).toHaveLength(1);
});

test('resolve, refus : numéro d’une autre fiche', async () => {
  await createEntry({ name: 'Autre Dojo', affiliationNumber: '0060893' });
  await patchClub({ coachPhone: '0611111111' });
  const [view] = await list();
  const res = await resolve(clubId, view!, { coachName: 'Jean', coachPhone: '0611111111', coachEmails: ['jean@tani.example'], affiliationNumber: '0060893' });
  expect(res.statusCode).toBe(409);
  expect(res.json().error).toBe('Ce numéro d’affiliation est déjà celui de « Autre Dojo ».');
  expect(await directory()).toMatchObject({ coachPhone: '0600000000' });
  expect(changes()).toHaveLength(1);
});

test('resolve, refus : applyToClub sur une compétition gérée ailleurs ou passée → 409, fiche inchangée', async () => {
  await patchClub({ coachPhone: '0611111111' });
  const [view] = await list();
  const values = { coachName: 'Jean', coachPhone: '0677777777', coachEmails: ['jean@tani.example'] };
  raw("update competitions set owner_instance_id = 'ailleurs', owner_name = 'PC Nice' where id = ?", view!.competitionId);
  const managed = await resolve(clubId, view!, values, true);
  expect(managed.statusCode).toBe(409);
  expect(managed.json().error).toContain('Compétition gérée par PC Nice');
  raw('update competitions set owner_instance_id = null, owner_name = null, date = ? where id = ?', inDays(-200), view!.competitionId);
  const past = await resolve(clubId, view!, values, true);
  expect(past.statusCode).toBe(409);
  expect(await directory()).toMatchObject({ coachPhone: '0600000000' });
  expect(changes()).toHaveLength(1);
});

test('resolve, refus : nom déjà pris dans la compétition, rien d’écrit', async () => {
  await createEntry({ name: 'Rival Dojo' });
  await app.inject({ method: 'POST', url: `${base}/clubs/from-directory`, payload: { directoryId: (await (app.inject({ method: 'GET', url: '/api/club-directory' }))).json().find((e: { name: string }) => e.name === 'Rival Dojo').id } });
  await patchClub({ coachPhone: '0611111111' });
  const [view] = await list();
  const res = await resolve(clubId, view!, { name: 'Rival Dojo', coachName: 'Jean', coachPhone: '0611111111', coachEmails: ['jean@tani.example'] }, true);
  expect(res.statusCode).toBe(409);
  expect(await directory()).toMatchObject({ name: 'Tani Dojo' });
});

test('PATCH fiche : upcoming vide sans club qui diffère, notes ou archivage seuls', async () => {
  expect((await patchEntry({ notes: 'x' })).json().upcoming).toEqual([]);
  expect((await patchEntry({ archived: true })).json().upcoming).toEqual([]);
  await patchEntry({ archived: false });
  const res = await patchEntry({ coachPhone: '0600000000' });
  expect(res.json().upcoming).toEqual([]);
});

test('PATCH fiche : apply, conflict, compétition passée absente, gérée ailleurs présente, fiche enregistrée', async () => {
  const conflict = await otherCompetition('Open A', inDays(20), '0688888888');
  const past = await otherCompetition('Ancienne', inDays(-300));
  const away = await otherCompetition('Chez PC', inDays(40));
  raw("update competitions set owner_instance_id = 'ailleurs', owner_name = 'PC Nice' where id = ?", away.id);
  const res = await patchEntry({ coachPhone: '0612121212' });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toMatchObject({ coachPhone: '0612121212' });
  const upcoming = res.json().upcoming as Line[];
  const by = (id: string) => upcoming.find((l) => l.clubId === id);
  expect(by(clubId)).toMatchObject({ field: 'coachPhone', kind: 'apply', clubValue: '0600000000', directoryValue: '0612121212', managedHere: true });
  expect(by(conflict.clubId)).toMatchObject({ kind: 'conflict', clubValue: '0688888888' });
  expect(by(away.clubId)).toMatchObject({ kind: 'apply', managedHere: false, competitionName: 'Chez PC' });
  expect(by(past.clubId)).toBeUndefined();
  expect(upcoming).toHaveLength(3);
});

test('PATCH fiche : numéro refusé → 409 et upcoming sans objet', async () => {
  await createEntry({ name: 'Autre Dojo', affiliationNumber: '0060893' });
  const res = await patchEntry({ affiliationNumber: '0060893' });
  expect(res.statusCode).toBe(409);
});

test('apply-to-clubs : champs choisis (valeur vide comprise), nom pris refusé sans bloquer les autres, gérée ailleurs refusée, ligne identique supprimée', async () => {
  const taken = await otherCompetition('Open A', inDays(20));
  const away = await otherCompetition('Chez PC', inDays(40));
  await app.inject({ method: 'POST', url: `/api/competitions/${taken.id}/clubs`, payload: { name: 'Tani Karaté' } });
  await patchEntry({ coachPhone: null, name: 'Tani Karaté' });
  raw("update competitions set owner_instance_id = 'ailleurs', owner_name = 'PC Nice' where id = ?", away.id);
  await patchClub({ coachPhone: '0611111111' });
  expect(changes()).toHaveLength(1);
  const res = await app.inject({
    method: 'POST', url: `/api/club-directory/${entryId}/apply-to-clubs`,
    payload: {
      items: [
        { clubId, fields: [shown('name', 'Tani Dojo', 'Tani Karaté'), shown('coachPhone', '0611111111', null)] },
        { clubId: taken.clubId, fields: [shown('name', 'Tani Dojo', 'Tani Karaté'), shown('coachPhone', '0600000000', null)] },
        { clubId: away.clubId, fields: [shown('name', 'Tani Dojo', 'Tani Karaté')] },
      ],
    },
  });
  expect(res.statusCode).toBe(200);
  const [mine, clash, remote] = res.json() as { competitionName: string; status: string; message: string | null }[];
  expect(mine).toMatchObject({ competitionName: 'Coupe', status: 'applied', message: null });
  expect(clash).toMatchObject({ competitionName: 'Open A', status: 'refused' });
  expect(clash!.message).toContain('Tani Karaté');
  expect(remote).toMatchObject({ status: 'refused' });
  expect(remote!.message).toContain('PC Nice');
  expect(clubRow(clubId)).toMatchObject({ name: 'Tani Karaté', name_key: 'TANI KARATE', coach_phone: null });
  expect(clubRow(taken.clubId).name).toBe('Tani Dojo');
  expect(changes().find((c) => c.club_id === clubId)).toBeUndefined();
});

const STALE = 'Cette fiche vient de changer : rouvrez la comparaison.';
const sleep = () => new Promise((r) => setTimeout(r, 5));

test('comparaison ouverte, le coach enregistre une nouvelle valeur : resolve (avec ou sans applyToClub) et ignore refusent', async () => {
  await patchClub({ coachPhone: '0611111111' });
  const [view] = await list();
  await sleep();
  await patchClub({ coachPhone: '0622222222' });
  const values = { coachName: 'Jean', coachPhone: '0699999999', coachEmails: ['jean@tani.example'] };
  for (const apply of [false, true]) {
    const res = await resolve(clubId, view!, values, apply);
    expect(res.statusCode, `applyToClub ${apply}`).toBe(409);
    expect(res.json().error).toBe(STALE);
  }
  const ignored = await ignore(clubId, view!);
  expect(ignored.statusCode).toBe(409);
  expect(ignored.json().error).toBe(STALE);
  expect(await directory()).toMatchObject({ coachPhone: '0600000000' });
  expect(clubRow(clubId).coach_phone).toBe('0622222222');
  expect(await list()).toHaveLength(1);
});

test('apply-to-clubs : valeur du club changée depuis l’affichage → refusé ; fiche changée depuis l’affichage → refusé', async () => {
  await patchEntry({ coachPhone: '0612121212' });
  await patchClub({ coachPhone: '0633333333' });
  const stale = await applyToClubs([{ clubId, fields: [shown('coachPhone', '0600000000', '0612121212')] }]);
  expect(stale.json()[0]).toMatchObject({ status: 'refused', message: 'Ce club ou cette fiche vient de changer : recommencez.' });
  expect(clubRow(clubId).coach_phone).toBe('0633333333');
  const changedEntry = await applyToClubs([{ clubId, fields: [shown('coachPhone', '0633333333', '0600000000')] }]);
  expect(changedEntry.json()[0]).toMatchObject({ status: 'refused' });
  expect(clubRow(clubId).coach_phone).toBe('0633333333');
  const fresh = await applyToClubs([{ clubId, fields: [shown('coachPhone', '0633333333', '0612121212')] }]);
  expect(fresh.json()[0]).toMatchObject({ status: 'applied' });
  expect(clubRow(clubId).coach_phone).toBe('0612121212');
});

test('resolve : nom déjà pris par une autre fiche → 409, avec et sans applyToClub, rien d’écrit', async () => {
  await createEntry({ name: 'Rival Dojo' });
  await patchClub({ coachPhone: '0611111111' });
  const [view] = await list();
  for (const apply of [false, true]) {
    const res = await resolve(clubId, view!, { name: 'rival dojo', coachName: 'Jean', coachPhone: '0611111111', coachEmails: ['jean@tani.example'] }, apply);
    expect(res.statusCode, `applyToClub ${apply}`).toBe(409);
    expect(res.json().error).toContain('Rival Dojo');
  }
  expect(await directory()).toMatchObject({ name: 'Tani Dojo', coachPhone: '0600000000' });
  expect(changes()).toHaveLength(1);
});

test('PATCH fiche : dès qu’un champ change, tous les champs qui diffèrent sont proposés ; une différence restée d’une fenêtre fermée est un conflit', async () => {
  const first = await patchEntry({ coachPhone: '0612121212' });
  expect((first.json().upcoming as Line[]).map((l) => `${l.field}:${l.kind}`)).toEqual(['coachPhone:apply']);
  const second = await patchEntry({ coachName: 'Paul' });
  const lines = second.json().upcoming as Line[];
  expect(lines.map((l) => `${l.field}:${l.kind}`).sort()).toEqual(['coachName:apply', 'coachPhone:conflict']);
  // notes seules : rien
  expect((await patchEntry({ notes: 'x' })).json().upcoming).toEqual([]);
});

test('resolve : une ligne ignorée ou une fiche archivée n’est plus résolue (404)', async () => {
  await patchClub({ coachPhone: '0611111111' });
  const [view] = await list();
  const values = { coachName: 'Jean', coachPhone: '0611111111', coachEmails: ['jean@tani.example'] };
  await patchEntry({ archived: true });
  expect((await resolve(clubId, view!, values)).statusCode).toBe(404);
  await patchEntry({ archived: false });
  const [fresh] = await list();
  expect((await ignore(clubId, fresh!)).statusCode).toBe(204);
  expect((await resolve(clubId, fresh!, values)).statusCode).toBe(404);
  expect(await directory()).toMatchObject({ coachPhone: '0600000000' });
});

test('application partielle : la ligne ignorée ensuite revient si le coach remet son ancienne valeur', async () => {
  await patchEntry({ name: 'Tani Karaté' });
  await patchClub({ coachPhone: '0611111111' });
  await applyToClubs([{ clubId, fields: [shown('name', 'Tani Dojo', 'Tani Karaté')] }]);
  expect(clubRow(clubId).name).toBe('Tani Karaté');
  const [view] = await list();
  expect(view!.fields).toEqual(['coachPhone']);
  expect((await ignore(clubId, view!)).statusCode).toBe(204);
  expect(await list()).toHaveLength(0);
  await patchClub({ coachPhone: '0611111111' });
  expect(await list()).toHaveLength(0);
  raw('update clubs set name = ? where id = ?', 'Tani Dojo', clubId);
  await patchClub({ coachPhone: '0611111111', coachName: 'Marc' });
  expect(await list()).toHaveLength(1);
});

test('apply-to-clubs : fiche inconnue → 404 ; club inconnu → refusé avec un nom de compétition non vide', async () => {
  expect((await applyToClubs([], 'inconnue')).statusCode).toBe(404);
  const res = await applyToClubs([{ clubId: 'inconnu', fields: [shown('coachPhone', null, null)] }]);
  expect(res.json()[0].status).toBe('refused');
  expect(res.json()[0].competitionName).not.toBe('');
});

test('resolve : un numéro de longueur autre que 7 déjà dans la fiche peut être résolu', async () => {
  raw("update club_directory set affiliation_number = '12345' where id = ?", entryId);
  await patchClub({ coachPhone: '0611111111' });
  const [view] = await list();
  const res = await resolve(clubId, view!, { coachName: 'Jean', coachPhone: '0611111111', coachEmails: ['jean@tani.example'], affiliationNumber: '12345' });
  expect(res.statusCode).toBe(204);
  expect(await directory()).toMatchObject({ affiliationNumber: '12345' });
});

test('resolve et apply-to-clubs préviennent les postes qui affichent la compétition', async () => {
  const competitionId = base.split('/').pop()!;
  const seen: unknown[] = [];
  const off = onCompetitionChange(competitionId, () => seen.push(1));
  await patchClub({ coachPhone: '0611111111' });
  const [view] = await list();
  seen.length = 0;
  await resolve(clubId, view!, { coachName: 'Jean', coachPhone: '0611111111', coachEmails: ['jean@tani.example'] }, true);
  expect(seen).toHaveLength(1);
  await patchEntry({ coachPhone: '0644444444' });
  seen.length = 0;
  await applyToClubs([{ clubId, fields: [shown('coachPhone', '0611111111', '0644444444')] }]);
  expect(seen).toHaveLength(1);
  off();
});
