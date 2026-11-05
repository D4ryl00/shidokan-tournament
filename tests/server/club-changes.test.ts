import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

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
  await app.inject({ method: 'PATCH', url: `${competition}/club-entry`, payload: { status: 'open', deadline: '2026-11-15' } });
  return { token: link.token as string, clubId: link.clubId as string };
}
beforeEach(async () => {
  dbPath = tmpDbPath();
  app = await buildApp({ clubServices: true, dbPath });
  base = `/api/competitions/${(await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Coupe', date: '2026-11-22', location: 'Nice' } })).json().id}`;
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
  const other = (await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Open', date: '2026-12-05', location: 'Lyon' } })).json().id;
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
  const other = (await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Open', date: '2026-12-05', location: 'Lyon' } })).json().id;
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
