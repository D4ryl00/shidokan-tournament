import nodemailer from 'nodemailer';
import { and, eq } from 'drizzle-orm';
import { currentInvitationMail, GOOGLE_NOT_CONFIGURED, GOOGLE_NOT_SENT, GOOGLE_RECONNECT, type GoogleSender, type MailTemplate, type SmtpSettings } from '../domain/app-settings.js';
import { buildClubFormPdf } from './club-form-pdf.js';
import { buildClubFormTemplate } from './club-form-template.js';
import { writeOds } from './spreadsheet/ods.js';
import { frenchDate, isSingleEmail, renderTemplate, type MailValues } from '../domain/mail-template.js';
import type { AppDb } from './db/client.js';
import { clubs, mailLog } from './db/schema.js';
import { getAppSettings, markGoogleRevoked } from './repositories/app-settings.js';
import { GoogleAccessRevokedError, type GoogleClient } from './google/client.js';
import { closedSet } from './repositories/closed-categories.js';
import { getCompetition, getGrid } from './repositories/competitions.js';
import { addInvitationLink, keepOnlyLink, regenerateInvitation, revokeLink } from './repositories/invitations.js';
import { NotFoundError } from './repositories/registrations.js';

export interface MailAddress {
  name: string;
  address: string;
}
export interface OutgoingMail {
  from: MailAddress;
  to: MailAddress;
  subject: string;
  text: string;
  attachments?: MailAttachment[];
}
export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}
/** Qui envoie : un serveur SMTP (identifiant et mot de passe) ou le compte Google connecté. */
export type MailSender = { kind: 'smtp'; smtp: SmtpSettings } | { kind: 'google'; google: GoogleSender };
/** `verify` : contrôle de la connexion au serveur d'envoi avant un envoi groupé. */
export type MailTransport = (sender: MailSender) => { verify?(): Promise<unknown>; sendMail(m: OutgoingMail): Promise<unknown> };

const smtpTransport = (smtp: SmtpSettings) =>
  nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.security === 'tls',
    requireTLS: smtp.security === 'starttls',
    auth: smtp.user ? { user: smtp.user, pass: smtp.password ?? '' } : undefined,
  });

/** Message MIME complet, construit par nodemailer sans rien envoyer. */
const mimeComposer = nodemailer.createTransport({ streamTransport: true, buffer: true });
async function mimeOf(m: OutgoingMail): Promise<Buffer> {
  return (await mimeComposer.sendMail(m)).message as Buffer;
}

/** SMTP par nodemailer ; compte Google par l'API Gmail (`google` null : Google n'est pas configuré sur ce serveur). */
export function defaultMailTransport(google: GoogleClient | null): MailTransport {
  return (sender) => {
    if (sender.kind === 'smtp') return smtpTransport(sender.smtp);
    if (!google) {
      const refuse = async () => Promise.reject(new Error(GOOGLE_NOT_CONFIGURED));
      return { verify: refuse, sendMail: refuse };
    }
    const { refreshToken } = sender.google;
    return {
      verify: () => google.accessToken(refreshToken, { force: true }),
      sendMail: async (m) => google.sendRaw(refreshToken, await mimeOf(m)),
    };
  };
}

export interface SendResult {
  clubId: string;
  clubName: string;
  email: string | null;
  status: 'sent' | 'error';
  error: string | null;
}

class MailError extends Error {
  readonly statusCode = 400;
}

/** Expéditeur du mode choisi, ou refus clair s'il manque (ou si Google demande de se reconnecter). */
function senderOf(db: AppDb): MailSender {
  const { mailMode, smtp, google } = getAppSettings(db);
  if (mailMode === 'google' && google) {
    if (google.status === 'reconnect') throw new MailError(GOOGLE_RECONNECT);
    return { kind: 'google', google };
  }
  if (!smtp) throw new MailError('Réglez l’envoi des mails dans les Réglages de l’application.');
  return { kind: 'smtp', smtp };
}
// Adresses passées en objets à nodemailer : ni le nom ni l'adresse ne peuvent ajouter d'autres destinataires.
const fromOf = (sender: MailSender): MailAddress =>
  sender.kind === 'google' ? { name: sender.google.fromName, address: sender.google.email } : { name: sender.smtp.fromName, address: sender.smtp.fromEmail };

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 500);

function clubOf(db: AppDb, competitionId: string, clubId: string) {
  const club = db.select().from(clubs).where(and(eq(clubs.id, clubId), eq(clubs.competitionId, competitionId))).get();
  if (!club) throw new NotFoundError('Club introuvable');
  return club;
}

/** Message d'invitation d'un club : celui de la compétition, sinon celui de l'application ; `link` remplace {lien}. */
export async function invitationMessage(db: AppDb, competitionId: string, clubId: string, link: string): Promise<MailTemplate> {
  const competition = await getCompetition(db, competitionId);
  if (!competition) throw new NotFoundError('Compétition introuvable');
  const club = clubOf(db, competitionId, clubId);
  const template = competition.settings.invitationMail ? currentInvitationMail(competition.settings.invitationMail) : getAppSettings(db).invitationMail;
  const row = db.$client.prepare('select club_entry_deadline as d from competitions where id = ?').get(competitionId) as { d: string | null };
  const values: MailValues = {
    club: club.name,
    coach: club.coachName ?? 'Madame, Monsieur',
    competition: competition.name,
    date: frenchDate(competition.date),
    lieu: competition.location ?? 'lieu à préciser',
    date_limite: row.d ? frenchDate(row.d) : 'non précisée',
    lien: link,
  };
  return { subject: renderTemplate(template.subject, values), body: renderTemplate(template.body, values) };
}

