import nodemailer from 'nodemailer';
import { and, eq } from 'drizzle-orm';
import type { MailTemplate, SmtpSettings } from '../domain/app-settings.js';
import { frenchDate, renderTemplate, type MailValues } from '../domain/mail-template.js';
import type { AppDb } from './db/client.js';
import { clubs, mailLog } from './db/schema.js';
import { getAppSettings } from './repositories/app-settings.js';
import { getCompetition } from './repositories/competitions.js';
import { regenerateInvitation } from './repositories/invitations.js';
import { NotFoundError } from './repositories/registrations.js';

export interface OutgoingMail {
  from: string;
  to: string;
  subject: string;
  text: string;
}
export type MailTransport = (smtp: SmtpSettings) => { sendMail(m: OutgoingMail): Promise<unknown> };

export const nodemailerTransport: MailTransport = (smtp) =>
  nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.security === 'tls',
    requireTLS: smtp.security === 'starttls',
    auth: smtp.user ? { user: smtp.user, pass: smtp.password ?? '' } : undefined,
  });

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

/** Réglages d'envoi, ou refus clair s'ils manquent. */
function smtpOf(db: AppDb): SmtpSettings {
  const smtp = getAppSettings(db).smtp;
  if (!smtp) throw new MailError('Réglez l’envoi des mails dans les Réglages de l’application.');
  return smtp;
}
const fromOf = (smtp: SmtpSettings) => `"${smtp.fromName.replace(/"/g, "'")}" <${smtp.fromEmail}>`;
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
  const template = competition.settings.invitationMail ?? getAppSettings(db).invitationMail;
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

export const linkUrl = (baseUrl: string, token: string) => `${baseUrl.replace(/\/+$/, '')}/inscription/${token}`;

/** Envoie le lien de chaque club par mail : un nouveau lien par envoi (l'ancien ne fonctionne plus), chaque envoi noté. */
export async function sendInvitations(db: AppDb, transport: MailTransport, competitionId: string, clubIds: string[], baseUrl: string, pauseMs = 300): Promise<SendResult[]> {
  const smtp = smtpOf(db);
  const mailer = transport(smtp);
  const results: SendResult[] = [];
  for (const [i, clubId] of clubIds.entries()) {
    const club = clubOf(db, competitionId, clubId);
    if (!club.coachEmail) {
      results.push({ clubId, clubName: club.name, email: null, status: 'error', error: 'Pas d’e-mail pour ce club.' });
      continue;
    }
    if (i > 0 && pauseMs) await new Promise((r) => setTimeout(r, pauseMs));
    const link = regenerateInvitation(db, competitionId, clubId);
    const message = await invitationMessage(db, competitionId, clubId, linkUrl(baseUrl, link.token));
    let error: string | null = null;
    try {
      await mailer.sendMail({ from: fromOf(smtp), to: club.coachEmail, subject: message.subject, text: message.body });
    } catch (e) {
      error = errorText(e);
    }
    db.insert(mailLog).values({ id: crypto.randomUUID(), competitionId, clubId, email: club.coachEmail, status: error ? 'error' : 'sent', error }).run();
    results.push({ clubId, clubName: club.name, email: club.coachEmail, status: error ? 'error' : 'sent', error });
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
  const smtp = smtpOf(db);
  try {
    await transport(smtp).sendMail({ from: fromOf(smtp), to, subject: 'Mail d’essai — Shidokan France', text: 'Les réglages d’envoi des mails fonctionnent.' });
  } catch (e) {
    throw new MailError(errorText(e));
  }
}
