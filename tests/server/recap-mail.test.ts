import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import type { MailTransport } from '../../src/server/mail.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

type Sent = { from: { name: string; address: string }; to: { name: string; address: string }[]; subject: string; text: string; html?: string; attachments: { filename: string; content: Buffer; contentType: string; cid?: string }[] };
let sent: Sent[];
let failFor: Set<string>;
let verifyError: string | null;
/** Envoi retenu tant que cette promesse n'est pas tenue (comme dans mail.test.ts). */
let gate: Promise<void> | null;
const transport: MailTransport = () => ({
  verify: async () => {
    if (verifyError) throw new Error(verifyError);
    return true;
  },
  sendMail: async (m) => {
    if (gate) await gate;
    if (m.to.some((a) => failFor.has(a.address))) throw new Error('550 Adresse refusée');
    sent.push({ ...m, attachments: m.attachments ?? [] } as Sent);
    return {};
  },
});

let app: FastifyInstance;
let base: string;
let dbPath: string;
/** Lecture seule de la base de test (journal des mails). */
let db: Database.Database;
const SMTP = { host: 'smtp.gmail.com', port: 465, security: 'tls', user: 'orga@gmail.com', password: 'secret', fromName: 'Shidokan France', fromEmail: 'orga@gmail.com' };

beforeEach(async () => {
  sent = [];
  failFor = new Set();
  verifyError = null;
  gate = null;
  dbPath = tmpDbPath();
  app = await buildApp({ clubServices: true, dbPath, mailTransport: transport, mailPauseMs: 0, publicUrl: 'https://competitions.example.org' });
  base = `/api/competitions/${(await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Coupe 2026', date: '2026-11-22', location: 'Nice' } })).json().id}`;
  await app.inject({ method: 'PATCH', url: '/api/app-settings', payload: { smtp: SMTP } });
  db = new Database(dbPath, { readonly: true });
});
afterEach(async () => {
  db.close();
  await app.close();
});

const call = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) => app.inject({ method, url: `${base}${url}`, payload });

let n = 0;
async function club(c: { name: string; coachEmails: string[]; coachName?: string }): Promise<string> {
  const res = await call('POST', '/clubs', { name: c.name, coachEmails: c.coachEmails, coachName: c.coachName ?? null });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}
async function clubWithRegistration(c: { name: string; coachEmails: string[]; coachName?: string }): Promise<string> {
  const clubId = await club(c);
  n++;
  const res = await call('POST', '/registrations', {
    clubId, lastName: `NOM${n}`, firstName: 'x', sex: 'F', ageBandCode: 'cadet', discipline: 'karate', ruleset: 'jiyu', weightClassId: 'cadet:F:-54', source: 'manual',
  });
  expect(res.statusCode).toBe(201);
  return clubId;
}
/** Avancement relu jusqu'à la fin de l'envoi. */
async function finished(url: string) {
  for (let i = 0; i < 2000; i++) {
    const { job } = (await call('GET', url)).json();
    if (job?.finished) return job as { kind: string; results: { clubId: string; status: string; error: string | null }[]; error: string | null };
    await new Promise((r) => setTimeout(r, 2));
  }
  throw new Error('Envoi jamais terminé');
}

test('récapitulatif à un club : PDF joint, message de départ, noté recap', async () => {
  const clubId = await clubWithRegistration({ name: 'Étoile', coachEmails: ['a@x.fr', 'b@x.fr'], coachName: 'M. Coach' });
  const res = await call('POST', `/invitations/${clubId}/recap`);
  expect(res.statusCode).toBe(200);
  const r = res.json();
  expect(r.status).toBe('sent');
  const m = sent.at(-1)!;
  expect(m.to.map((t) => t.address)).toEqual(['a@x.fr', 'b@x.fr']);
  expect(m.from).toEqual({ name: 'Shidokan France', address: 'orga@gmail.com' });
  expect(m.subject).toBe('Récapitulatif Coupe 2026 — Étoile');
  expect(m.text).toContain('Bonjour M. Coach,');
  expect(m.html).toContain('<p>Bonjour M. Coach,</p>');
  expect(m.attachments.map((a) => a.filename)).toEqual(['recapitulatif-etoile.pdf']);
  expect(m.attachments[0]!.content.subarray(0, 4).toString()).toBe('%PDF');
  expect(m.attachments[0]!.contentType).toBe('application/pdf');
  expect(db.prepare('select kind from mail_log').all()).toEqual([{ kind: 'recap' }]);
  expect((await call('GET', '/invitations')).json().find((c: { clubId: string }) => c.clubId === clubId).lastMail).toBeNull();
});

test('récapitulatif à un club sans inscription : erreur notée pour ce club, rien d’envoyé', async () => {
  const clubId = await club({ name: 'Budo', coachEmails: ['budo@x.fr'] });
  const res = await call('POST', `/invitations/${clubId}/recap`);
  expect(res.statusCode).toBe(200);
  expect(res.json()).toMatchObject({ clubId, clubName: 'Budo', status: 'error', error: 'Aucune inscription.' });
  expect(sent).toEqual([]);
});

test('récapitulatif sans réglage d’envoi ou serveur injoignable → 400, rien ne part', async () => {
  const clubId = await clubWithRegistration({ name: 'Étoile', coachEmails: ['a@x.fr'] });
  verifyError = 'connect ECONNREFUSED';
  const res = await call('POST', `/invitations/${clubId}/recap`);
  expect(res.statusCode).toBe(400);
  expect(res.json().error).toContain('connect ECONNREFUSED');
  expect((await call('POST', '/invitations/recaps/send', { clubIds: [clubId] })).statusCode).toBe(400);
  expect((await call('GET', '/invitations/recaps/send')).json()).toEqual({ job: null });
  expect(sent).toEqual([]);
  expect(db.prepare('select count(*) as n from mail_log').get()).toEqual({ n: 0 });
});

