import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { LEGACY_FORM_REFUSED } from '../../src/domain/club-form-read.js';
import { buildApp } from '../../src/server/app.js';
import { fillClubForm } from '../helpers/club-form-fill.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

/** Date locale `AAAA-MM-JJ` à n jours d'aujourd'hui : la compétition reste « à venir » quelle que soit la date d'exécution. */
function inDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const p = (v: number) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

let app: FastifyInstance;
let base: string;
const newCompetition = async (name: string) =>
  `/api/competitions/${(await app.inject({ method: 'POST', url: '/api/competitions', payload: { name, date: inDays(10) } })).json().id}`;
beforeEach(async () => {
  app = await buildApp({ dbPath: tmpDbPath() });
  base = await newCompetition('Coupe');
});
afterEach(async () => app.close());

const upload = (url: string, body: Buffer) =>
  app.inject({ method: 'POST', url, payload: body, headers: { 'content-type': 'application/octet-stream' } });
const template = async () => (await app.inject({ method: 'GET', url: `${base}/club-form.ods` })).rawPayload;
const get = async <T = unknown>(url: string) => (await app.inject({ method: 'GET', url })).json() as T;

const JEAN = { coachName: 'Jean', coachPhone: '0600000000', coachEmails: ['jean@tani.example'], preApproval: false };
const PAUL = { coachName: 'Paul', coachPhone: '0611111111', coachEmails: ['jean@tani.example', 'paul@tani.example'], preApproval: true };

async function directoryClub(competition = base) {
  const entry = (await app.inject({
    method: 'POST', url: '/api/club-directory',
    payload: { name: 'Tani Dojo', affiliationNumber: null, coachName: 'Jean', coachPhone: '0600000000', coachEmails: ['jean@tani.example'], notes: null },
  })).json() as { id: string };
  const club = (await app.inject({ method: 'POST', url: `${competition}/clubs/from-directory`, payload: { directoryId: entry.id } })).json() as { id: string };
  return { entryId: entry.id, clubId: club.id };
}
const writeHeader = (clubId: string, values: object, expected: object) =>
  app.inject({ method: 'POST', url: `${base}/clubs/${clubId}/club-form-header`, payload: { values, expected } });
const directoryEntry = async (id: string) => (await get<{ id: string }[]>('/api/club-directory')).find((e) => e.id === id) as Record<string, unknown>;

test('lecture : en-tête et combattants, rien n’est écrit', async () => {
  const filled = fillClubForm(await template(), ['Tani Dojo', 'Jean', '0600000000', 'jean@tani.example', 'Oui'], [
    ['MARTIN', 'Léa', 'Féminin', 'Seniors', '53,5', 'Karaté', 'Oui', '1er kyu', 'Jiyu', null, null, null, null],
    ['DURAND', 'Hugo', 'Masculin', 'Seniors', '74', 'Karaté', 'Non', null, 'Shobu', null, null, null, null],
  ], 'new');
  const res = await upload(`${base}/club-forms/read`, filled);
  expect(res.statusCode, res.body).toBe(200);
  const read = res.json();
  expect(read.header).toEqual({ club: 'Tani Dojo', coachName: 'Jean', coachPhone: '0600000000', coachEmails: ['jean@tani.example'], preApproval: true });
  expect(read.items.map((i: { line: { lastName: string } }) => i.line.lastName)).toEqual(['MARTIN', 'DURAND']);
  expect(read.items[0].line).toMatchObject({ sex: 'F', ageBandCode: 'senior', weightClassId: 'senior:F:-55', kata: true, combats: ['karate'] });
  expect(read.merged).toEqual([]);
  expect(await get(`${base}/registrations`)).toEqual([]);
  expect(await get(`${base}/clubs`)).toEqual([]);
});

