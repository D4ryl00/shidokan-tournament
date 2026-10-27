import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import Database from 'better-sqlite3';
import { tmpDbPath } from '../helpers/tmp-db.js';

let app: FastifyInstance;
let dbPath: string;
beforeEach(async () => {
  dbPath = tmpDbPath();
  app = await buildApp({ dbPath });
});
afterEach(async () => app.close());

const EMPTY = { affiliationNumber: null, coachName: null, coachPhone: null, coachEmails: [], notes: null };
const create = (payload: object) => app.inject({ method: 'POST', url: '/api/club-directory', payload: { ...EMPTY, ...payload } });
const list = async () => (await app.inject({ method: 'GET', url: '/api/club-directory' })).json() as { id: string; name: string; archived: boolean; competitions: number; coachPhone: string | null; affiliationNumber: string | null; googleContactId: string | null }[];

test('création, liste triée, modification, archivage', async () => {
  expect((await create({ name: 'Tani Dojo', affiliationNumber: '0060893' })).statusCode).toBe(201);
  const budo = (await create({ name: 'Budo Collines' })).json();
  expect((await list()).map((e) => e.name)).toEqual(['Budo Collines', 'Tani Dojo']);
  const renamed = await app.inject({ method: 'PATCH', url: `/api/club-directory/${budo.id}`, payload: { name: 'Zen Budo', coachPhone: '0600000000' } });
  expect(renamed.statusCode).toBe(200);
  expect(renamed.json()).toMatchObject({ name: 'Zen Budo', coachPhone: '0600000000', archived: false, competitions: 0 });
  expect((await list()).map((e) => e.name)).toEqual(['Tani Dojo', 'Zen Budo']);
  await app.inject({ method: 'PATCH', url: `/api/club-directory/${budo.id}`, payload: { archived: true } });
  expect((await list()).find((e) => e.id === budo.id)!.archived).toBe(true);
});

test('numéro d’affiliation en double → 409 ; non numérique → 400', async () => {
  await create({ name: 'Tani Dojo', affiliationNumber: '0060893' });
  const dup = await create({ name: 'Autre', affiliationNumber: '0060893' });
  expect(dup.statusCode).toBe(409);
  expect(dup.json().error).toBe('Ce numéro d’affiliation est déjà celui de « Tani Dojo ».');
  expect((await create({ name: 'Autre', affiliationNumber: '00A' })).statusCode).toBe(400);
});

test('fusion : clubs reliés à l’entrée gardée, champs vides complétés, entrée fusionnée supprimée', async () => {
  const c1 = (await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Coupe 2025', date: '2025-11-22' } })).json().id;
  const c2 = (await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Coupe 2026', date: '2026-11-22' } })).json().id;
  await app.inject({ method: 'POST', url: `/api/competitions/${c1}/clubs`, payload: { name: 'Tani Dojo', ffkEntity: '0060893 TANI DOJO' } });
  await app.inject({ method: 'POST', url: `/api/competitions/${c2}/clubs`, payload: { name: 'Dojo Tani', coachPhone: '0611111111' } });
  const entries = await list();
  expect(entries).toHaveLength(2);
  const keep = entries.find((e) => e.name === 'Tani Dojo')!;
  const merge = entries.find((e) => e.name === 'Dojo Tani')!;
  const res = await app.inject({ method: 'POST', url: '/api/club-directory/merge', payload: { keepId: keep.id, mergeId: merge.id } });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toMatchObject({ id: keep.id, affiliationNumber: '0060893', coachPhone: '0611111111', competitions: 2 });
  expect((await list()).map((e) => e.id)).toEqual([keep.id]);
});

test('entrée inconnue → 404', async () => {
  expect((await app.inject({ method: 'PATCH', url: '/api/club-directory/inconnue', payload: { name: 'X' } })).statusCode).toBe(404);
  expect((await app.inject({ method: 'POST', url: '/api/club-directory/merge', payload: { keepId: 'a', mergeId: 'b' } })).statusCode).toBe(404);
});

test('plusieurs e-mails par fiche : gardés dans l’ordre, doublons retirés ; à la fusion, les adresses manquantes s’ajoutent', async () => {
  const keep = (await create({ name: 'Tani Dojo', coachEmails: ['coach@tani.fr', 'Coach@Tani.fr', 'pres@tani.fr'] })).json();
  expect(keep.coachEmails).toEqual(['coach@tani.fr', 'pres@tani.fr']);
  const other = (await create({ name: 'Tani Dojo bis', coachEmails: ['PRES@tani.fr', 'secretaire@tani.fr'] })).json();
  const merged = (await app.inject({ method: 'POST', url: '/api/club-directory/merge', payload: { keepId: keep.id, mergeId: other.id } })).json();
  expect(merged.coachEmails).toEqual(['coach@tani.fr', 'pres@tani.fr', 'secretaire@tani.fr']);
  expect((await app.inject({ method: 'PATCH', url: `/api/club-directory/${keep.id}`, payload: { coachEmails: [] } })).json().coachEmails).toEqual([]);
});

test('e-mail invalide (deux adresses dans une case) refusé dans l’annuaire et dans les clubs d’une compétition', async () => {
  expect((await create({ name: 'Liste', coachEmails: ['a@x.fr, b@y.fr'] })).statusCode).toBe(400);
  const c = (await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Coupe', date: '2026-11-22' } })).json().id;
  expect((await app.inject({ method: 'POST', url: `/api/competitions/${c}/clubs`, payload: { name: 'Club', coachEmails: ['a@x.fr, b@y.fr'] } })).statusCode).toBe(400);
  expect((await app.inject({ method: 'POST', url: `/api/competitions/${c}/clubs`, payload: { name: 'Club', coachEmails: ['a@x.fr'] } })).statusCode).toBe(201);
});

test('lien Google : retiré à la main, effacé à l’archivage, gardé à la fusion', async () => {
  const link = (id: string, contact: string | null) => {
    const sqlite = new Database(dbPath);
    sqlite.prepare('update club_directory set google_contact_id = ? where id = ?').run(contact, id);
    sqlite.close();
  };
  const patch = (id: string, payload: object) => app.inject({ method: 'PATCH', url: `/api/club-directory/${id}`, payload });
  const a = (await create({ name: 'Tani Dojo' })).json();
  const b = (await create({ name: 'Dojo Tani' })).json();
  expect(a.googleContactId).toBeNull();
  link(a.id, 'people/c1');
  expect((await list()).find((e) => e.id === a.id)!.googleContactId).toBe('people/c1');
  expect((await patch(a.id, { googleContactId: null })).json().googleContactId).toBeNull();
  link(a.id, 'people/c1');
  expect((await patch(a.id, { archived: true })).json()).toMatchObject({ archived: true, googleContactId: null });
  expect((await patch(a.id, { googleContactId: 'people/x' })).statusCode).toBe(400);
  link(b.id, 'people/c2');
  const merged = await app.inject({ method: 'POST', url: '/api/club-directory/merge', payload: { keepId: a.id, mergeId: b.id } });
  expect(merged.json().googleContactId).toBe('people/c2');
});
