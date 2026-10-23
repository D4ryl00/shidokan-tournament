import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import type { MailTransport } from '../../src/server/mail.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

type Sent = { from: string; to: string; subject: string; text: string };
let sent: Sent[];
let failFor: Set<string>;
const transport: MailTransport = () => ({
  sendMail: async (m: Sent) => {
    if (failFor.has(m.to)) throw new Error('550 Adresse refusée');
    sent.push(m);
    return {};
  },
});

let app: FastifyInstance;
let base: string;
const SMTP = { host: 'smtp.gmail.com', port: 465, security: 'tls', user: 'orga@gmail.com', password: 'secret', fromName: 'Shidokan France', fromEmail: 'orga@gmail.com' };
const EMPTY = { affiliationNumber: null, coachName: null, coachPhone: null, coachEmail: null, notes: null };

beforeEach(async () => {
  sent = [];
  failFor = new Set();
  app = await buildApp({ dbPath: tmpDbPath(), mailTransport: transport, publicUrl: 'https://competitions.example.org' });
  base = `/api/competitions/${(await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Coupe 2026', date: '2026-11-22', location: 'Nice' } })).json().id}`;
  await app.inject({ method: 'PATCH', url: `${base}/club-entry`, payload: { status: 'open', deadline: '2026-11-15' } });
});
afterEach(async () => app.close());

async function invited(...clubs: { name: string; coachEmail: string | null; coachName?: string }[]) {
  const ids: string[] = [];
  for (const c of clubs) ids.push((await app.inject({ method: 'POST', url: '/api/club-directory', payload: { ...EMPTY, coachName: c.coachName ?? null, ...c } })).json().id);
  return (await app.inject({ method: 'POST', url: `${base}/invitations`, payload: { directoryIds: ids } })).json() as { clubId: string; clubName: string; token: string }[];
}
const smtp = () => app.inject({ method: 'PATCH', url: '/api/app-settings', payload: { smtp: SMTP } });
const send = (clubIds: string[]) => app.inject({ method: 'POST', url: `${base}/invitations/send`, payload: { clubIds } });
const tokenOf = (text: string) => text.match(/\/inscription\/([A-Za-z0-9_-]+)/)![1]!;

test('envoi à deux clubs : mails rendus, liens neufs qui fonctionnent, journal ; ancien lien → 410', async () => {
  await smtp();
  const links = await invited({ name: 'Tani Dojo', coachEmail: 'tani@example.org', coachName: 'Jean' }, { name: 'Budo', coachEmail: 'budo@example.org' });
  const res = await send(links.map((l) => l.clubId));
  expect(res.statusCode).toBe(200);
  expect(res.json().map((r: { status: string }) => r.status)).toEqual(['sent', 'sent']);
  expect(sent).toHaveLength(2);
  const tani = sent.find((m) => m.to === 'tani@example.org')!;
  expect(tani.from).toBe('"Shidokan France" <orga@gmail.com>');
  expect(tani.subject).toBe('Inscriptions — Coupe 2026');
  expect(tani.text).toContain('Bonjour Jean,');
  expect(tani.text).toContain('« Coupe 2026 » (22/11/2026, Nice)');
  expect(tani.text).toContain("jusqu'au 15/11/2026");
  expect(tani.text).toContain('https://competitions.example.org/inscription/');
  expect((await app.inject({ method: 'GET', url: `/api/inscription/${tokenOf(tani.text)}` })).statusCode).toBe(200);
  const old = await app.inject({ method: 'GET', url: `/api/inscription/${links.find((l) => l.clubName === 'Tani Dojo')!.token}` });
  expect(old.statusCode).toBe(410);
  expect(old.json().error).toBe('Ce lien a été remplacé : utilisez celui du dernier mail reçu.');
  const rows = (await app.inject({ method: 'GET', url: `${base}/invitations` })).json() as { clubName: string; lastMail: { status: string } | null }[];
  expect(rows.map((r) => [r.clubName, r.lastMail?.status])).toEqual([['Budo', 'sent'], ['Tani Dojo', 'sent']]);
});