test('ancien modèle refusé', async () => {
  const filled = fillClubForm(await template(), ['Tani Dojo', 'Jean', null, null, 'Oui'], [
    ['MARTIN', 'Léa', 'Féminin', 'Cadets', '-54', 'Karaté', 'Jiyu', '32', null, null],
  ], 'legacy');
  const res = await upload(`${base}/club-forms/read`, filled);
  expect(res.statusCode).toBe(400);
  expect(res.json().error).toBe(LEGACY_FORM_REFUSED);
});

test('lecture : un fichier qui n’est pas une fiche club → 400', async () => {
  const res = await upload(`${base}/club-forms/read`, Buffer.from('Nom;Prenom\nX;Y\n'));
  expect(res.statusCode).toBe(400);
  expect(res.json().error).toBe("Ce fichier n'est pas une fiche club");
});

test('coordonnées : club et annuaire', async () => {
  const { entryId, clubId } = await directoryClub();
  // Un autre club de la même fiche (autre compétition), déjà aux nouvelles valeurs : son changement à examiner disparaît avec l'annuaire à jour.
  const other = await newCompetition('Open');
  const { id: otherClub } = (await app.inject({ method: 'POST', url: `${other}/clubs/from-directory`, payload: { directoryId: entryId } })).json() as { id: string };
  const { preApproval: _p, ...paulCoordinates } = PAUL;
  expect((await app.inject({ method: 'PATCH', url: `${other}/clubs/${otherClub}`, payload: paulCoordinates })).statusCode).toBe(200);
  expect((await get<{ clubId: string }[]>('/api/club-changes')).map((c) => c.clubId)).toEqual([otherClub]);

  const res = await writeHeader(clubId, PAUL, JEAN);
  expect(res.statusCode, res.body).toBe(200);
  expect(res.json()).toMatchObject({ id: clubId, ...PAUL });
  expect((await get<{ id: string }[]>(`${base}/clubs`)).find((c) => c.id === clubId)).toMatchObject(PAUL);
  expect(await directoryEntry(entryId)).toMatchObject(paulCoordinates);
  expect(await get('/api/club-changes')).toEqual([]);
});

test('coordonnées : l’annuaire ne reçoit que ce que l’étape change (une case vide n’efface rien, aucune adresse retirée)', async () => {
  const { entryId, clubId } = await directoryClub();
  await app.inject({ method: 'PATCH', url: `/api/club-directory/${entryId}`, payload: { coachEmails: ['jean@tani.example', 'club@tani.example'] } });
  // Le club n'a ni le téléphone ni la 2e adresse de la fiche d'annuaire.
  const club = { ...JEAN, coachPhone: null, coachEmails: ['jean@tani.example'] };
  expect((await app.inject({ method: 'PATCH', url: `${base}/clubs/${clubId}`, payload: { coachPhone: null } })).statusCode).toBe(200);

  // (a) seul le pré-accord change : le téléphone de l'annuaire reste.
  expect((await writeHeader(clubId, { ...club, preApproval: true }, club)).statusCode).toBe(200);
  expect(await directoryEntry(entryId)).toMatchObject({ coachName: 'Jean', coachPhone: '0600000000', coachEmails: ['jean@tani.example', 'club@tani.example'] });

  // (b) une adresse ajoutée : l'annuaire garde les siennes et la reçoit à la suite.
  const shown = { ...club, preApproval: true };
  const res = await writeHeader(clubId, { ...shown, coachEmails: ['jean@tani.example', 'paul@tani.example'] }, shown);
  expect(res.statusCode, res.body).toBe(200);
  expect(res.json()).toMatchObject({ coachPhone: null, coachEmails: ['jean@tani.example', 'paul@tani.example'], preApproval: true });
  expect((await directoryEntry(entryId)).coachEmails).toEqual(['jean@tani.example', 'club@tani.example', 'paul@tani.example']);

  // (c) le coach change : l'annuaire le reçoit, son téléphone reste.
  const now = { ...shown, coachEmails: ['jean@tani.example', 'paul@tani.example'] };
  expect((await writeHeader(clubId, { ...now, coachName: 'Paul' }, now)).statusCode).toBe(200);
  expect(await directoryEntry(entryId)).toMatchObject({ coachName: 'Paul', coachPhone: '0600000000' });
});

