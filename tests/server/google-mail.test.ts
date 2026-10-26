import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { GOOGLE_NOT_CONFIGURED, GOOGLE_NOT_SENT, GOOGLE_RECONNECT } from '../../src/domain/app-settings.js';
import { buildApp } from '../../src/server/app.js';
import { tmpDbPath } from '../helpers/tmp-db.js';
import { connectGoogle, fakeGoogle, type FakeGoogle } from '../helpers/fake-google.js';

let app: FastifyInstance;
let fake: FakeGoogle;
let dbPath: string;
let base: string;
const PUBLIC_URL = 'https://competitions.example.org';
const EMPTY = { affiliationNumber: null, coachName: null, coachPhone: null, coachEmail: null, notes: null };
const build = (withGoogle = true) =>
  buildApp({ dbPath, publicUrl: PUBLIC_URL, mailPauseMs: 0, google: withGoogle ? { clientId: 'id', clientSecret: 's', fetch: fake.fetch } : undefined });

beforeEach(async () => {
  fake = fakeGoogle();
  dbPath = tmpDbPath();
  app = await build();
  base = `/api/competitions/${(await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Coupe 2026', date: '2026-11-22', location: 'Nice' } })).json().id}`;
  await app.inject({ method: 'PATCH', url: `${base}/club-entry`, payload: { status: 'open', deadline: '2026-11-15' } });
  await connectGoogle(app);
});
afterEach(async () => app.close());

async function invited(...emails: string[]) {
  const ids: string[] = [];
  for (const [i, coachEmail] of emails.entries()) ids.push((await app.inject({ method: 'POST', url: '/api/club-directory', payload: { ...EMPTY, name: `Club ${i + 1}`, coachEmail } })).json().id);
  return (await app.inject({ method: 'POST', url: `${base}/invitations`, payload: { directoryIds: ids } })).json() as { clubId: string; clubName: string; token: string }[];
}
const send = (clubIds: string[]) => app.inject({ method: 'POST', url: `${base}/invitations/send`, payload: { clubIds } });
const testMail = () => app.inject({ method: 'POST', url: '/api/app-settings/test-mail', payload: { to: 'moi@example.org' } });
const linkStatus = async (token: string) => (await app.inject({ method: 'GET', url: `/api/inscription/${token}` })).statusCode;
const settings = async () => (await app.inject({ method: 'GET', url: '/api/app-settings' })).json();

test('mail d’essai par Gmail : expéditeur = nom choisi + adresse du compte Google', async () => {
  expect((await testMail()).statusCode).toBe(204);
  expect(fake.sent).toHaveLength(1);
  const mime = fake.sent[0]!.toString();
  expect(mime).toMatch(/^From: "?Shidokan France"? <orga@gmail\.com>/m);
  expect(mime).toMatch(/^To: .*moi@example\.org/m);
  expect(mime).toContain('Subject: ');
});

test('envoi groupé par Gmail : deux mails avec les deux fiches jointes, nouveaux liens actifs', async () => {
  const links = await invited('a@example.org', 'b@example.org');
  const res = (await send(links.map((l) => l.clubId))).json() as { status: string }[];
  expect(res.map((r) => r.status)).toEqual(['sent', 'sent']);
  expect(fake.sent).toHaveLength(2);
  for (const m of fake.sent.map(String)) {
    expect(m).toContain('fiche-club-2026-11-22.pdf');
    expect(m).toContain('fiche-club-2026-11-22.ods');
    const token = m.match(/\/inscription\/([A-Za-z0-9_-]+)/)![1]!;
    expect(await linkStatus(token)).toBe(200);
  }
});

test('accès retiré avant l’envoi : 400, rien d’envoyé, anciens liens intacts, état « à reconnecter »', async () => {
  const links = await invited('a@example.org', 'b@example.org');
  fake.revokeAfterSends = 0;
  const res = await send(links.map((l) => l.clubId));
  expect(res.statusCode).toBe(400);
  expect(res.json().error).toBe(`Envoi impossible, aucun lien n’a changé : ${GOOGLE_RECONNECT}`);
  expect(fake.sent).toHaveLength(0);
  for (const l of links) expect(await linkStatus(l.token)).toBe(200);
  expect((await settings()).google.status).toBe('reconnect');
});

test('accès retiré en plein envoi : arrêt, le club en cours et les suivants notés « non envoyé », leurs anciens liens actifs', async () => {
  const links = await invited('a@example.org', 'b@example.org', 'c@example.org');
  fake.revokeAfterSends = 1;
  const res = (await send(links.map((l) => l.clubId))).json() as { clubName: string; status: string; error: string | null }[];
  expect(res.map((r) => [r.status, r.error])).toEqual([['sent', null], ['error', GOOGLE_NOT_SENT], ['error', GOOGLE_NOT_SENT]]);
  expect(fake.sent).toHaveLength(1);
  expect(await linkStatus(links[1]!.token)).toBe(200);
  expect(await linkStatus(links[2]!.token)).toBe(200);
  const rows = (await app.inject({ method: 'GET', url: `${base}/invitations` })).json() as { clubName: string; lastMail: { status: string; error: string | null } | null }[];
  expect(rows.map((r) => [r.clubName, r.lastMail?.status, r.lastMail?.error ?? null]).sort()).toEqual([
    ['Club 1', 'sent', null],
    ['Club 2', 'error', GOOGLE_NOT_SENT],
    ['Club 3', 'error', GOOGLE_NOT_SENT],
  ]);
  expect((await settings()).google.status).toBe('reconnect');
});

test('état « à reconnecter » : mail d’essai refusé sans appeler Google', async () => {
  fake.revokeAfterSends = 0;
  expect((await testMail()).statusCode).toBe(400);
  const calls = fake.refreshCount;
  const res = await testMail();
  expect(res.statusCode).toBe(400);
  expect(res.json().error).toBe(GOOGLE_RECONNECT);
  expect(fake.refreshCount).toBe(calls);
});

test('mode Google mais serveur sans configuration Google : refus clair', async () => {
  await app.close();
  app = await build(false);
  const res = await testMail();
  expect(res.statusCode).toBe(400);
  expect(res.json().error).toBe(GOOGLE_NOT_CONFIGURED);
});

test('retour au SMTP : le mode choisi sert pour les envois, le compte Google reste connecté', async () => {
  await app.inject({ method: 'PATCH', url: '/api/app-settings', payload: { mailMode: 'smtp', smtp: { host: '127.0.0.1', port: 1, security: 'none', user: '', password: null, fromName: 'X', fromEmail: 'x@example.org' } } });
  expect((await testMail()).statusCode).toBe(400); // serveur SMTP injoignable : preuve que Gmail n'a pas servi
  expect(fake.sent).toHaveLength(0);
  expect((await settings()).google.email).toBe('orga@gmail.com');
});

test('jeton d’accès expiré entre deux mails d’un envoi groupé : renouvelé, tous les mails partent, l’état reste « ok »', async () => {
  const links = await invited('a@example.org', 'b@example.org', 'c@example.org');
  fake.expireAccessAfterSends = 1;
  const res = (await send(links.map((l) => l.clubId))).json() as { status: string }[];
  expect(res.map((r) => r.status)).toEqual(['sent', 'sent', 'sent']);
  expect(fake.sent).toHaveLength(3);
  expect((await settings()).google.status).toBe('ok');
});
