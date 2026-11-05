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
  app = await buildApp({ clubServices: true, dbPath });
  base = `/api/competitions/${(await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Coupe', date: '2026-11-22' } })).json().id}`;
});
afterEach(async () => app.close());

const EMPTY = { affiliationNumber: null, coachName: null, coachPhone: null, coachEmails: [], notes: null };
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
const rowsNow = async () => (await app.inject({ method: 'GET', url: `${base}/invitations` })).json() as { clubId: string; clubName: string; invited: boolean; links: number; directoryClubId: string; invitedAt: string | null }[];
/** Invite des clubs, puis crée un lien pour chacun (comme « Créer un lien » dans la fenêtre Accès). */
const inviteWithLinks = async (directoryIds: string[]) => {
  expect((await invite(directoryIds)).statusCode).toBe(204);
  const rows = await rowsNow();
  return Promise.all(rows.map(async (r) => (await app.inject({ method: 'POST', url: `${base}/invitations/${r.clubId}/links` })).json() as Link));
};

test('inviter deux entrées : clubs créés, reliés, coordonnées copiées ; invités sans aucun lien ; réinviter ne change rien', async () => {
  const tani = await entry('Tani Dojo', { coachEmails: ['coach@tani.example'], coachPhone: '0600000000' });
  const budo = await entry('Budo Collines');
  const res = await invite([tani, budo]);
  expect(res.statusCode).toBe(204);
  const clubs = (await app.inject({ method: 'GET', url: `${base}/clubs` })).json() as { name: string; coachEmails: string[]; coachPhone: string | null }[];
  expect(clubs.find((c) => c.name === 'Tani Dojo')).toMatchObject({ coachEmails: ['coach@tani.example'], coachPhone: '0600000000' });
  const rows = await rowsNow();
  expect(rows.map((r) => [r.clubName, r.invited, r.links, r.directoryClubId])).toEqual([['Budo Collines', true, 0, budo], ['Tani Dojo', true, 0, tani]]);
  expect(rows.every((r) => typeof r.invitedAt === 'string')).toBe(true);
  const raw = new Database(dbPath, { readonly: true });
  expect((raw.prepare('select count(*) as n from club_invitations').get() as { n: number }).n).toBe(0);
  raw.close();
  expect((await invite([tani])).statusCode).toBe(204);
  expect((await rowsNow()).map((r) => r.links)).toEqual([0, 0]);
});

test('réinviter un club qui a déjà un lien : son lien reste le seul', async () => {
  const tani = await entry('Tani Dojo');
  const [link] = await inviteWithLinks([tani]);
  expect((await invite([tani])).statusCode).toBe(204);
  expect((await rowsNow())[0]).toMatchObject({ invited: true, links: 1 });
  expect(await resolves(link!.token)).toBe(true);
});

test('un club repris dans la saisie, sans invitation, reste « à inviter »', async () => {
  await app.inject({ method: 'POST', url: `${base}/clubs`, payload: { name: 'Budo' } });
  expect((await rowsNow())[0]).toMatchObject({ invited: false, links: 0, invitedAt: null });
});

test('inviter une entrée dont le club existe déjà dans la compétition (même nom) → ce club est réutilisé et relié', async () => {
  const club = (await app.inject({ method: 'POST', url: `${base}/clubs`, payload: { name: 'TANI DOJO' } })).json();
  const tani = await entry('Tani Dojo', { affiliationNumber: '0060893' });
  expect((await invite([tani])).statusCode).toBe(204);
  expect(await rowsNow()).toEqual([expect.objectContaining({ clubId: club.id, directoryClubId: tani, invited: true })]);
});

test('le jeton n’est pas stocké en clair', async () => {
  const [link] = await inviteWithLinks([await entry('Tani Dojo')]);
  const raw = new Database(dbPath, { readonly: true });
  const rows = raw.prepare('select * from club_invitations').all() as Record<string, unknown>[];
  raw.close();
  expect(rows).toHaveLength(1);
  expect(rows[0]!.token_hash).toBe(createHash('sha256').update(link!.token).digest('hex'));
  expect(JSON.stringify(rows)).not.toContain(link!.token);
});

type Access = { id: string; createdAt: string; sentAt: string | null; sentVia: 'mail' | 'messagerie' | null; lastUsedAt: string | null };
const accesses = async (clubId: string) => (await app.inject({ method: 'GET', url: `${base}/invitations/${clubId}/links` })).json() as Access[];
const rowsOf = async () => (await app.inject({ method: 'GET', url: `${base}/invitations` })).json() as { clubName: string; invited: boolean; links: number; lastUsedAt: string | null }[];

test('accès d’un club : créer un lien l’ajoute (l’ancien marche toujours), liste du plus récent au plus ancien', async () => {
  const [link] = await inviteWithLinks([await entry('Tani Dojo')]);
  const created = await app.inject({ method: 'POST', url: `${base}/invitations/${link!.clubId}/links` });
  expect(created.statusCode).toBe(200);
  const added = created.json() as Link & { id: string };
  expect(added).toMatchObject({ clubId: link!.clubId, clubName: 'Tani Dojo' });
  expect(await resolves(link!.token)).toBe(true);
  expect(await resolves(added.token)).toBe(true);
  const list = await accesses(link!.clubId);
  expect(list).toHaveLength(2);
  expect(list[0]).toEqual({ id: added.id, createdAt: expect.any(String), sentAt: null, sentVia: null, lastUsedAt: expect.any(String) });
  expect(list[0]!.createdAt >= list[1]!.createdAt).toBe(true);
  expect(JSON.stringify(list)).not.toContain(added.token);
  expect((await rowsOf())[0]).toMatchObject({ invited: true, links: 2 });
});

