import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, test } from 'vitest';
import type { ClubFormLine } from '../../src/domain/club-form.js';
import { buildApp } from '../../src/server/app.js';
import { buildFfkPdf } from '../helpers/ffk-pdf.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

let app: FastifyInstance;
let dbPath: string;
let base: string;
let token: string;
let clubId: string;
beforeEach(async () => {
  dbPath = tmpDbPath();
  app = await buildApp({ clubServices: true, dbPath });
  base = `/api/competitions/${(await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Coupe', date: '2026-11-22', location: 'Nice' } })).json().id}`;
  const EMPTY = { affiliationNumber: null, coachName: null, coachPhone: null, coachEmails: [], notes: null };
  const entryId = (await app.inject({ method: 'POST', url: '/api/club-directory', payload: { ...EMPTY, name: 'Tani Dojo' } })).json().id;
  await app.inject({ method: 'POST', url: `${base}/invitations`, payload: { directoryIds: [entryId] } });
  const [row] = (await app.inject({ method: 'GET', url: `${base}/invitations` })).json();
  const link = (await app.inject({ method: 'POST', url: `${base}/invitations/${row.clubId}/links` })).json();
  token = link.token;
  clubId = link.clubId;
  await app.inject({ method: 'PATCH', url: `${base}/club-entry`, payload: { status: 'open', deadline: '2026-11-15' } });
});
afterEach(async () => app.close());

const LINE: ClubFormLine = {
  lastName: 'MARTIN', firstName: 'Léa', sex: 'F', ageBandCode: 'senior', weightClassId: 'senior:F:-55', weightKg: 53.5, combats: ['karate'], kata: false, grade: null,
  ruleset: 'jiyu', prefs: {}, shobuKeep: null,
};
const pdf = (names = ['DURAND LEO', 'PETIT NOE'], rowsPerPage?: number) =>
  buildFfkPdf({ competition: 'Coupe Test - Combats', entity: '0000001 DOJO TEST', rowsPerPage, categories: [{ title: 'Senior Masculin -75 KG', status: 'Inscrits', fighters: names }] });
const bytes = (b: Uint8Array) => Buffer.from(b);
const coach = (body: Buffer | string, query = '?discipline=karate') =>
  app.inject({ method: 'POST', url: `/api/inscription/${token}/ffk-pdf${query}`, headers: { 'content-type': 'application/octet-stream' }, payload: body });
const orga = (body: Buffer | string, query = '?discipline=karate') =>
  app.inject({ method: 'POST', url: `${base}/ffk-pdf${query}`, headers: { 'content-type': 'application/octet-stream' }, payload: body });

test('coach : PDF de 2 combattants lu et traduit dans la grille', async () => {
  const res = await coach(bytes(await pdf()));
  expect(res.statusCode, res.body).toBe(200);
  const { fighters, duplicates } = res.json();
  expect(duplicates).toEqual([]);
  expect(fighters).toHaveLength(2);
  expect(fighters[0]).toMatchObject({ fullName: expect.stringContaining('DURAND LEO'), sex: 'M', ageBandCode: 'senior', weightClassId: 'senior:M:-75' });
});

test('coach : discipline absente ou inconnue → 400', async () => {
  const body = bytes(await pdf());
  for (const q of ['', '?discipline=judo']) {
    const res = await coach(body, q);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Choisissez la discipline de ce PDF.');
  }
});

test('coach : fichier qui n’est pas un PDF → 400', async () => {
  const res = await coach('bonjour');
  expect(res.statusCode).toBe(400);
  expect(res.json().error).toBe('Ce fichier n’est pas un PDF lisible.');
});

test('coach : PDF sans combattant → 400', async () => {
  const empty = await buildFfkPdf({ competition: 'Coupe Test - Combats', entity: '0000001 DOJO TEST', categories: [{ title: 'Senior Masculin -75 KG', fighters: [] }] });
  const res = await coach(bytes(empty));
  expect(res.statusCode).toBe(400);
  expect(res.json().error).toBe('Aucun combattant trouvé dans ce PDF.');
});

test('coach : un PDF de 200 Ko passe (limite propre), un PUT de ligne de 100 Ko reste refusé (413)', async () => {
  const names = Array.from({ length: 3 }, (_, i) => `DUPONT PRENOM${String.fromCharCode(65 + i)}`);
  const big = Buffer.concat([bytes(await pdf(names)), Buffer.alloc(200 * 1024)]);
  expect(big.length).toBeGreaterThan(200 * 1024);
  const res = await coach(big);
  expect(res.statusCode, res.body).toBe(200);
  const created = (await app.inject({ method: 'POST', url: `/api/inscription/${token}/lines`, payload: { line: LINE } })).json();
  const put = await app.inject({ method: 'PUT', url: `/api/inscription/${token}/lines/${created.fighterId}`, payload: { line: { ...LINE, grade: 'x'.repeat(100 * 1024) }, version: created.version } });
  expect(put.statusCode).toBe(413);
});

test('coach : un PDF de plus de 5 Mo est refusé (413)', async () => {
  expect((await coach(Buffer.alloc(5 * 1024 * 1024 + 1))).statusCode).toBe(413);
});

test('coach : inscriptions closes → 403', async () => {
  await app.inject({ method: 'PATCH', url: `${base}/club-entry`, payload: { status: 'frozen' } });
  const res = await coach(bytes(await pdf()));
  expect(res.statusCode).toBe(403);
  expect(res.json().error).toBe('Les inscriptions sont closes : contactez l’organisateur.');
});

test('organisateur : kata → catégorie de poids nulle, même quand les inscriptions sont closes', async () => {
  await app.inject({ method: 'PATCH', url: `${base}/club-entry`, payload: { status: 'frozen' } });
  const res = await orga(bytes(await pdf()), '?discipline=kata');
  expect(res.statusCode, res.body).toBe(200);
  expect(res.json().fighters.map((f: { weightClassId: string | null }) => f.weightClassId)).toEqual([null, null]);
  expect((await orga(bytes(await pdf()), '')).statusCode).toBe(400);
});

test('organisateur : GET des lignes d’un club', async () => {
  const mk = (lastName: string) => app.inject({ method: 'POST', url: `${base}/clubs/${clubId}/lines`, payload: { line: { ...LINE, lastName }, publicNameHidden: false } });
  expect((await mk('ZIDANE')).statusCode).toBe(201);
  expect((await mk('ABADIE')).statusCode).toBe(201);
  const res = await app.inject({ method: 'GET', url: `${base}/clubs/${clubId}/lines` });
  expect(res.statusCode).toBe(200);
  expect(res.json().map((l: { line: ClubFormLine }) => l.line.lastName)).toEqual(['ABADIE', 'ZIDANE']);
  expect(res.json()[0]).toMatchObject({ clubId, partlyEditable: false, editable: true });
  expect((await app.inject({ method: 'GET', url: `${base}/clubs/inconnu/lines` })).statusCode).toBe(404);
});

test('organisateur : une ligne dont le combat a commencé est partlyEditable', async () => {
  await app.inject({ method: 'POST', url: `${base}/clubs/${clubId}/lines`, payload: { line: LINE, publicNameHidden: false } });
  const regs = (await app.inject({ method: 'GET', url: `${base}/registrations` })).json() as { categoryId: string | null }[];
  const db = new Database(dbPath);
  db.prepare("update categories set status = 'started' where id = ?").run(regs[0]!.categoryId);
  db.close();
  const [line] = (await app.inject({ method: 'GET', url: `${base}/clubs/${clubId}/lines` })).json();
  expect(line).toMatchObject({ editable: false, partlyEditable: true, startedDisciplines: ['karate'] });
});
