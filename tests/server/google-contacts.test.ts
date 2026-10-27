import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { DIRECTORY_CHANGED, type GoogleContact } from '../../src/domain/google-contacts.js';
import { GOOGLE_CONNECT_FIRST, GOOGLE_RECONNECT } from '../../src/domain/app-settings.js';
import { buildApp } from '../../src/server/app.js';
import { connectGoogle, fakeGoogle, type FakeGoogle } from '../helpers/fake-google.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

let app: FastifyInstance;
let fake: FakeGoogle;

beforeEach(async () => {
  fake = fakeGoogle();
  app = await buildApp({ dbPath: tmpDbPath(), publicUrl: 'https://competitions.example.org', google: { clientId: 'id', clientSecret: 's', fetch: fake.fetch } });
});
afterEach(async () => {
  await app.close();
});

const contact = (n: string, extra: Partial<GoogleContact> = {}): GoogleContact => ({ resourceName: `people/${n}`, name: null, email: null, phone: null, organization: null, groups: [], ...extra });
const preview = (payload: object = {}) => app.inject({ method: 'POST', url: '/api/club-directory/google/preview', payload });
const apply = (payload: object) => app.inject({ method: 'POST', url: '/api/club-directory/google/apply', payload });
const directory = async () => (await app.inject({ method: 'GET', url: '/api/club-directory' })).json() as any[];
const addClub = async (name: string, extra: object = {}) =>
  (await app.inject({ method: 'POST', url: '/api/club-directory', payload: { name, affiliationNumber: null, coachName: null, coachPhone: null, coachEmail: null, notes: null, ...extra } })).json();
const none = { updates: [], links: [], creates: [], later: [] };
const settingsPending = async () => {
  const p = (await preview()).json().preview;
  return p.pending.map((c: any) => c.contact.resourceName);
};

test('aperçu : libellé choisi retenu, libellé disparu → tous ; total', async () => {
  await connectGoogle(app);
  fake.labels = [{ resourceName: 'contactGroups/coachs', name: 'Coachs' }];
  fake.contacts = [contact('c1', { groups: ['contactGroups/coachs'] }), contact('c2', { groups: ['contactGroups/coachs'] }), contact('c3')];
  const first = (await preview({ label: 'contactGroups/coachs' })).json();
  expect(first).toMatchObject({ state: 'ok', account: 'orga@gmail.com', label: 'contactGroups/coachs', total: 2 });
  expect(first.labels).toEqual([{ resourceName: 'contactGroups/coachs', name: 'Coachs' }]);
  expect((await preview()).json()).toMatchObject({ label: 'contactGroups/coachs', total: 2 });
  fake.labels = [];
  expect((await preview()).json()).toMatchObject({ label: null, total: 3 });
});

test('aperçu : sans droit contacts → no-scope sans appel ; sans compte → 409 ; accès retiré → 409 et état « à reconnecter »', async () => {
  const none409 = await preview();
  expect(none409.statusCode).toBe(409);
  expect(none409.json().error).toBe(GOOGLE_CONNECT_FIRST);

  fake.grantedScopes = fake.grantedScopes.filter((s) => !s.includes('contacts'));
  await connectGoogle(app);
  const before = fake.refreshCount;
  expect((await preview()).json()).toEqual({ state: 'no-scope', account: 'orga@gmail.com' });
  expect(fake.refreshCount).toBe(before);

  await app.inject({ method: 'POST', url: '/api/app-settings/google/disconnect' });
  fake.grantedScopes.push('https://www.googleapis.com/auth/contacts.readonly');
  await connectGoogle(app);
  fake.revokeAfterSends = 0;
  const res = await preview();
  expect(res.statusCode).toBe(409);
  expect(res.json().error).toBe(GOOGLE_RECONNECT);
  expect((await app.inject({ method: 'GET', url: '/api/app-settings' })).json().google.status).toBe('reconnect');
});

