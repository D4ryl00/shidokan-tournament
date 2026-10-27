import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import type { MailTransport } from '../../src/server/mail.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

type Sent = { from: { name: string; address: string }; to: { name: string; address: string }[]; subject: string; text: string; attachments?: { filename: string; content: Buffer; contentType: string }[] };
let sent: (Omit<Sent, 'to'> & { to: string })[];
let failFor: Set<string>;
let verifyError: string | null;
const transport: MailTransport = () => ({
  verify: async () => {
    if (verifyError) throw new Error(verifyError);
    return true;
  },
  sendMail: async (m: Sent) => {
    if (m.to.some((a) => failFor.has(a.address))) throw new Error('550 Adresse refusée');
    sent.push({ ...m, to: m.to.map((a) => a.address).join(', ') });
    return {};
  },
});

let app: FastifyInstance;
let base: string;
let dbPathOf: string;
const SMTP = { host: 'smtp.gmail.com', port: 465, security: 'tls', user: 'orga@gmail.com', password: 'secret', fromName: 'Shidokan France', fromEmail: 'orga@gmail.com' };
const EMPTY = { affiliationNumber: null, coachName: null, coachPhone: null, coachEmails: [], notes: null };

beforeEach(async () => {
  sent = [];
  failFor = new Set();
  verifyError = null;
  dbPathOf = tmpDbPath();
  app = await buildApp({ dbPath: dbPathOf, mailTransport: transport, publicUrl: 'https://competitions.example.org' });
  base = `/api/competitions/${(await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Coupe 2026', date: '2026-11-22', location: 'Nice' } })).json().id}`;
  await app.inject({ method: 'PATCH', url: `${base}/club-entry`, payload: { status: 'open', deadline: '2026-11-15' } });
});
afterEach(async () => app.close());

async function invited(...clubs: { name: string; coachEmails: string[]; coachName?: string }[]) {
  const ids: string[] = [];
  for (const c of clubs) ids.push((await app.inject({ method: 'POST', url: '/api/club-directory', payload: { ...EMPTY, coachName: c.coachName ?? null, ...c } })).json().id);
  return (await app.inject({ method: 'POST', url: `${base}/invitations`, payload: { directoryIds: ids } })).json() as { clubId: string; clubName: string; token: string }[];
}
const smtp = () => app.inject({ method: 'PATCH', url: '/api/app-settings', payload: { smtp: SMTP } });
const send = (clubIds: string[]) => app.inject({ method: 'POST', url: `${base}/invitations/send`, payload: { clubs: clubIds.map((clubId) => ({ clubId })) } });
const sendTo = (clubs: { clubId: string; emails?: string[] }[]) => app.inject({ method: 'POST', url: `${base}/invitations/send`, payload: { clubs } });
const tokenOf = (text: string) => text.match(/\/inscription\/([A-Za-z0-9_-]+)/)![1]!;

test('envoi à deux clubs : mails rendus, liens neufs qui fonctionnent, journal ; ancien lien → 410', async () => {
  await smtp();
  const links = await invited({ name: 'Tani Dojo', coachEmails: ['tani@example.org'], coachName: 'Jean' }, { name: 'Budo', coachEmails: ['budo@example.org'] });
  const res = await send(links.map((l) => l.clubId));
  expect(res.statusCode).toBe(200);
  expect(res.json().map((r: { status: string }) => r.status)).toEqual(['sent', 'sent']);
  expect(sent).toHaveLength(2);
  const tani = sent.find((m) => m.to === 'tani@example.org')!;
  expect(tani.from).toEqual({ name: 'Shidokan France', address: 'orga@gmail.com' });
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
  const links = await invited({ name: 'Tani Dojo', coachEmails: ['tani@example.org'] }, { name: 'Budo', coachEmails: ['budo@example.org'] });
  const res = (await send(links.map((l) => l.clubId))).json() as { clubName: string; status: string; error: string | null }[];
  expect(res.find((r) => r.clubName === 'Budo')).toMatchObject({ status: 'error', error: '550 Adresse refusée' });
  expect(sent.map((m) => m.to)).toEqual(['tani@example.org']);
  const rows = (await app.inject({ method: 'GET', url: `${base}/invitations` })).json() as { clubName: string; lastMail: { status: string; error: string | null } | null }[];
  expect(rows.find((r) => r.clubName === 'Budo')!.lastMail).toMatchObject({ status: 'error', error: '550 Adresse refusée' });
});