/** Fiches d'inscription jointes au mail : la fiche à imprimer (PDF) et le tableur (.ods), les mêmes que dans l'onglet Fiche club. */
export async function clubFormAttachments(db: AppDb, competitionId: string): Promise<MailAttachment[]> {
  const competition = await getCompetition(db, competitionId);
  if (!competition) throw new NotFoundError('Compétition introuvable');
  const grid = await getGrid(db, competitionId);
  const closed = closedSet(db, competitionId);
  return [
    { filename: `fiche-club-${competition.date}.pdf`, content: await buildClubFormPdf(competition, grid, closed), contentType: 'application/pdf' },
    { filename: `fiche-club-${competition.date}.ods`, content: await writeOds(buildClubFormTemplate(competition, grid, closed)), contentType: 'application/vnd.oasis.opendocument.spreadsheet' },
  ];
}

export const linkUrl = (baseUrl: string, token: string) => `${baseUrl.replace(/\/+$/, '')}/inscription/${token}`;

/**
 * Envoie le lien de chaque club par mail. Le serveur d'envoi est vérifié d'abord : s'il ne répond pas, rien n'est envoyé et aucun
 * lien ne change. Pour chaque club, un nouveau lien est créé ; l'ancien n'est désactivé que si le mail part (sinon c'est le nouveau
 * qui est désactivé). Chaque envoi est noté ; une erreur ne concerne que son club. Si Google retire l'accès en cours de route, l'envoi
 * s'arrête : le club en cours et les suivants sont notés « non envoyé », sans nouveau lien.
 */
export async function sendInvitations(db: AppDb, transport: MailTransport, competitionId: string, clubIds: string[], baseUrl: string, pauseMs = 300): Promise<SendResult[]> {
  const sender = senderOf(db);
  const mailer = transport(sender);
  try {
    await mailer.verify?.();
  } catch (e) {
    if (e instanceof GoogleAccessRevokedError) markGoogleRevoked(db);
    throw new MailError(`Envoi impossible, aucun lien n’a changé : ${e instanceof GoogleAccessRevokedError ? GOOGLE_RECONNECT : errorText(e)}`);
  }
  // Les mêmes fiches pour chaque club : préparées une fois, avant le premier envoi.
  const attachments = await clubFormAttachments(db, competitionId);
  const results: SendResult[] = [];
  let sentBefore = false;
  let accessRevoked = false;
  for (const clubId of clubIds) {
    let club: ReturnType<typeof clubOf>;
    try {
      club = clubOf(db, competitionId, clubId);
    } catch (e) {
      results.push({ clubId, clubName: 'Club inconnu', email: null, status: 'error', error: errorText(e) });
      continue;
    }
    const email = club.coachEmail?.trim() ?? '';
    if (accessRevoked) {
      db.insert(mailLog).values({ id: crypto.randomUUID(), competitionId, clubId, email, status: 'error', error: GOOGLE_NOT_SENT }).run();
      results.push({ clubId, clubName: club.name, email: club.coachEmail, status: 'error', error: GOOGLE_NOT_SENT });
      continue;
    }
    if (!email || !isSingleEmail(email)) {
      results.push({ clubId, clubName: club.name, email: club.coachEmail, status: 'error', error: email ? 'Adresse e-mail invalide pour ce club.' : 'Pas d’e-mail pour ce club.' });
      continue;
    }
    if (sentBefore && pauseMs) await new Promise((r) => setTimeout(r, pauseMs));
    sentBefore = true;
    const link = addInvitationLink(db, competitionId, clubId);
    let error: string | null = null;
    try {
      const message = await invitationMessage(db, competitionId, clubId, linkUrl(baseUrl, link.token));
      await mailer.sendMail({ from: fromOf(sender), to: { name: club.name, address: email }, subject: message.subject, text: message.body, attachments });
      keepOnlyLink(db, competitionId, clubId, link.token);
    } catch (e) {
      revokeLink(db, link.token);
      if (e instanceof GoogleAccessRevokedError) {
        accessRevoked = true;
        markGoogleRevoked(db);
        error = GOOGLE_NOT_SENT;
      } else error = errorText(e);
    }
    db.insert(mailLog).values({ id: crypto.randomUUID(), competitionId, clubId, email, status: error ? 'error' : 'sent', error }).run();
    results.push({ clubId, clubName: club.name, email, status: error ? 'error' : 'sent', error });
  }
  return results;
}

/** Message tout prêt pour la messagerie de l'organisateur (lien `mailto:`), avec un nouveau lien. */
export async function mailtoInvitation(db: AppDb, competitionId: string, clubId: string, baseUrl: string): Promise<{ to: string | null; subject: string; body: string }> {
  const club = clubOf(db, competitionId, clubId);
  const link = regenerateInvitation(db, competitionId, clubId);
  const message = await invitationMessage(db, competitionId, clubId, linkUrl(baseUrl, link.token));
  return { to: club.coachEmail, subject: message.subject, body: message.body };
}

export async function sendTestMail(db: AppDb, transport: MailTransport, to: string): Promise<void> {
  const sender = senderOf(db);
  try {
    await transport(sender).sendMail({ from: fromOf(sender), to: { name: to, address: to }, subject: 'Mail d’essai — Shidokan France', text: 'Les réglages d’envoi des mails fonctionnent.' });
  } catch (e) {
    if (e instanceof GoogleAccessRevokedError) {
      markGoogleRevoked(db);
      throw new MailError(GOOGLE_RECONNECT);
    }
    throw new MailError(errorText(e));
  }
}
