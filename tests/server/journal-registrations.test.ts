import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterEach, expect, test } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { closeDb, openDb, type AppDb } from '../../src/server/db/client.js';
import { fighterSnapshot } from '../../src/server/journal/fighters.js';
import { createCompetition } from '../../src/server/repositories/competitions.js';
import { createRegistration, upsertClub } from '../../src/server/repositories/registrations.js';
import type { JournalEntryView } from '../../src/domain/journal/types.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

let app: FastifyInstance | null = null;
let db: AppDb | null = null;
let dbPath: string;
afterEach(async () => {
  if (app) await app.close();
  if (db) closeDb(db);
  app = null;
  db = null;
});

type Entry = { seq: number; type: string; action: string; via: string; actor: Record<string, unknown>; data: Record<string, any> };
const entries = (competitionId: string): Entry[] => {
  const ro = new Database(dbPath, { readonly: true });
  const rows = ro.prepare('select * from journal_entries where competition_id = ? order by seq').all(competitionId) as { seq: number; type: string; action: string; via: string; actor_json: string; data_json: string }[];
  ro.close();
  return rows.map((r) => ({ seq: r.seq, type: r.type, action: r.action, via: r.via, actor: JSON.parse(r.actor_json), data: JSON.parse(r.data_json) }));
};

const LINE = {
  lastName: 'MARTIN', firstName: 'Léa', sex: 'F', ageBandCode: 'senior', weightClassId: 'senior:F:-55', weightKg: 53.5, combats: ['karate'], kata: true, grade: '1er kyu',
  ruleset: 'jiyu', prefs: {}, shobuKeep: null, licence: null,
};

