import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import nodemailer from 'nodemailer';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { mailErrorText, type MailTransport } from '../../src/server/mail.js';
import { formatBytes } from '../../src/domain/mail-attachments.js';
import { MAIL_IMAGE_LIMITS } from '../../src/domain/mail-images.js';
import { textToHtml } from '../../src/domain/mail-template.js';
import { attachmentDir } from '../../src/server/repositories/mail-attachments.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

type Sent = { from: { name: string; address: string }; to: { name: string; address: string }[]; subject: string; text: string; html?: string; attachments?: { filename: string; content: Buffer; contentType: string; cid?: string; contentDisposition?: string }[] };
let sent: (Omit<Sent, 'to'> & { to: string })[];
let failFor: Set<string>;
let verifyError: string | null;
/** Échec à la façon de nodemailer (code et réponse du serveur) pour une adresse. */
let failCode: { address: string; code: string; response?: string } | null;
const transport: MailTransport = () => ({
  verify: async () => {
    if (verifyError) throw new Error(verifyError);
    return true;
  },
  sendMail: async (m: Sent) => {
    if (m.to.some((a) => failFor.has(a.address))) throw new Error('550 Adresse refusée');
    if (failCode && m.to.some((a) => a.address === failCode!.address)) throw Object.assign(new Error(`SMTP ${failCode.code}`), { code: failCode.code, response: failCode.response });
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
  failCode = null;
  dbPathOf = tmpDbPath();
  app = await buildApp({ clubServices: true, dbPath: dbPathOf, mailTransport: transport, publicUrl: 'https://competitions.example.org' });
  base = `/api/competitions/${(await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Coupe 2026', date: '2026-11-22', location: 'Nice' } })).json().id}`;
  await app.inject({ method: 'PATCH', url: `${base}/club-entry`, payload: { status: 'open', deadline: '2026-11-15' } });
});
afterEach(async () => app.close());

async function invited(...clubs: { name: string; coachEmails: string[]; coachName?: string }[]) {
  const ids: string[] = [];
  for (const c of clubs) ids.push((await app.inject({ method: 'POST', url: '/api/club-directory', payload: { ...EMPTY, coachName: c.coachName ?? null, ...c } })).json().id);
  await app.inject({ method: 'POST', url: `${base}/invitations`, payload: { directoryIds: ids } });
  const rows = (await app.inject({ method: 'GET', url: `${base}/invitations` })).json() as { clubId: string; directoryClubId: string }[];
  return Promise.all(ids.map(async (id) => (await app.inject({ method: 'POST', url: `${base}/invitations/${rows.find((r) => r.directoryClubId === id)!.clubId}/links` })).json() as { clubId: string; clubName: string; token: string }));
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
  // Version HTML jointe : Gmail recoupe le texte brut à ~76 caractères, la version HTML garde les phrases entières.
  expect(tani.html).toContain('<p>Les inscriptions à la compétition « Coupe 2026 » (22/11/2026, Nice) sont ouvertes.<br>');
  expect(tani.html).toContain(`<a href="https://competitions.example.org/inscription/${tokenOf(tani.text)}">`);
  expect((await app.inject({ method: 'GET', url: `/api/inscription/${tokenOf(tani.text)}` })).statusCode).toBe(200);
  // Le lien d'avant marche toujours : les liens s'ajoutent.
  const taniClub = links.find((l) => l.clubName === 'Tani Dojo')!;
  expect((await app.inject({ method: 'GET', url: `/api/inscription/${taniClub.token}` })).statusCode).toBe(200);
  const access = (await app.inject({ method: 'GET', url: `${base}/invitations/${taniClub.clubId}/links` })).json() as { sentAt: string | null; sentVia: string | null }[];
  expect(access.map((a) => a.sentVia)).toEqual(['mail', null]);
  expect(access[0]!.sentAt).toEqual(expect.any(String));
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
  expect((await app.inject({ method: 'GET', url: `/api/inscription/${link!.token}` })).statusCode).toBe(200);
  const access = (await app.inject({ method: 'GET', url: `${base}/invitations/${link!.clubId}/links` })).json() as { sentAt: string | null; sentVia: string | null }[];
  expect(access.map((a) => a.sentVia)).toEqual(['messagerie', null]);
  expect(access[0]!.sentAt).toEqual(expect.any(String));
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
  const revoked = await app.inject({ method: 'GET', url: `/api/inscription/${link!.token}` });
  expect(revoked.statusCode).toBe(410);
  expect(revoked.json().error).toBe('Ce lien n’est plus valable : utilisez celui d’un mail plus récent ou contactez l’organisateur.');
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
  // Le lien créé pour le mail raté est retiré : seul l'ancien reste.
  expect((await app.inject({ method: 'GET', url: `${base}/invitations/${links[0]!.clubId}/links` })).json()).toHaveLength(1);
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

const PNG = Buffer.from('\x89PNG affiche');
const REGLEMENT = Buffer.from('%PDF-1.4 règlement');
const attach = async (name: string, data: Buffer) =>
  (await app.inject({ method: 'POST', url: `${base}/mail-attachments`, payload: data, headers: { 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent(name) } })).json() as { id: string };
const include = (id: string, included: boolean) => app.inject({ method: 'PATCH', url: `${base}/mail-attachments/${id}`, payload: { included } });
const names = (m: Pick<Sent, 'attachments'>) => (m.attachments ?? []).map((a) => a.filename);

test('pièces ajoutées : jointes après les fiches, dans l’ordre d’ajout, avec leur type et leur contenu', async () => {
  await smtp();
  await attach('affiche.png', PNG);
  await attach('reglement.pdf', REGLEMENT);
  const [tani] = await invited({ name: 'Tani Dojo', coachEmails: ['tani@example.org'] });
  await send([tani!.clubId]);
  expect(names(sent[0]!)).toEqual(['fiche-club-2026-11-22.pdf', 'fiche-club-2026-11-22.ods', 'affiche.png', 'reglement.pdf']);
  expect(sent[0]!.attachments![2]).toMatchObject({ contentType: 'image/png', content: PNG });
  expect(sent[0]!.attachments![3]).toMatchObject({ contentType: 'application/pdf', content: REGLEMENT });
});

test('nom accentué avec guillemets : gardé tel quel dans le mail, encodé proprement dans le message MIME', async () => {
  await smtp();
  await attach('Règlement "2026" été.pdf', REGLEMENT);
  const [tani] = await invited({ name: 'Tani Dojo', coachEmails: ['tani@example.org'] });
  await send([tani!.clubId]);
  expect(names(sent[0]!)[2]).toBe('Règlement "2026" été.pdf');
  const { message } = await nodemailer.createTransport({ streamTransport: true, buffer: true }).sendMail({ ...sent[0]!, to: sent[0]!.to });
  const mime = (message as Buffer).toString();
  const header = mime.split(/\r?\n(?=\S)/).find((h) => /^Content-Disposition: attachment/i.test(h) && /R%C3%A8glement|=\?UTF-8\?/i.test(h))!;
  const params = Object.fromEntries([...header.replace(/\r?\n\s+/g, ' ').matchAll(/(filename\*?\d*\*?)=("[^"]*"|[^;\s]+)/g)].map((m) => [m[1]!, m[2]!]));
  const star = Object.keys(params).filter((k) => k.startsWith('filename*')).sort((a, b) => Number(a.match(/\d+/)?.[0] ?? 0) - Number(b.match(/\d+/)?.[0] ?? 0));
  const decoded = decodeURIComponent(star.map((k) => params[k]!.replace(/^"|"$/g, '')).join('').replace(/^utf-8''/i, ''));
  expect(decoded).toBe('Règlement "2026" été.pdf');
});

test('seulement les pièces cochées ; aucune cochée : le mail part sans pièce jointe', async () => {
  await smtp();
  const affiche = await attach('affiche.png', PNG);
  const reglement = await attach('reglement.pdf', REGLEMENT);
  const [tani] = await invited({ name: 'Tani Dojo', coachEmails: ['tani@example.org'] });
  await app.inject({ method: 'PATCH', url: base, payload: { settings: { clubFormAttachments: { pdf: false } } } });
  await include(affiche.id, false);
  await send([tani!.clubId]);
  expect(names(sent[0]!)).toEqual(['fiche-club-2026-11-22.ods', 'reglement.pdf']);
  await app.inject({ method: 'PATCH', url: base, payload: { settings: { clubFormAttachments: { ods: false } } } });
  await include(reglement.id, false);
  const res = await send([tani!.clubId]);
  expect(res.json()[0].status).toBe('sent');
  expect(sent[1]!.attachments).toEqual([]);
});

test('pièce cochée dont le fichier manque : rien n’est envoyé, aucun lien ne change ; décochée : envoi normal', async () => {
  await smtp();
  const reglement = await attach('reglement.pdf', REGLEMENT);
  const [tani] = await invited({ name: 'Tani Dojo', coachEmails: ['tani@example.org'] });
  fs.rmSync(path.join(attachmentDir(dbPathOf), reglement.id));
  const res = await send([tani!.clubId]);
  expect(res.statusCode).toBe(400);
  expect(res.json().error).toBe('Pièce jointe introuvable : reglement.pdf. Décochez-la, supprimez-la ou ajoutez-la de nouveau.');
  expect(sent).toEqual([]);
  expect((await app.inject({ method: 'GET', url: `/api/inscription/${tani!.token}` })).statusCode).toBe(200);
  // Ajoutée de nouveau, comme le conseille le message : elle part.
  expect((await attach('reglement.pdf', REGLEMENT)).id).toBe(reglement.id);
  expect((await send([tani!.clubId])).json()[0].status).toBe('sent');
  expect(names(sent[0]!)).toEqual(['fiche-club-2026-11-22.pdf', 'fiche-club-2026-11-22.ods', 'reglement.pdf']);
  sent = [];
  fs.rmSync(path.join(attachmentDir(dbPathOf), reglement.id));
  await include(reglement.id, false);
  expect((await send([tani!.clubId])).json()[0].status).toBe('sent');
  expect(names(sent[0]!)).toEqual(['fiche-club-2026-11-22.pdf', 'fiche-club-2026-11-22.ods']);
});

test('mail d’essai : sans pièce jointe', async () => {
  await smtp();
  await attach('affiche.png', PNG);
  expect((await app.inject({ method: 'POST', url: '/api/app-settings/test-mail', payload: { to: 'moi@example.org' } })).statusCode).toBe(204);
  expect(sent[0]!.attachments ?? []).toEqual([]);
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

test('erreurs du serveur d’envoi en français, avec la réponse du serveur en détail', () => {
  const smtp = (message: string, code: string, response?: string) => Object.assign(new Error(message), { code, response });
  expect(mailErrorText(smtp('Can\'t send mail - all recipients were rejected: 550 refused', 'EENVELOPE', '550 refused')))
    .toBe('Le serveur d’envoi a refusé l’adresse (réponse du serveur : 550 refused)');
  expect(mailErrorText(smtp('Invalid login: 535 bad', 'EAUTH', '535 bad'))).toMatch(/^Identifiant ou mot de passe refusé par le serveur d’envoi : vérifiez les Réglages de l’application\. \(réponse du serveur : 535 bad\)$/);
  expect(mailErrorText(smtp('connect ECONNREFUSED 127.0.0.1:2525', 'ESOCKET'))).toMatch(/^Serveur d’envoi injoignable.*\(connect ECONNREFUSED 127\.0\.0\.1:2525\)$/);
  expect(mailErrorText(smtp('Greeting never received', 'ETIMEDOUT'))).toMatch(/^Serveur d’envoi injoignable/);
  expect(mailErrorText(smtp('wrong version number', 'ETLS'))).toMatch(/^Connexion sécurisée impossible/);
  expect(mailErrorText(smtp('Message failed: 552 too big', 'EMESSAGE', '552 too big'))).toMatch(/^Le serveur d’envoi a refusé le message.*\(réponse du serveur : 552 too big\)$/);
  // Messages déjà en français (Gmail, contrôles de l'application) : tels quels.
  expect(mailErrorText(new Error('Gmail a refusé l’envoi (403) : quota'))).toBe('Gmail a refusé l’envoi (403) : quota');
  expect(mailErrorText('texte')).toBe('texte');
});

test('club en erreur SMTP : l’erreur notée et renvoyée est en français', async () => {
  await smtp();
  const [a] = await invited({ name: 'Arts Martiaux', coachEmails: ['refuse@club.fr'] });
  failCode = { address: 'refuse@club.fr', code: 'EENVELOPE', response: '550 refused' };
  const res = await send([a!.clubId]);
  expect(res.json()[0].error).toBe('Le serveur d’envoi a refusé l’adresse (réponse du serveur : 550 refused)');
});

// --- Message mis en forme et images ---------------------------------------------------------------------------------------
const IMG_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const upload = async (data: Buffer = IMG_PNG) =>
  (await app.inject({ method: 'POST', url: '/api/mail-images', payload: data, headers: { 'content-type': 'application/octet-stream' } })).json().id as string;
const htmlMessage = (body: string) => app.inject({ method: 'PATCH', url: base, payload: { settings: { invitationMail: { subject: 'Coupe {competition}', body, format: 'html' } } } });
const linkCount = async (clubId: string) => ((await app.inject({ method: 'GET', url: `${base}/invitations/${clubId}/links` })).json() as unknown[]).length;

test('ancien message : text = corps rendu, html = textToHtml(corps), même avec a < b', async () => {
  await smtp();
  await app.inject({ method: 'PATCH', url: base, payload: { settings: { invitationMail: { subject: 'S', body: 'Si a < b, club {club} : {lien}' } } } });
  const [link] = await invited({ name: 'Tani Dojo', coachEmails: ['tani@example.org'] });
  await send([link!.clubId]);
  expect(sent[0]!.html).toBe(textToHtml(sent[0]!.text));
  expect(sent[0]!.text).toMatch(/^Si a < b, club Tani Dojo : https:/);
  expect(sent[0]!.html).toContain('a &lt; b');
});

test('message html avec une image : cid dans le html, pièce en ligne, texte sans balise, un lien par club', async () => {
  await smtp();
  const id = await upload();
  await htmlMessage(`<p>Bonjour <strong>{coach}</strong></p><img src="/api/mail-images/${id}" width="400"><p>{lien}</p>`);
  const links = await invited({ name: 'Tani Dojo', coachEmails: ['tani@example.org'] }, { name: 'Budo', coachEmails: ['budo@example.org'] });
  expect((await send(links.map((l) => l.clubId))).statusCode).toBe(200);
  expect(sent).toHaveLength(2);
  for (const m of sent) {
    expect(m.html).toContain(`cid:image-${id}@shidokan`);
    const image = m.attachments!.find((a) => a.cid === `image-${id}@shidokan`)!;
    expect(image).toMatchObject({ contentType: 'image/png', contentDisposition: 'inline' });
    expect(image.content.equals(IMG_PNG)).toBe(true);
    expect(m.text).not.toMatch(/<|>/);
    expect(m.text).toContain('Bonjour');
  }
  expect(tokenOf(sent[0]!.text)).not.toBe(tokenOf(sent[1]!.text));
  expect(sent[0]!.html).toContain(`/inscription/${tokenOf(sent[0]!.text)}`);
});

test('image absente de la base : rejet avant tout envoi, aucun lien créé', async () => {
  await smtp();
  await htmlMessage('<p>Salut</p><img src="/api/mail-images/11111111-1111-4111-8111-111111111111">');
  const [link] = await invited({ name: 'Tani Dojo', coachEmails: ['tani@example.org'] });
  const res = await send([link!.clubId]);
  expect(res.statusCode).toBe(400);
  expect(res.json().error).toContain('Image introuvable dans le message : remettez-la dans l’éditeur.');
  expect(sent).toHaveLength(0);
  expect(await linkCount(link!.clubId)).toBe(1);
});

test('mail trop lourd : rejet avant tout envoi, aucun lien créé', async () => {
  await smtp();
  const big = Buffer.concat([IMG_PNG, Buffer.alloc(MAIL_IMAGE_LIMITS.fileBytes - IMG_PNG.length)]);
  const ids: string[] = [];
  for (let i = 0; i < 9; i++) ids.push(await upload(big));
  await htmlMessage(ids.map((id) => `<img src="/api/mail-images/${id}">`).join(''));
  const [link] = await invited({ name: 'Tani Dojo', coachEmails: ['tani@example.org'] });
  const res = await send([link!.clubId]);
  expect(res.statusCode).toBe(400);
  expect(res.json().error).toMatch(/^Mail trop lourd \(.+ Mo, 18 Mo au plus\) : retirez une image ou une pièce jointe\.$/);
  expect(res.json().error).toContain(formatBytes(9 * MAIL_IMAGE_LIMITS.fileBytes));
  expect(sent).toHaveLength(0);
  expect(await linkCount(link!.clubId)).toBe(1);
});

test('messagerie : le corps est la version texte, sans balise ni image', async () => {
  const id = await upload();
  await htmlMessage(`<p>Bonjour <strong>{coach}</strong></p><img src="/api/mail-images/${id}"><p>{lien}</p>`);
  const [link] = await invited({ name: 'Tani Dojo', coachEmails: ['tani@example.org'], coachName: 'Jean' });
  const res = (await app.inject({ method: 'POST', url: `${base}/invitations/${link!.clubId}/mailto`, payload: {} })).json();
  expect(res.body).toMatch(/^Bonjour Jean\n\nhttps:\/\/competitions\.example\.org\/inscription\//);
  expect(res.body).not.toMatch(/[<>]|mail-images/);
});

test('aperçu html : garde /api/mail-images/<id> et échappe le nom du club', async () => {
  const id = await upload();
  await htmlMessage(`<p>Club {club}</p><img src="/api/mail-images/${id}">`);
  const [link] = await invited({ name: '<b>x</b>', coachEmails: ['tani@example.org'] });
  const res = (await app.inject({ method: 'GET', url: `${base}/invitations/preview?clubId=${link!.clubId}` })).json();
  expect(res.html).toContain(`/api/mail-images/${id}`);
  expect(res.html).toContain('&lt;b&gt;x&lt;/b&gt;');
  expect(res.html).not.toContain('<b>x</b>');
  expect(res.body).toContain('Club <b>x</b>');
});

/** Message arrivé sans passer par l'enregistrement (paquet de compétition, ancienne version) : écrit tel quel dans la base. */
function storeRawMessage(body: string) {
  const raw = new Database(dbPathOf);
  try {
    const id = base.split('/').pop()!;
    const row = raw.prepare('select settings_json as s from competitions where id = ?').get(id) as { s: string };
    raw.prepare('update competitions set settings_json = ? where id = ?').run(JSON.stringify({ ...(JSON.parse(row.s) as object), invitationMail: { subject: 'S', body, format: 'html' } }), id);
  } finally {
    raw.close();
  }
}

test('images d’un message stocké : c’est le corps filtré qui compte, comme pour le rendu', async () => {
  await smtp();
  const id = await upload();
  const [link] = await invited({ name: 'Tani Dojo', coachEmails: ['tani@example.org'] });

  // Adresse écrite avec une entité : le rendu la voit, la pièce doit partir avec.
  storeRawMessage(`<p>{lien}</p><img src="/api/mail-images/&#${id.charCodeAt(0)};${id.slice(1)}">`);
  expect((await send([link!.clubId])).json()).toEqual([expect.objectContaining({ status: 'sent' })]);
  expect(sent[0]!.html).toContain(`cid:image-${id}@shidokan`);
  expect(sent[0]!.attachments!.map((a) => a.cid)).toContain(`image-${id}@shidokan`);

  // Image dans un commentaire ou un script : ni refus, ni pièce.
  const ghost = '99999999-9999-4999-8999-999999999999';
  storeRawMessage(`<p>{lien}</p><!-- <img src="/api/mail-images/${ghost}"> --><script>'<img src="/api/mail-images/${ghost}">'</script>`);
  const res = await send([link!.clubId]);
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual([expect.objectContaining({ status: 'sent' })]);
  expect(sent[1]!.attachments!.filter((a) => a.cid)).toEqual([]);
});

test('aperçu : un script déjà stocké est refiltré', async () => {
  const [link] = await invited({ name: 'Tani Dojo', coachEmails: ['tani@example.org'] });
  storeRawMessage('<p>Bonjour {club}</p><script>alert(1)</script><a href="javascript:x()" onclick="x()">j</a>');
  const preview = await app.inject({ method: 'GET', url: `${base}/invitations/preview?clubId=${link!.clubId}` });
  expect(preview.statusCode).toBe(200);
  expect(preview.json().html).toContain('Bonjour Tani Dojo');
  expect(preview.json().html).not.toMatch(/script|alert|onclick|javascript/);
});

test('invité sans lien : le premier envoi crée son lien ', async () => {
  const id = (await app.inject({ method: 'POST', url: '/api/club-directory', payload: { ...EMPTY, name: 'Sans Lien', coachEmails: ['coach@sans-lien.example'] } })).json().id;
  await app.inject({ method: 'POST', url: `${base}/invitations`, payload: { directoryIds: [id] } });
  await smtp();
  const row = async () => ((await app.inject({ method: 'GET', url: `${base}/invitations` })).json() as { clubId: string; directoryClubId: string; invited: boolean; links: number }[]).find((r) => r.directoryClubId === id)!;
  expect(await row()).toMatchObject({ invited: true, links: 0 });
  expect((await send([(await row()).clubId])).json()[0]).toMatchObject({ status: 'sent' });
  expect(await row()).toMatchObject({ invited: true, links: 1 });
  expect(sent.at(-1)!.text).toMatch(/\/inscription\/[A-Za-z0-9_-]{32}/);
});