test('aperçu : autre erreur Google (API People non activée, réseau) → message de Google à l’écran, pas « Erreur interne »', async () => {
  await connectGoogle(app);
  const disabled = 'People API has not been used in project 123 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/people.googleapis.com/overview?project=123 then retry.';
  fake.peopleError = { status: 403, message: disabled, reason: 'SERVICE_DISABLED' };
  const res = await preview();
  expect(res.statusCode).not.toBe(500);
  expect(res.statusCode).toBeGreaterThanOrEqual(400);
  expect(res.json().error).toMatch(/^Lecture des contacts Google impossible \(/);
  expect(res.json().error).toContain('People API has not been used');
  // Pas un retrait d'accès : le compte reste connecté.
  expect((await app.inject({ method: 'GET', url: '/api/app-settings' })).json().google.status).toBe('ok');

  fake.peopleError = { status: 500, message: 'x'.repeat(2000), reason: 'BACKEND_ERROR' };
  const long = (await preview()).json().error as string;
  expect(long.length).toBeLessThan(600);

  fake.peopleError = null;
  fake.networkDown = true;
  const down = await preview();
  expect(down.statusCode).not.toBe(500);
  expect(down.json().error).toMatch(/^Lecture des contacts Google impossible \(.+\)$/);
});

test('appliquer : différences, lien, création, plus tard', async () => {
  await connectGoogle(app);
  await addClub('Dojo des Lilas', { coachName: 'Paul Martin', coachPhone: '01 11 11 11 11' });
  await addClub('Shidokan Est');
  fake.contacts = [
    contact('c1', { name: 'Paul Martin', phone: '06 22 22 22 22' }),
    contact('c2', { name: 'Marc Est' }),
    contact('c3', { name: 'Sophie Leroy', email: 's@ex.fr' }),
    contact('c4', { name: 'Plus Tard' }),
  ];
  const [lilas] = (await directory()).filter((c) => c.name === 'Dojo des Lilas');
  // Lien Lilas ↔ c1 : par un premier envoi.
  let p = (await preview()).json().preview;
  const lilasV = p.clubs.find((c: any) => c.name === 'Dojo des Lilas').version;
  expect((await apply({ ...none, links: [{ clubId: lilas.id, version: lilasV, contact: 'people/c1', set: {} }] })).json()).toEqual({ updated: 0, linked: 1, created: 0 });
  p = (await preview()).json().preview;
  expect(p.diffs).toHaveLength(1);
  const est = p.clubs.find((c: any) => c.name === 'Shidokan Est');
  const lilasNow = p.clubs.find((c: any) => c.name === 'Dojo des Lilas');

  const res = await apply({
    updates: [{ clubId: lilas.id, version: lilasNow.version, set: { coachPhone: '06 22 22 22 22' } }],
    links: [{ clubId: est.id, version: est.version, contact: 'people/c2', set: {} }],
    creates: [{ contact: 'people/c3', name: 'Kyokushin Sud', coachName: 'Sophie Leroy', coachPhone: null, coachEmail: 's@ex.fr' }],
    later: ['people/c4'],
  });
  expect(res.json()).toEqual({ updated: 1, linked: 1, created: 1 });
  const dir = await directory();
  expect(dir.find((c) => c.name === 'Dojo des Lilas')).toMatchObject({ coachPhone: '06 22 22 22 22', googleContactId: 'people/c1' });
  expect(dir.find((c) => c.name === 'Shidokan Est')).toMatchObject({ googleContactId: 'people/c2' });
  expect(dir.find((c) => c.name === 'Kyokushin Sud')).toMatchObject({ googleContactId: 'people/c3', coachName: 'Sophie Leroy', coachPhone: null, coachEmail: 's@ex.fr' });
  const after = (await preview()).json().preview;
  expect(after.diffs.filter((d: any) => d.clubId === lilas.id)).toEqual([]);
  expect(after.pending.map((c: any) => c.contact.resourceName)).toEqual(['people/c4']);
});

test('appliquer : ligne décochée → valeur gardée, différence reproposée', async () => {
  await connectGoogle(app);
  const club = await addClub('Dojo des Lilas', { coachPhone: '0111111111' });
  fake.contacts = [contact('c1', { phone: '0622222222' })];
  const v = (await preview()).json().preview.clubs[0].version;
  await apply({ ...none, links: [{ clubId: club.id, version: v, contact: 'people/c1', set: {} }] });
  await apply(none);
  const p = (await preview()).json().preview;
  expect(p.diffs).toHaveLength(1);
  expect(p.diffs[0].fields).toEqual([{ field: 'coachPhone', directory: '0111111111', google: '0622222222' }]);
  expect((await directory())[0].coachPhone).toBe('0111111111');
});

test('appliquer : annuaire modifié entre-temps → 409, rien d’écrit', async () => {
  await connectGoogle(app);
  const club = await addClub('Dojo des Lilas');
  fake.contacts = [contact('c1', { name: 'Paul' })];
  const v = (await preview()).json().preview.clubs[0].version;
  await app.inject({ method: 'PATCH', url: `/api/club-directory/${club.id}`, payload: { notes: 'modifié' } });
  const res = await apply({
    updates: [{ clubId: club.id, version: v, set: { coachName: 'Paul' } }],
    links: [],
    creates: [{ contact: 'people/c1', name: 'Nouveau', coachName: null, coachPhone: null, coachEmail: null }],
    later: ['people/c9'],
  });
  expect(res.statusCode).toBe(409);
  expect(res.json().error).toBe(DIRECTORY_CHANGED);
  const dir = await directory();
  expect(dir.map((c) => c.name)).toEqual(['Dojo des Lilas']);
  expect(dir[0].coachName).toBeNull();
  expect(await settingsPending()).toEqual([]);
});

test('appliquer : fiche archivée ou absente → 409', async () => {
  await connectGoogle(app);
  const club = await addClub('Dojo des Lilas');
  const v = (await preview()).json().preview.clubs[0].version;
  await app.inject({ method: 'PATCH', url: `/api/club-directory/${club.id}`, payload: { archived: true } });
  expect((await apply({ ...none, updates: [{ clubId: club.id, version: v, set: {} }] })).statusCode).toBe(409);
  expect((await apply({ ...none, links: [{ clubId: 'absent', version: 1, contact: 'people/c1', set: {} }] })).statusCode).toBe(409);
});

test('appliquer : contact à la fois lié et plus tard → lié, pas en attente ; deux liens vers le même club → le dernier gagne', async () => {
  await connectGoogle(app);
  const club = await addClub('Dojo des Lilas');
  fake.contacts = [contact('c1', { name: 'A' }), contact('c2', { name: 'B' }), contact('c3', { name: 'C' })];
  const v = (await preview()).json().preview.clubs[0].version;
  const res = await apply({
    ...none,
    links: [
      { clubId: club.id, version: v, contact: 'people/c1', set: {} },
      { clubId: club.id, version: v, contact: 'people/c2', set: {} },
    ],
    later: ['people/c1', 'people/c3'],
  });
  expect(res.statusCode).toBe(200);
  expect((await directory())[0].googleContactId).toBe('people/c2');
  expect(await settingsPending()).toEqual(['people/c3']);
});

test('appliquer : valeurs trop longues ou mail invalide refusés', async () => {
  await connectGoogle(app);
  const club = await addClub('Dojo des Lilas');
  expect((await apply({ ...none, updates: [{ clubId: club.id, version: 1, set: { coachName: 'x'.repeat(121) } }] })).statusCode).toBe(400);
  expect((await apply({ ...none, updates: [{ clubId: club.id, version: 1, set: { coachEmail: 'pas un mail' } }] })).statusCode).toBe(400);
  expect((await apply({ ...none, extra: 1 })).statusCode).toBe(400);
});

test('un contact sans mail ni téléphone : le nouveau club ne reçoit que les champs remplis', async () => {
  await connectGoogle(app);
  const res = await apply({ ...none, creates: [{ contact: 'people/c1', name: 'Solo', coachName: 'Seul', coachPhone: null, coachEmail: null }] });
  expect(res.statusCode).toBe(200);
  expect((await directory())[0]).toMatchObject({ name: 'Solo', coachName: 'Seul', coachPhone: null, coachEmail: null, googleContactId: 'people/c1' });
});
