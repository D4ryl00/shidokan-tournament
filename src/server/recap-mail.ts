import { GOOGLE_NOT_SENT, GOOGLE_RECONNECT, type MailTemplate } from '../domain/app-settings.js';
import { joinEmails } from '../domain/emails.js';
import { frenchDate, renderTemplate, textToHtml, type MailValues } from '../domain/mail-template.js';
import { DEFAULT_RECAP_MAIL } from '../domain/recap-mail.js';
import { clubRecapFile } from './club-recap-pdf.js';
import type { AppDb } from './db/client.js';
import { mailLog } from './db/schema.js';
import { GoogleAccessRevokedError } from './google/client.js';
import { clubOf, errorText, fromOf, imageCid, MailError, messageImages, recipientsOf, senderOf, type MailTransport, type SendResult } from './mail.js';
import { renderMailHtml } from './mail-html.js';
import { markGoogleRevoked } from './repositories/app-settings.js';
import { getCompetition } from './repositories/competitions.js';
import { NotFoundError } from './repositories/registrations.js';

/** Message du récapitulatif d'une compétition : le sien, sinon le texte de départ. */
async function recapTemplateOf(db: AppDb, competitionId: string): Promise<MailTemplate> {
  const competition = await getCompetition(db, competitionId);
  if (!competition) throw new NotFoundError('Compétition introuvable');
  return competition.settings.recapMail ?? DEFAULT_RECAP_MAIL;
}

/**
 * Message du récapitulatif d'un club, variables remplacées comme dans l'invitation ({lien} et {date_limite} n'ont pas de sens ici : vides).
 * `imageSrc` : adresse des images d'un message mis en forme (absent : leur adresse dans l'application, pour l'aperçu).
 */
export async function recapMessage(db: AppDb, competitionId: string, clubId: string, imageSrc?: (id: string) => string, template?: MailTemplate): Promise<{ subject: string; text: string; html: string }> {
  const competition = await getCompetition(db, competitionId);
  if (!competition) throw new NotFoundError('Compétition introuvable');
  const club = clubOf(db, competitionId, clubId);
  const chosen = template ?? (await recapTemplateOf(db, competitionId));
  const values: MailValues = {
    club: club.name,
    coach: club.coachName ?? 'Madame, Monsieur',
    competition: competition.name,
    date: frenchDate(competition.date),
    lieu: competition.location ?? 'lieu à préciser',
    date_limite: '',
    lien: '',
  };
  const subject = renderTemplate(chosen.subject, values);
  if (chosen.format === 'html') return { subject, ...renderMailHtml(chosen.body, values, imageSrc) };
  const text = renderTemplate(chosen.body, values);
  return { subject, text, html: textToHtml(text) };
}

/** Envoi préparé et vérifié des récapitulatifs : il ne reste qu'à l'appliquer aux clubs ; `onResult` est appelé après chaque club. */
export type RecapSending = (clubIds: string[], onResult?: (result: SendResult) => void) => Promise<SendResult[]>;

/**
 * Envoi du récapitulatif PDF de chaque club, à toutes ses adresses, un mail par club. Tout ce qui peut refuser l'envoi entier
 * (expéditeur, message et ses images, serveur d'envoi injoignable) est vérifié ici : refus → `MailError`, rien ne part. Un club sans
 * inscription ou sans adresse est sauté avec sa raison ; chaque mail parti ou refusé est noté au journal (type « recap »). Si Google
 * retire l'accès en cours de route, l'envoi s'arrête : le club en cours et les suivants sont notés « non envoyé ».
 */
export async function prepareRecaps(db: AppDb, transport: MailTransport, competitionId: string, pauseMs = 300): Promise<RecapSending> {
  const sender = senderOf(db);
  const template = await recapTemplateOf(db, competitionId);
  // Une image absente du message arrête l'envoi avant le premier mail (le poids avec le PDF est revu pour chaque club).
  await messageImages(db, template, []);
  const mailer = transport(sender);
  try {
    await mailer.verify?.();
  } catch (e) {
    if (e instanceof GoogleAccessRevokedError && sender.kind === 'google') markGoogleRevoked(db, sender.google.refreshToken);
    throw new MailError(`Envoi impossible : ${e instanceof GoogleAccessRevokedError ? GOOGLE_RECONNECT : errorText(e)}`);
  }
  const log = (clubId: string, email: string, error: string | null) =>
    db.insert(mailLog).values({ id: crypto.randomUUID(), competitionId, clubId, email, status: error ? 'error' : 'sent', error, kind: 'recap' }).run();
  return async (clubIds, onResult) => {
    const results: SendResult[] = [];
    const push = (r: SendResult) => {
      results.push(r);
      onResult?.(r);
    };
    let sentBefore = false;
    let accessRevoked = false;
    for (const clubId of clubIds) {
      let club: ReturnType<typeof clubOf>;
      try {
        club = clubOf(db, competitionId, clubId);
      } catch (e) {
        push({ clubId, clubName: 'Club inconnu', email: null, status: 'error', error: errorText(e) });
        continue;
      }
      const recipients = recipientsOf(club, undefined);
      const email = 'emails' in recipients ? joinEmails(recipients.emails) : joinEmails(club.coachEmails);
      const skip = (error: string) => push({ clubId, clubName: club.name, email: email || null, status: 'error', error });
      if (accessRevoked) {
        log(clubId, email, GOOGLE_NOT_SENT);
        skip(GOOGLE_NOT_SENT);
        continue;
      }
      let file: Awaited<ReturnType<typeof clubRecapFile>>;
      try {
        file = await clubRecapFile(db, competitionId, clubId);
      } catch (e) {
        skip(errorText(e));
        continue;
      }
      if (!file) {
        skip('Aucune inscription.');
        continue;
      }
      if ('error' in recipients) {
        skip(recipients.error);
        continue;
      }
      if (sentBefore && pauseMs) await new Promise((r) => setTimeout(r, pauseMs));
      sentBefore = true;
      let error: string | null = null;
      try {
        const pdf = { filename: file.filename, content: file.content, contentType: 'application/pdf' };
        const attachments = [...(await messageImages(db, template, [pdf])), pdf];
        const message = await recapMessage(db, competitionId, clubId, (id) => `cid:${imageCid(id)}`, template);
        await mailer.sendMail({ from: fromOf(sender), to: recipients.emails.map((address) => ({ name: club.name, address })), subject: message.subject, text: message.text, html: message.html, attachments });
      } catch (e) {
        if (e instanceof GoogleAccessRevokedError) {
          accessRevoked = true;
          if (sender.kind === 'google') markGoogleRevoked(db, sender.google.refreshToken);
          error = GOOGLE_NOT_SENT;
        } else error = errorText(e);
      }
      log(clubId, email, error);
      push({ clubId, clubName: club.name, email, status: error ? 'error' : 'sent', error });
    }
    return results;
  };
}