test('club sans e-mail → error « Pas d’e-mail pour ce club. », son lien n’est pas changé', async () => {
  await smtp();
  const [link] = await invited({ name: 'Tani Dojo', coachEmails: [] });
  const res = (await send([link!.clubId])).json();
  expect(res).toEqual([expect.objectContaining({ status: 'error', error: 'Pas d’e-mail pour ce club.' })]);
  expect((await app.inject({ method: 'GET', url: `/api/inscription/${link!.token}` })).statusCode).toBe(200);
});

test('sans réglage SMTP → 400', async () => {
  const [link] = await invited({ name: 'Tani Dojo', coachEmails: ['tani@example.org'] });
  const res = await send([link!.clubId]);
  expect(res.statusCode).toBe(400);
  expect(res.json().error).toBe('Réglez l’envoi des mails dans les Réglages de l’application.');
});

test('mailto : destinataire, objet et corps avec un lien neuf', async () => {
  const [link] = await invited({ name: 'Tani Dojo', coachEmails: ['tani@example.org'] });
  const res = (await app.inject({ method: 'POST', url: `${base}/invitations/${link!.clubId}/mailto` })).json();
  expect(res).toMatchObject({ to: 'tani@example.org', subject: 'Inscriptions — Coupe 2026' });
  expect(tokenOf(res.body)).not.toBe(link!.token);
  expect((await app.inject({ method: 'GET', url: `/api/inscription/${tokenOf(res.body)}` })).statusCode).toBe(200);
});

test('plusieurs adresses : un seul mail, adressé à toutes ; noté dans le journal', async () => {
  await smtp();
  const [link] = await invited({ name: 'Tani Dojo', coachEmails: ['coach@tani.fr', 'pres@tani.fr'] });
  const res = (await send([link!.clubId])).json();
  expect(res).toEqual([expect.objectContaining({ status: 'sent', email: 'coach@tani.fr, pres@tani.fr' })]);
  expect(sent.map((m) => m.to)).toEqual(['coach@tani.fr, pres@tani.fr']);
});

test('adresses choisies : seulement celles-là ; une adresse qui n’est pas celle du club → erreur pour ce club, rien d’envoyé', async () => {
  await smtp();
  const links = await invited({ name: 'Tani Dojo', coachEmails: ['coach@tani.fr', 'pres@tani.fr', 'secr@tani.fr'] }, { name: 'Budo', coachEmails: ['budo@example.org'] });
  const [tani, budo] = [links.find((l) => l.clubName === 'Tani Dojo')!, links.find((l) => l.clubName === 'Budo')!];
  const res = (await sendTo([{ clubId: tani.clubId, emails: ['SECR@tani.fr', 'coach@tani.fr'] }, { clubId: budo.clubId }])).json() as { clubName: string; status: string; email: string }[];
  expect(res.map((r) => [r.clubName, r.status, r.email])).toEqual([['Tani Dojo', 'sent', 'coach@tani.fr, secr@tani.fr'], ['Budo', 'sent', 'budo@example.org']]);
  expect(sent.map((m) => m.to)).toEqual(['coach@tani.fr, secr@tani.fr', 'budo@example.org']);
  const other = (await sendTo([{ clubId: tani.clubId, emails: ['pirate@example.org'] }])).json();
  expect(other).toEqual([expect.objectContaining({ status: 'error', error: '« pirate@example.org » n’est plus une adresse de ce club : rechargez la page.' })]);
  expect(sent).toHaveLength(2);
  expect((await sendTo([{ clubId: tani.clubId, emails: [] }])).statusCode).toBe(400);
});

test('mailto : toutes les adresses, ou celles choisies, séparées par des virgules', async () => {
  const [link] = await invited({ name: 'Tani Dojo', coachEmails: ['coach@tani.fr', 'pres@tani.fr'] });
  const url = `${base}/invitations/${link!.clubId}/mailto`;
  expect((await app.inject({ method: 'POST', url })).json().to).toBe('coach@tani.fr,pres@tani.fr');
  expect((await app.inject({ method: 'POST', url, payload: { emails: ['pres@tani.fr'] } })).json().to).toBe('pres@tani.fr');
  expect((await app.inject({ method: 'POST', url, payload: { emails: ['autre@x.fr'] } })).statusCode).toBe(400);
});