test('dernière visite du club : la plus récente, tous liens confondus', async () => {
  const [link] = await inviteWithLinks([await entry('Tani Dojo')]);
  const added = (await app.inject({ method: 'POST', url: `${base}/invitations/${link!.clubId}/links` })).json() as Link;
  await resolves(link!.token);
  await new Promise((r) => setTimeout(r, 5));
  await resolves(added.token);
  const last = (await accesses(link!.clubId)).map((a) => a.lastUsedAt!).sort().at(-1);
  expect((await rowsOf())[0]!.lastUsedAt).toBe(last);
});

test('supprimer un lien : lui seul ne marche plus ; supprimer le dernier → le club reste invité, sans lien', async () => {
  const [link] = await inviteWithLinks([await entry('Tani Dojo')]);
  const added = (await app.inject({ method: 'POST', url: `${base}/invitations/${link!.clubId}/links` })).json() as Link & { id: string };
  const first = (await accesses(link!.clubId)).find((a) => a.id !== added.id)!;
  expect((await app.inject({ method: 'DELETE', url: `${base}/invitations/${link!.clubId}/links/${first.id}` })).statusCode).toBe(204);
  expect(await resolves(link!.token)).toBe(false);
  expect(await resolves(added.token)).toBe(true);
  expect((await accesses(link!.clubId)).map((a) => a.id)).toEqual([added.id]);
  expect((await app.inject({ method: 'DELETE', url: `${base}/invitations/${link!.clubId}/links/${added.id}` })).statusCode).toBe(204);
  expect(await resolves(added.token)).toBe(false);
  expect((await rowsOf())[0]).toMatchObject({ invited: true, links: 0 });
});

test('supprimer un lien d’un autre club, ou inconnu → 404, rien ne change', async () => {
  const links = await inviteWithLinks([await entry('Tani Dojo'), await entry('Budo')]);
  const [tani, budo] = [links.find((l) => l.clubName === 'Tani Dojo')!, links.find((l) => l.clubName === 'Budo')!];
  const taniLink = (await accesses(tani.clubId))[0]!;
  expect((await app.inject({ method: 'DELETE', url: `${base}/invitations/${budo.clubId}/links/${taniLink.id}` })).statusCode).toBe(404);
  expect((await app.inject({ method: 'DELETE', url: `${base}/invitations/${tani.clubId}/links/inconnu` })).statusCode).toBe(404);
  expect(await resolves(tani.token)).toBe(true);
});

test('supprimer tous les accès : plus aucun lien ne marche, le club n’est plus invité', async () => {
  const [link] = await inviteWithLinks([await entry('Tani Dojo')]);
  const added = (await app.inject({ method: 'POST', url: `${base}/invitations/${link!.clubId}/links` })).json() as Link;
  expect((await app.inject({ method: 'DELETE', url: `${base}/invitations/${link!.clubId}` })).statusCode).toBe(204);
  expect(await resolves(link!.token)).toBe(false);
  expect(await resolves(added.token)).toBe(false);
  expect(await accesses(link!.clubId)).toEqual([]);
  expect((await rowsOf())[0]!.invited).toBe(false);
});

test('retirer l’invitation d’un club sans lien : il redevient « à inviter »', async () => {
  await invite([await entry('Tani Dojo')]);
  const [row] = await rowsNow();
  expect((await app.inject({ method: 'DELETE', url: `${base}/invitations/${row!.clubId}` })).statusCode).toBe(204);
  expect((await rowsNow())[0]).toMatchObject({ invited: false, links: 0, invitedAt: null });
});

test('l’ancienne route « régénérer » n’existe plus', async () => {
  const [link] = await inviteWithLinks([await entry('Tani Dojo')]);
  expect((await app.inject({ method: 'POST', url: `${base}/invitations/${link!.clubId}/regenerate` })).statusCode).toBe(404);
  expect(await resolves(link!.token)).toBe(true);
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

test('saisie d’une inscription : fiches de l’annuaire proposées, club créé depuis une fiche sans lien d’inscription, puis plus proposée', async () => {
  const tani = await entry('Tani Dojo', { coachEmails: ['coach@tani.example'] });
  const budo = await entry('Budo Collines');
  const old = await entry('Ancien club');
  await app.inject({ method: 'PATCH', url: `/api/club-directory/${old}`, payload: { archived: true } });
  const choices = async () => (await app.inject({ method: 'GET', url: `${base}/directory-clubs` })).json() as { id: string; name: string }[];
  expect(await choices()).toEqual([{ id: budo, name: 'Budo Collines' }, { id: tani, name: 'Tani Dojo' }]);

  const res = await app.inject({ method: 'POST', url: `${base}/clubs/from-directory`, payload: { directoryId: tani } });
  expect(res.statusCode).toBe(201);
  expect(res.json()).toMatchObject({ name: 'Tani Dojo', coachEmails: ['coach@tani.example'] });
  // Même fiche une seconde fois : le même club.
  expect((await app.inject({ method: 'POST', url: `${base}/clubs/from-directory`, payload: { directoryId: tani } })).json().id).toBe(res.json().id);
  expect(await choices()).toEqual([{ id: budo, name: 'Budo Collines' }]);
  const rows = (await app.inject({ method: 'GET', url: `${base}/invitations` })).json() as { clubName: string; invited: boolean }[];
  expect(rows.find((r) => r.clubName === 'Tani Dojo')).toMatchObject({ invited: false });
  expect((await app.inject({ method: 'POST', url: `${base}/clubs/from-directory`, payload: { directoryId: 'inconnu' } })).statusCode).toBe(404);
});