async function setup(opts: { clubServices?: boolean } = {}) {
  dbPath = tmpDbPath();
  app = await buildApp({ dbPath, ...opts });
  const a = app;
  const id = (await a.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Coupe', date: '2026-11-22' } })).json().id as string;
  const base = `/api/competitions/${id}`;
  const club = (await a.inject({ method: 'POST', url: `${base}/clubs`, payload: { name: 'Shidokan Lyon' } })).json() as { id: string };
  const input = {
    clubId: club.id, lastName: 'DUPONT', firstName: 'Léa', sex: 'F', ageBandCode: 'senior', grade: '2e kyu',
    discipline: 'karate', ruleset: 'jiyu', weightClassId: 'senior:F:-55', approxWeightKg: 53.5, source: 'manual',
  };
  const post = (url: string, payload: unknown, headers: Record<string, string> = {}) => a.inject({ method: 'POST', url, payload: payload as object, headers });
  const put = (rid: string, payload: unknown) => a.inject({ method: 'PUT', url: `${base}/registrations/${rid}`, payload: payload as object });
  const del = (rid: string) => a.inject({ method: 'DELETE', url: `${base}/registrations/${rid}` });
  const journal = async () => (await a.inject({ method: 'GET', url: `${base}/journal` })).json().entries as JournalEntryView[];
  return { a, id, base, club, input, post, put, del, journal, last: () => entries(id).at(-1)!, count: () => entries(id).length };
}

test('ajout sur place → « ajouté », poste et manière', async () => {
  const { base, input, post, last } = await setup();
  const res = await post(`${base}/registrations`, { ...input, source: 'onsite' }, { 'x-poste': 'table' });
  expect(res.statusCode).toBe(201);
  expect(last()).toMatchObject({
    type: 'inscription', action: 'fighter-added', via: 'sur-place', actor: { kind: 'poste', poste: 'table' },
    data: { subject: 'DUPONT Léa (Shidokan Lyon)', detail: 'Karaté Jiyu' },
  });
});

test('manière d’après l’origine de l’ajout ; une deuxième inscription du même combattant le modifie', async () => {
  const { base, input, post, last } = await setup();
  await post(`${base}/registrations`, { ...input, source: 'ffk' });
  expect(last()).toMatchObject({ action: 'fighter-added', via: 'import-ffk' });
  await post(`${base}/registrations`, { ...input, discipline: 'kata', ruleset: null, weightClassId: null, approxWeightKg: null, source: 'club_form' });
  expect(last()).toMatchObject({ action: 'fighter-changed', via: 'fiche-club', data: { subject: 'DUPONT Léa (Shidokan Lyon)', changes: [{ label: 'Kata', before: null, after: 'inscrit' }] } });
});

test('modification : seulement ce qui a changé ; enregistrer sans rien changer → aucune entrée', async () => {
  const { base, input, post, put, last, count } = await setup();
  const rid = (await post(`${base}/registrations`, input)).json().row.id as string;
  expect(last()).toMatchObject({ action: 'fighter-added', via: 'saisie' });
  expect((await put(rid, { ...input, grade: '1er kyu' })).statusCode).toBe(200);
  expect(last()).toMatchObject({ action: 'fighter-changed', via: 'saisie', data: { subject: 'DUPONT Léa (Shidokan Lyon)' } });
  expect(last().data.changes).toEqual([{ label: 'Grade', before: '2e kyu', after: '1er kyu' }]);
  const n = count();
  expect((await put(rid, { ...input, grade: '1er kyu' })).statusCode).toBe(200);
  expect(count()).toBe(n); // ni entrée détaillée, ni entrée brute
  expect((await put(rid, { ...input, grade: '1er kyu', approxWeightKg: 54.2, weightClassId: 'senior:F:-61' })).statusCode).toBe(200);
  expect(last().data.changes).toEqual([
    { label: 'Karaté Jiyu · Catégorie de poids', before: '-55 kg', after: '-61 kg' },
    { label: 'Karaté Jiyu · Poids annoncé', before: '53,5 kg', after: '54,2 kg' },
  ]);
});

test('suppression puis relecture : l’ajout d’avant reste lisible', async () => {
  const { base, input, post, del, journal, last } = await setup();
  const rid = (await post(`${base}/registrations`, input)).json().row.id as string;
  expect((await del(rid)).statusCode).toBe(204);
  expect(last()).toMatchObject({ action: 'fighter-removed', via: 'saisie' });
  const list = await journal();
  expect(list[0]).toMatchObject({ action: 'fighter-removed', data: { subject: 'DUPONT Léa (Shidokan Lyon)' } });
  expect(list.find((e) => e.action === 'fighter-added')!.data.subject).toBe('DUPONT Léa (Shidokan Lyon)');
});

test('ligne du club par son lien : club, en ligne, inscriptions ajoutées', async () => {
  const { a, base, last, count } = await setup({ clubServices: true });
  const EMPTY = { affiliationNumber: null, coachName: null, coachPhone: null, coachEmails: [], notes: null };
  const entryId = (await a.inject({ method: 'POST', url: '/api/club-directory', payload: { ...EMPTY, name: 'Tani Dojo' } })).json().id;
  await a.inject({ method: 'POST', url: `${base}/invitations`, payload: { directoryIds: [entryId] } });
  const rows = (await a.inject({ method: 'GET', url: `${base}/invitations` })).json() as { clubId: string; clubName: string }[];
  const row = rows.find((r) => r.clubName === 'Tani Dojo')!;
  const { token } = (await a.inject({ method: 'POST', url: `${base}/invitations/${row.clubId}/links` })).json();
  await a.inject({ method: 'PATCH', url: `${base}/club-entry`, payload: { status: 'open', deadline: '2026-11-15' } });

  const created = await a.inject({ method: 'POST', url: `/api/inscription/${token}/lines`, payload: { line: LINE } });
  expect(created.statusCode).toBe(201);
  expect(last()).toMatchObject({
    type: 'inscription', action: 'fighter-added', via: 'en-ligne', actor: { kind: 'club', clubName: 'Tani Dojo' },
    data: { subject: 'MARTIN Léa (Tani Dojo)', detail: 'Karaté Jiyu · Kata' },
  });
  const { fighterId, version } = created.json() as { fighterId: string; version: string };
  // Enregistrée telle quelle : rien.
  const n = count();
  const same = await a.inject({ method: 'PUT', url: `/api/inscription/${token}/lines/${fighterId}`, payload: { line: LINE, version } });
  expect(same.statusCode).toBe(200);
  expect(count()).toBe(n);
  const changed = await a.inject({ method: 'PUT', url: `/api/inscription/${token}/lines/${fighterId}`, payload: { line: { ...LINE, kata: false, grade: null }, version: same.json().version } });
  expect(changed.statusCode).toBe(200);
  expect(last()).toMatchObject({ action: 'fighter-changed', via: 'en-ligne', data: { changes: [{ label: 'Kata', before: 'inscrit', after: null }] } });
  const removed = await a.inject({ method: 'DELETE', url: `/api/inscription/${token}/lines/${fighterId}?version=${encodeURIComponent(changed.json().version)}` });
  expect(removed.statusCode).toBe(204);
  expect(last()).toMatchObject({ action: 'fighter-removed', via: 'en-ligne', actor: { kind: 'club', clubName: 'Tani Dojo' }, data: { subject: 'MARTIN Léa (Tani Dojo)' } });
});

test('ligne organisateur depuis une fiche renvoyée : « Fiche club importée »', async () => {
  const { a, base, club, last } = await setup();
  const url = `${base}/clubs/${club.id}/lines`;
  const created = await a.inject({ method: 'POST', url, headers: { 'x-poste': 'organisation' }, payload: { line: LINE, publicNameHidden: false, source: 'club_form' } });
  expect(created.statusCode).toBe(201);
  expect(last()).toMatchObject({ action: 'fighter-added', via: 'fiche-club', actor: { kind: 'poste', poste: 'organisation' }, data: { subject: 'MARTIN Léa (Shidokan Lyon)' } });
  const { fighterId, version } = created.json() as { fighterId: string; version: string };
  const edited = await a.inject({ method: 'PUT', url: `${url}/${fighterId}`, payload: { line: { ...LINE, weightKg: 54 }, version, publicNameHidden: true } });
  expect(edited.statusCode).toBe(200);
  expect(last()).toMatchObject({
    action: 'fighter-changed', via: 'saisie',
    data: { changes: [{ label: 'Nom public', before: 'affiché', after: 'masqué' }, { label: 'Karaté Jiyu · Poids annoncé', before: '53,5 kg', after: '54 kg' }] },
  });
  // Sans source, une ligne créée par l'organisateur est une inscription sur place.
  await a.inject({ method: 'POST', url, payload: { line: { ...LINE, lastName: 'BLANC' }, publicNameHidden: false } });
  expect(last()).toMatchObject({ action: 'fighter-added', via: 'sur-place', data: { subject: 'BLANC Léa (Shidokan Lyon)' } });
  const removed = await a.inject({ method: 'DELETE', url: `${url}/${fighterId}?version=${encodeURIComponent(edited.json().version)}` });
  expect(removed.statusCode).toBe(204);
  expect(last()).toMatchObject({ action: 'fighter-removed', via: 'saisie', data: { subject: 'MARTIN Léa (Shidokan Lyon)' } });
});

test('nom public masqué : « Nom public : affiché → masqué »', async () => {
  const { a, base, input, post, last, count } = await setup();
  const fighterId = (await post(`${base}/registrations`, input)).json().row.fighterId as string;
  const hide = () => a.inject({ method: 'PUT', url: `${base}/fighters/${fighterId}/public-name`, payload: { hidden: true } });
  expect((await hide()).statusCode).toBe(204);
  expect(last()).toMatchObject({ type: 'inscription', action: 'fighter-changed', via: 'saisie', data: { subject: 'DUPONT Léa (Shidokan Lyon)', changes: [{ label: 'Nom public', before: 'affiché', after: 'masqué' }] } });
  const n = count();
  expect((await hide()).statusCode).toBe(204);
  expect(count()).toBe(n);
  expect((await a.inject({ method: 'PUT', url: `${base}/fighters/inconnu/public-name`, payload: { hidden: true } })).statusCode).toBe(404);
  expect(count()).toBe(n);
});

test('validation refusée (400) : aucune entrée', async () => {
  const { a, base, club, input, post, put, count } = await setup();
  const rid = (await post(`${base}/registrations`, input)).json().row.id as string;
  const n = count();
  expect((await post(`${base}/registrations`, { ...input, ageBandCode: 'minime', ruleset: 'shobu', weightClassId: 'minime:F:-42' })).statusCode).toBe(400);
  expect((await put(rid, { ...input, ageBandCode: 'minime', ruleset: 'shobu', weightClassId: 'minime:F:-42' })).statusCode).toBe(400);
  expect((await a.inject({ method: 'POST', url: `${base}/clubs/${club.id}/lines`, payload: { line: { ...LINE, weightClassId: null, weightKg: null }, publicNameHidden: false } })).statusCode).toBe(400);
  expect(count()).toBe(n);
});

test('photo d’un combattant : libellés recopiés, dans l’ordre', async () => {
  dbPath = tmpDbPath();
  db = openDb(dbPath);
  const id = (await createCompetition(db, { name: 'Coupe', date: '2026-11-22' })).id;
  const club = await upsertClub(db, id, { name: 'Shidokan Lyon' });
  const base = { clubId: club.id, lastName: 'DUPONT', firstName: 'Léa', sex: 'F' as const, ageBandCode: 'senior', licence: 'AB123', grade: '2e kyu' };
  const { row } = await createRegistration(db, id, { ...base, discipline: 'karate', ruleset: 'shobu', weightClassId: 'senior:F:-55', approxWeightKg: 48, otherDisciplines: ['shido-mix'], acceptsJiyuFirst: true, source: 'onsite' });
  await createRegistration(db, id, { ...base, discipline: 'kata', ruleset: null, weightClassId: null, source: 'online' });
  const snap = fighterSnapshot(db, id, row.fighterId)!;
  expect(snap.name).toBe('DUPONT Léa');
  expect(snap.club).toBe('Shidokan Lyon');
  expect(Object.entries(snap.fields)).toEqual([['Sexe', 'F'], ['Catégorie d\'âge', 'Seniors'], ['Grade', '2e kyu'], ['Licence', 'AB123'], ['Nom public', 'affiché']]);
  expect(snap.registrations).toEqual({
    'Karaté Shobu': {
      'Catégorie de poids': '-55 kg', 'Poids annoncé': '48 kg', Origine: 'Inscription sur place',
      Reclassement: 'Shido-mix-martial', 'Proposer d’abord': 'passer en jiyu',
    },
    // Pas de poids pour le kata (le poids de la ligne y est recopié, sans intérêt ici).
    Kata: { Origine: 'Inscription en ligne', Reclassement: null, 'Proposer d’abord': null },
  });
  expect(fighterSnapshot(db, id, 'inconnu')).toBeNull();
});