test('aperçu : rien n’est créé ; {lien} laissé visible', async () => {
  const [link] = await invited({ name: 'Tani Dojo', coachEmails: ['tani@example.org'] });
  const res = (await app.inject({ method: 'GET', url: `${base}/invitations/preview?clubId=${link!.clubId}` })).json();
  expect(res.subject).toBe('Inscriptions — Coupe 2026');
  expect(res.body).toContain('{lien}');
  expect((await app.inject({ method: 'GET', url: `/api/inscription/${link!.token}` })).statusCode).toBe(200);
});

test('message propre à la compétition utilisé quand il existe', async () => {
  await smtp();
  await app.inject({ method: 'PATCH', url: base, payload: { settings: { invitationMail: { subject: 'Coupe {competition}', body: 'Club {club} : {lien}' } } } });
  const [link] = await invited({ name: 'Tani Dojo', coachEmails: ['tani@example.org'] });
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
  const [link] = await invited({ name: 'Tani Dojo', coachEmails: ['tani@example.org'] });
  expect((await app.inject({ method: 'GET', url: '/api/inscription/inconnu' })).statusCode).toBe(404);
  await app.inject({ method: 'DELETE', url: `${base}/invitations/${link!.clubId}` });
  expect((await app.inject({ method: 'GET', url: `/api/inscription/${link!.token}` })).statusCode).toBe(410);
});

test('SMTP indisponible (vérification en échec) → 400, aucun lien changé, aucun mail', async () => {
  await smtp();
  verifyError = '535 Mot de passe refusé';
  const [link] = await invited({ name: 'Tani Dojo', coachEmails: ['tani@example.org'] });
  const res = await send([link!.clubId]);
  expect(res.statusCode).toBe(400);
  expect(res.json().error).toBe('Envoi impossible, aucun lien n’a changé : 535 Mot de passe refusé');
  expect(sent).toEqual([]);
  expect((await app.inject({ method: 'GET', url: `/api/inscription/${link!.token}` })).statusCode).toBe(200);
});

test('club en erreur : son ancien lien fonctionne toujours', async () => {
  await smtp();
  failFor.add('budo@example.org');
  const links = await invited({ name: 'Budo', coachEmails: ['budo@example.org'] });
  await send([links[0]!.clubId]);
  expect((await app.inject({ method: 'GET', url: `/api/inscription/${links[0]!.token}` })).statusCode).toBe(200);
  const rows = (await app.inject({ method: 'GET', url: `${base}/invitations` })).json() as { invited: boolean }[];
  expect(rows[0]!.invited).toBe(true);
});

test('un club inconnu au milieu : erreur pour lui seul, les autres partent', async () => {
  await smtp();
  const links = await invited({ name: 'Tani Dojo', coachEmails: ['tani@example.org'] }, { name: 'Budo', coachEmails: ['budo@example.org'] });
  const res = await send([links[0]!.clubId, 'inconnu', links[1]!.clubId]);
  expect(res.statusCode).toBe(200);
  expect(res.json().map((r: { status: string }) => r.status)).toEqual(['sent', 'error', 'sent']);
});

test('adresse enregistrée invalide (liste, texte) → erreur pour ce club, lien inchangé', async () => {
  await smtp();
  const [link] = await invited({ name: 'Tani Dojo', coachEmails: ['tani@example.org'] });
  // Une fiche importée peut contenir n'importe quel texte : il est vérifié à l'envoi.
  await app.inject({ method: 'PATCH', url: `${base}/clubs/${link!.clubId}`, payload: { coachEmails: [] } });
  const raw = new (await import('better-sqlite3')).default(dbPathOf);
  raw.prepare('update clubs set coach_emails = ? where id = ?').run(JSON.stringify(['ok@x.fr', 'a@x.fr, b@y.fr']), link!.clubId);
  raw.close();
  const res = (await send([link!.clubId])).json();
  expect(res).toEqual([expect.objectContaining({ status: 'error', error: 'Adresse e-mail invalide pour ce club : a@x.fr, b@y.fr' })]);
  expect(sent).toEqual([]);
  expect((await app.inject({ method: 'GET', url: `/api/inscription/${link!.token}` })).statusCode).toBe(200);
});