test('un club en erreur : les autres partent ; lastMail = error avec le message', async () => {
  await smtp();
  failFor.add('budo@example.org');
  const links = await invited({ name: 'Tani Dojo', coachEmail: 'tani@example.org' }, { name: 'Budo', coachEmail: 'budo@example.org' });
  const res = (await send(links.map((l) => l.clubId))).json() as { clubName: string; status: string; error: string | null }[];
  expect(res.find((r) => r.clubName === 'Budo')).toMatchObject({ status: 'error', error: '550 Adresse refusée' });
  expect(sent.map((m) => m.to)).toEqual(['tani@example.org']);
  const rows = (await app.inject({ method: 'GET', url: `${base}/invitations` })).json() as { clubName: string; lastMail: { status: string; error: string | null } | null }[];
  expect(rows.find((r) => r.clubName === 'Budo')!.lastMail).toMatchObject({ status: 'error', error: '550 Adresse refusée' });
});

test('club sans e-mail → error « Pas d’e-mail pour ce club. », son lien n’est pas changé', async () => {
  await smtp();
  const [link] = await invited({ name: 'Tani Dojo', coachEmail: null });
  const res = (await send([link!.clubId])).json();
  expect(res).toEqual([expect.objectContaining({ status: 'error', error: 'Pas d’e-mail pour ce club.' })]);
  expect((await app.inject({ method: 'GET', url: `/api/inscription/${link!.token}` })).statusCode).toBe(200);
});

test('sans réglage SMTP → 400', async () => {
  const [link] = await invited({ name: 'Tani Dojo', coachEmail: 'tani@example.org' });
  const res = await send([link!.clubId]);
  expect(res.statusCode).toBe(400);
  expect(res.json().error).toBe('Réglez l’envoi des mails dans les Réglages de l’application.');
});

test('mailto : destinataire, objet et corps avec un lien neuf', async () => {
  const [link] = await invited({ name: 'Tani Dojo', coachEmail: 'tani@example.org' });
  const res = (await app.inject({ method: 'POST', url: `${base}/invitations/${link!.clubId}/mailto` })).json();
  expect(res).toMatchObject({ to: 'tani@example.org', subject: 'Inscriptions — Coupe 2026' });
  expect(tokenOf(res.body)).not.toBe(link!.token);
  expect((await app.inject({ method: 'GET', url: `/api/inscription/${tokenOf(res.body)}` })).statusCode).toBe(200);
});

test('aperçu : rien n’est créé ; {lien} laissé visible', async () => {
  const [link] = await invited({ name: 'Tani Dojo', coachEmail: 'tani@example.org' });
  const res = (await app.inject({ method: 'GET', url: `${base}/invitations/preview?clubId=${link!.clubId}` })).json();
  expect(res.subject).toBe('Inscriptions — Coupe 2026');
  expect(res.body).toContain('{lien}');
  expect((await app.inject({ method: 'GET', url: `/api/inscription/${link!.token}` })).statusCode).toBe(200);
});

test('message propre à la compétition utilisé quand il existe', async () => {
  await smtp();
  await app.inject({ method: 'PATCH', url: base, payload: { settings: { invitationMail: { subject: 'Coupe {competition}', body: 'Club {club} : {lien}' } } } });
  const [link] = await invited({ name: 'Tani Dojo', coachEmail: 'tani@example.org' });
  await send([link!.clubId]);
  expect(sent[0]).toMatchObject({ subject: 'Coupe Coupe 2026' });
  expect(sent[0]!.text).toMatch(/^Club Tani Dojo : https:\/\/competitions\.example\.org\/inscription\//);
});

test('mail d’essai : envoyé ; erreur SMTP → 400 avec son message', async () => {
  await smtp();
  expect((await app.inject({ method: 'POST', url: '/api/app-settings/test-mail', payload: { to: 'moi@example.org' } })).statusCode).toBe(204);
  expect(sent.map((m) => m.to)).toEqual(['moi@example.org']);
  failFor.add('faux@example.org');
  const res = await app.inject({ method: 'POST', url: '/api/app-settings/test-mail', payload: { to: 'faux@example.org' } });
  expect(res.statusCode).toBe(400);
  expect(res.json().error).toBe('550 Adresse refusée');
});

test('jeton inconnu → 404, révoqué → 410', async () => {
  const [link] = await invited({ name: 'Tani Dojo', coachEmail: 'tani@example.org' });
  expect((await app.inject({ method: 'GET', url: '/api/inscription/inconnu' })).statusCode).toBe(404);
  await app.inject({ method: 'DELETE', url: `${base}/invitations/${link!.clubId}` });
  expect((await app.inject({ method: 'GET', url: `/api/inscription/${link!.token}` })).statusCode).toBe(410);
});