describe('trois clubs', () => {
  let a: string;
  let b: string;
  let c: string;
  beforeEach(async () => {
    a = await clubWithRegistration({ name: 'Étoile', coachEmails: ['a@x.fr'], coachName: 'M. Coach' });
    b = await club({ name: 'Budo', coachEmails: ['budo@x.fr'] });
    c = await clubWithRegistration({ name: 'Tani Dojo', coachEmails: [] });
  });

  test('récapitulatifs à tous : clubs sans inscription ou sans e-mail sautés avec leur raison', async () => {
    const res = await call('POST', '/invitations/recaps/send', { clubIds: [a, b, c] });
    expect(res.statusCode).toBe(202);
    const job = res.json();
    expect(job.kind).toBe('recap');
    expect(job.total).toBe(3);
    const done = await finished('/invitations/recaps/send');
    expect(done.results.map((r) => [r.clubId, r.status, r.error])).toEqual([[a, 'sent', null], [b, 'error', 'Aucune inscription.'], [c, 'error', 'Pas d’e-mail pour ce club.']]);
    expect(sent.map((m) => m.attachments.map((f) => f.filename))).toEqual([['recapitulatif-etoile.pdf']]);
    expect(db.prepare('select club_id as clubId, kind, status from mail_log').all()).toEqual([{ clubId: a, kind: 'recap', status: 'sent' }]);
    // Le dernier envoi des invitations reste à part.
    expect((await call('GET', '/invitations/send')).json()).toEqual({ job: null });
  });

  test('un club dont le mail est refusé : erreur notée, les autres partent', async () => {
    const d = await clubWithRegistration({ name: 'Kime', coachEmails: ['kime@x.fr'] });
    failFor.add('a@x.fr');
    await call('POST', '/invitations/recaps/send', { clubIds: [a, d] });
    const done = await finished('/invitations/recaps/send');
    expect(done.results.map((r) => [r.clubId, r.status, r.error])).toEqual([[a, 'error', '550 Adresse refusée'], [d, 'sent', null]]);
    expect(db.prepare('select club_id as clubId, kind, status, error from mail_log order by status').all()).toEqual([
      { clubId: a, kind: 'recap', status: 'error', error: '550 Adresse refusée' },
      { clubId: d, kind: 'recap', status: 'sent', error: null },
    ]);
  });

  test('un seul envoi groupé à la fois, invitations et récapitulatifs confondus', async () => {
    gate = new Promise(() => {}); // transport bloqué, comme dans mail.test.ts
    expect((await call('POST', '/invitations/send', { clubs: [{ clubId: a }] })).statusCode).toBe(202);
    expect((await call('POST', '/invitations/recaps/send', { clubIds: [a] })).statusCode).toBe(409);
    // Chaque type d'envoi a son propre avancement.
    expect((await call('GET', '/invitations/send')).json().job).toMatchObject({ kind: 'invitation', finished: false });
    expect((await call('GET', '/invitations/recaps/send')).json()).toEqual({ job: null });
  });

  test('un récapitulatif en cours bloque aussi l’envoi des invitations', async () => {
    gate = new Promise(() => {});
    expect((await call('POST', '/invitations/recaps/send', { clubIds: [a] })).statusCode).toBe(202);
    expect((await call('POST', '/invitations/send', { clubs: [{ clubId: a }] })).statusCode).toBe(409);
    expect((await call('GET', '/invitations/send')).json()).toEqual({ job: null });
  });

  test('liste des clubs vide ou trop longue → 400', async () => {
    expect((await call('POST', '/invitations/recaps/send', { clubIds: [] })).statusCode).toBe(400);
    expect((await call('POST', '/invitations/recaps/send', { clubIds: Array.from({ length: 501 }, () => a) })).statusCode).toBe(400);
  });

  test('aperçu : message de départ', async () => {
    const p = (await call('GET', `/invitations/recaps/preview?clubId=${a}`)).json();
    expect(p.subject).toBe('Récapitulatif Coupe 2026 — Étoile');
    expect(p.body).toContain('Bonjour M. Coach,');
    expect(p.html).toContain('<p>Bonjour M. Coach,</p>');
  });

  test('message propre à la compétition : variables remplacées', async () => {
    expect((await call('PATCH', '', { settings: { recapMail: { subject: '{club} / {competition}', body: 'Bonjour {coach}, {date} à {lieu}' } } })).statusCode).toBe(200);
    const p = (await call('GET', `/invitations/recaps/preview?clubId=${a}`)).json();
    expect(p.subject).toBe('Étoile / Coupe 2026');
    expect(p.body).toBe('Bonjour M. Coach, 22/11/2026 à Nice');
    await call('POST', `/invitations/${a}/recap`);
    expect(sent.at(-1)!.subject).toBe('Étoile / Coupe 2026');
  });
});

test('sur un PC : envoi du récapitulatif refusé (403)', async () => {
  const pc = await buildApp({ clubServices: false, dbPath: tmpDbPath(), mailTransport: transport });
  try {
    expect((await pc.inject({ method: 'POST', url: '/api/competitions/x/invitations/x/recap' })).statusCode).toBe(403);
    expect((await pc.inject({ method: 'POST', url: '/api/competitions/x/invitations/recaps/send', payload: { clubIds: ['x'] } })).statusCode).toBe(403);
    expect((await pc.inject({ method: 'GET', url: '/api/competitions/x/invitations/recaps/preview?clubId=x' })).statusCode).toBe(403);
  } finally {
    await pc.close();
  }
});