test('rôle serveur sans PUBLIC_URL → envoi refusé (les liens ne doivent pas dépendre des en-têtes de la requête)', async () => {
  const { createUser } = await import('../../src/server/auth/sessions.js');
  const { openDb, closeDb } = await import('../../src/server/db/client.js');
  const { tmpDbPath: tmp } = await import('../helpers/tmp-db.js');
  const p = tmp();
  const d = openDb(p);
  createUser(d, 'orga@example.org', 'mot-de-passe-long');
  closeDb(d);
  const srv = await buildApp({ dbPath: p, role: 'serveur', mailTransport: transport });
  const login = await srv.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'orga@example.org', password: 'mot-de-passe-long' } });
  const cookie = String(login.headers['set-cookie']).split(';')[0]!;
  const c = (await srv.inject({ method: 'POST', url: '/api/competitions', headers: { cookie }, payload: { name: 'Coupe', date: '2026-11-22' } })).json();
  const res = await srv.inject({ method: 'POST', url: `/api/competitions/${c.id}/invitations/x/mailto`, headers: { cookie } });
  expect(res.statusCode).toBe(400);
  expect(res.json().error).toBe('L’adresse publique du serveur (PUBLIC_URL) n’est pas réglée.');
  await srv.close();
});

test('pièces jointes : la fiche à imprimer (PDF) et le tableur (.ods), à chaque club ; le message le dit', async () => {
  await smtp();
  const links = await invited({ name: 'Tani Dojo', coachEmails: ['tani@example.org'] }, { name: 'Budo', coachEmails: ['budo@example.org'] });
  await send(links.map((l) => l.clubId));
  expect(sent).toHaveLength(2);
  for (const m of sent) {
    expect(m.attachments?.map((a) => [a.filename, a.contentType])).toEqual([
      ['fiche-club-2026-11-22.pdf', 'application/pdf'],
      ['fiche-club-2026-11-22.ods', 'application/vnd.oasis.opendocument.spreadsheet'],
    ]);
    expect(m.attachments![0]!.content.subarray(0, 5).toString()).toBe('%PDF-');
    expect(m.attachments![1]!.content.subarray(0, 2).toString()).toBe('PK');
    expect(m.text).toContain('Vous pouvez aussi inscrire vos élèves avec les fiches jointes à ce mail');
    expect(m.text).toContain('avant le 15/11/2026');
  }
});

test('message enregistré identique à l’ancien message par défaut : remplacé par le nouveau ; un message personnalisé reste tel quel', async () => {
  await smtp();
  const legacy = { subject: 'Inscriptions — {competition}', body: LEGACY_BODY };
  expect((await app.inject({ method: 'PATCH', url: '/api/app-settings', payload: { invitationMail: legacy } })).statusCode).toBe(200);
  const [tani] = await invited({ name: 'Tani Dojo', coachEmails: ['tani@example.org'] });
  await send([tani!.clubId]);
  expect(sent[0]!.text).toContain('Vous pouvez aussi inscrire vos élèves');
  const custom = { subject: 'Coupe {competition}', body: 'Club {club} : {lien}' };
  await app.inject({ method: 'PATCH', url: '/api/app-settings', payload: { invitationMail: custom } });
  await send([tani!.clubId]);
  expect(sent[1]!.text).toMatch(/^Club Tani Dojo : https:/);
  expect(sent[1]!.attachments).toHaveLength(2);
});

const LEGACY_BODY = [
  'Bonjour {coach},',
  '',
  'Les inscriptions à la compétition « {competition} » ({date}, {lieu}) sont ouvertes.',
  "Inscrivez les combattants de {club} sur cette page, et revenez-y pour les modifier jusqu'au {date_limite} :",
  '{lien}',
  '',
  'Ce lien est personnel à votre club : ne le transmettez pas.',
  '',
  'Sportivement,',
  'Shidokan France',
].join('\n');
