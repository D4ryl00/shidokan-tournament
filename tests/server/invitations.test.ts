import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { closeDb, openDb } from '../../src/server/db/client.js';
import { resolveInvitation } from '../../src/server/repositories/invitations.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

let app: FastifyInstance;
let dbPath: string;
let base: string;
beforeEach(async () => {
  dbPath = tmpDbPath();
  app = await buildApp({ dbPath });
  base = `/api/competitions/${(await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Coupe', date: '2026-11-22' } })).json().id}`;
});
afterEach(async () => app.close());

const EMPTY = { affiliationNumber: null, coachName: null, coachPhone: null, coachEmail: null, notes: null };
const entry = async (name: string, extra: object = {}) =>
  (await app.inject({ method: 'POST', url: '/api/club-directory', payload: { ...EMPTY, name, ...extra } })).json().id as string;
const invite = (directoryIds: string[]) => app.inject({ method: 'POST', url: `${base}/invitations`, payload: { directoryIds } });
const resolves = async (token: string) => {
  const db = openDb(dbPath);
  try {
    return resolveInvitation(db, token) !== null;
  } finally {
    closeDb(db);
  }
};
type Link = { clubId: string; clubName: string; token: string };

test('inviter deux entrées : clubs créés, reliés, coordonnées copiées ; deux liens ; réinviter → aucun nouveau lien', async () => {
  const tani = await entry('Tani Dojo', { coachEmail: 'coach@tani.example', coachPhone: '0600000000' });
  const budo = await entry('Budo Collines');
  const res = await invite([tani, budo]);
  expect(res.statusCode).toBe(200);
  const links = res.json() as Link[];
  expect(links.map((l) => l.clubName).sort()).toEqual(['Budo Collines', 'Tani Dojo']);
  expect(links.every((l) => /^[A-Za-z0-9_-]{32}$/.test(l.token))).toBe(true);
  const clubs = (await app.inject({ method: 'GET', url: `${base}/clubs` })).json() as { name: string; coachEmail: string | null; coachPhone: string | null }[];
  expect(clubs.find((c) => c.name === 'Tani Dojo')).toMatchObject({ coachEmail: 'coach@tani.example', coachPhone: '0600000000' });
  const rows = (await app.inject({ method: 'GET', url: `${base}/invitations` })).json() as { clubName: string; invited: boolean; directoryClubId: string }[];
  expect(rows.map((r) => [r.clubName, r.invited, r.directoryClubId])).toEqual([['Budo Collines', true, budo], ['Tani Dojo', true, tani]]);
  expect((await invite([tani])).json()).toEqual([]);
});

test('inviter une entrée dont le club existe déjà dans la compétition (même nom) → ce club est réutilisé et relié', async () => {
  const club = (await app.inject({ method: 'POST', url: `${base}/clubs`, payload: { name: 'TANI DOJO' } })).json();
  const tani = await entry('Tani Dojo', { affiliationNumber: '0060893' });
  const links = (await invite([tani])).json() as Link[];
  expect(links.map((l) => l.clubId)).toEqual([club.id]);
  const rows = (await app.inject({ method: 'GET', url: `${base}/invitations` })).json() as { clubId: string; directoryClubId: string }[];
  expect(rows).toEqual([expect.objectContaining({ clubId: club.id, directoryClubId: tani })]);
});

test('le jeton n’est pas stocké en clair', async () => {
  const [link] = (await invite([await entry('Tani Dojo')])).json() as Link[];
  const raw = new Database(dbPath, { readonly: true });
  const rows = raw.prepare('select * from club_invitations').all() as Record<string, unknown>[];
  raw.close();
  expect(rows).toHaveLength(1);
  expect(rows[0]!.token_hash).toBe(createHash('sha256').update(link!.token).digest('hex'));
  expect(JSON.stringify(rows)).not.toContain(link!.token);
});

test('régénérer : l’ancien jeton ne se résout plus, le nouveau oui ; révoquer : plus aucun', async () => {
  const [link] = (await invite([await entry('Tani Dojo')])).json() as Link[];
  expect(await resolves(link!.token)).toBe(true);
  const again = (await app.inject({ method: 'POST', url: `${base}/invitations/${link!.clubId}/regenerate` })).json() as Link;
  expect(await resolves(link!.token)).toBe(false);
  expect(await resolves(again.token)).toBe(true);
  expect((await app.inject({ method: 'DELETE', url: `${base}/invitations/${link!.clubId}` })).statusCode).toBe(204);
  expect(await resolves(again.token)).toBe(false);
  const rows = (await app.inject({ method: 'GET', url: `${base}/invitations` })).json() as { invited: boolean }[];
  expect(rows[0]!.invited).toBe(false);
});

test('ouverture et gel : closed → open (date limite) → frozen → open ; refusé si une autre installation a la main', async () => {
  const get = async () => (await app.inject({ method: 'GET', url: `${base}/club-entry` })).json();
  expect(await get()).toEqual({ status: 'closed', deadline: null, managedHere: true });
  const patch = (payload: object) => app.inject({ method: 'PATCH', url: `${base}/club-entry`, payload });
  expect((await patch({ status: 'open', deadline: '2026-11-15' })).json()).toEqual({ status: 'open', deadline: '2026-11-15', managedHere: true });
  expect((await patch({ status: 'frozen' })).json()).toMatchObject({ status: 'frozen', deadline: '2026-11-15' });
  expect((await patch({ status: 'open' })).json()).toMatchObject({ status: 'open' });
  const raw = new Database(dbPath);
  raw.prepare("update competitions set owner_instance_id = 'autre-pc'").run();
  raw.close();
  expect(await get()).toMatchObject({ managedHere: false });
  const refused = await patch({ status: 'frozen' });
  expect(refused.statusCode).toBe(409);
});

test('inviter une fiche de même nom qu’un club déjà relié à une autre fiche → 409, rien n’est déplacé', async () => {
  const a = await entry('Shidokan Nice', { affiliationNumber: '0060001' });
  const b = await entry('Shidokan Nice', { affiliationNumber: '0060002' });
  await invite([a]);
  const res = await invite([b]);
  expect(res.statusCode).toBe(409);
  expect(res.json().error).toBe('« Shidokan Nice » : un club du même nom, relié à une autre fiche de l’annuaire, est déjà dans cette compétition. Fusionnez les fiches ou renommez-en une.');
  const rows = (await app.inject({ method: 'GET', url: `${base}/invitations` })).json() as { directoryClubId: string; invited: boolean }[];
  expect(rows).toEqual([expect.objectContaining({ directoryClubId: a, invited: true })]);
});