test('coordonnées : fiche d’annuaire archivée → le club seul', async () => {
  const { entryId, clubId } = await directoryClub();
  expect((await app.inject({ method: 'PATCH', url: `/api/club-directory/${entryId}`, payload: { archived: true } })).statusCode).toBe(200);
  const res = await writeHeader(clubId, PAUL, JEAN);
  expect(res.statusCode, res.body).toBe(200);
  expect(res.json()).toMatchObject(PAUL);
  expect(await directoryEntry(entryId)).toMatchObject({ coachName: 'Jean', coachPhone: '0600000000', coachEmails: ['jean@tani.example'] });
});

test('coordonnées : club sans fiche d’annuaire, valeurs nettoyées', async () => {
  const { id: clubId } = (await app.inject({ method: 'POST', url: `${base}/clubs`, payload: { name: 'Tani Dojo', coachName: 'Jean', coachEmails: ['jean@tani.example'] } })).json() as { id: string };
  // Le club n'a pas de téléphone : `expected` le donne vide ; les adresses comparées sans casse ni ordre.
  const res = await writeHeader(clubId, { ...PAUL, coachName: '  Paul ', coachPhone: '' }, { ...JEAN, coachName: ' Jean', coachPhone: '', coachEmails: ['JEAN@tani.example'] });
  expect(res.statusCode, res.body).toBe(200);
  expect(res.json()).toMatchObject({ coachName: 'Paul', coachPhone: null, coachEmails: PAUL.coachEmails, preApproval: true });
});

test('coordonnées périmées : 409, club et annuaire inchangés', async () => {
  const { entryId, clubId } = await directoryClub();
  const res = await writeHeader(clubId, PAUL, { ...JEAN, coachPhone: '0699999999' });
  expect(res.statusCode).toBe(409);
  expect(res.json().error).toBe('Ce club vient de changer : rouvrez l’étape.');
  expect(res.json().code).toBe('STALE_CLUB_HEADER');
  expect((await get<{ id: string }[]>(`${base}/clubs`)).find((c) => c.id === clubId)).toMatchObject(JEAN);
  expect(await directoryEntry(entryId)).toMatchObject({ coachName: 'Jean', coachPhone: '0600000000', coachEmails: ['jean@tani.example'] });
  expect((await writeHeader(clubId, PAUL, { ...JEAN, preApproval: true })).statusCode).toBe(409);
  expect((await writeHeader(clubId, PAUL, { ...JEAN, coachEmails: [] })).statusCode).toBe(409);
});

test('coordonnées : club d’une autre compétition → 404', async () => {
  const other = await newCompetition('Open');
  const { id: clubId } = (await app.inject({ method: 'POST', url: `${other}/clubs`, payload: { name: 'Tani Dojo' } })).json() as { id: string };
  const empty = { coachName: null, coachPhone: null, coachEmails: [], preApproval: false };
  expect((await writeHeader(clubId, PAUL, empty)).statusCode).toBe(404);
});

test('coordonnées : compétition passée → refusé, rien n’est écrit', async () => {
  const past = `/api/competitions/${(await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Ancienne', date: inDays(-10) } })).json().id}`;
  const { id: clubId } = (await app.inject({ method: 'POST', url: `${past}/clubs`, payload: { name: 'Tani Dojo', ...JEAN } })).json() as { id: string };
  const res = await app.inject({ method: 'POST', url: `${past}/clubs/${clubId}/club-form-header`, payload: { values: PAUL, expected: JEAN } });
  expect(res.statusCode).toBe(409);
  expect(res.json().code).toBeUndefined();
  expect((await get<{ id: string }[]>(`${past}/clubs`)).find((c) => c.id === clubId)).toMatchObject(JEAN);
});
