import { z } from 'zod';

/** Réglages de l'application (pas d'une compétition) : envoi des mails, mention sur les données, conservation, message aux clubs. */
export interface SmtpSettings {
  host: string;
  port: number;
  security: 'tls' | 'starttls' | 'none';
  user: string;
  password: string | null;
  fromName: string;
  fromEmail: string;
}
export interface MailTemplate {
  subject: string;
  body: string;
}
export interface AppSettings {
  smtp: SmtpSettings | null;
  /** Mention affichée sur la page du club ; `{contact}` est remplacé par l'adresse de contact. */
  privacyNotice: string;
  privacyContact: string;
  retentionMonths: number;
  directoryInactiveYears: number;
  invitationMail: MailTemplate;
}
export type PublicSmtpSettings = Omit<SmtpSettings, 'password'> & { hasPassword: boolean };
export type PublicAppSettings = Omit<AppSettings, 'smtp'> & { smtp: PublicSmtpSettings | null };

export const DEFAULT_INVITATION_MAIL: MailTemplate = {
  subject: 'Inscriptions — {competition}',
  body: [
    'Bonjour {coach},',
    '',
    'Les inscriptions à la compétition « {competition} » ({date}, {lieu}) sont ouvertes.',
    "Inscrivez les combattants de {club} sur cette page, et revenez-y pour les modifier jusqu'au {date_limite} :",
    '{lien}',
    '',
    'Ce lien est personnel à votre club : ne le transmettez pas.',
    '',
    'Vous pouvez aussi inscrire vos élèves avec les fiches jointes à ce mail : la fiche à imprimer (PDF), à remplir à la main, ou le tableur (.ods, qui s’ouvre avec Excel ou LibreOffice), à remplir sur l’ordinateur. Renvoyez-la-nous en réponse à ce mail avant le {date_limite}.',
    '',
    'Sportivement,',
    'Shidokan France',
  ].join('\n'),
};

/** Anciens messages par défaut : un message enregistré tel quel (sans retouche) suit le message par défaut actuel. */
const PREVIOUS_DEFAULT_INVITATION_MAILS: MailTemplate[] = [
  {
    subject: 'Inscriptions — {competition}',
    body: [
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
    ].join('\n'),
  },
];
export const currentInvitationMail = (t: MailTemplate): MailTemplate =>
  PREVIOUS_DEFAULT_INVITATION_MAILS.some((p) => p.subject === t.subject && p.body === t.body) ? DEFAULT_INVITATION_MAIL : t;

export const DEFAULT_APP_SETTINGS: AppSettings = {
  smtp: null,
  privacyNotice:
    'Les informations saisies sur cette page sont traitées par Shidokan France pour organiser la compétition (inscriptions, catégories, tableaux). Le poids, le grade et les coordonnées du coach sont effacés 13 mois après la compétition ; les résultats (nom, club, catégorie, classement) sont conservés comme archive sportive. Pour toute question, ou pour exercer vos droits sur ces données : {contact}.',
  privacyContact: '',
  retentionMonths: 13,
  directoryInactiveYears: 3,
  invitationMail: DEFAULT_INVITATION_MAIL,
};

const template = z.object({ subject: z.string().trim().min(1).max(200), body: z.string().min(1).max(5000) }).strict();
export const mailTemplateSchema = template;

/** Modification des réglages : `smtp.password` null = inchangé, '' = effacé. */
export const appSettingsPatchSchema = z
  .object({
    smtp: z
      .object({
        host: z.string().trim().min(1).max(200),
        port: z.number().int().min(1).max(65535),
        security: z.enum(['tls', 'starttls', 'none']),
        user: z.string().trim().max(200),
        password: z.string().max(500).nullable(),
        fromName: z.string().trim().max(120),
        fromEmail: z.string().trim().email().max(200),
      })
      .strict()
      .nullable(),
    privacyNotice: z.string().trim().min(1).max(3000),
    privacyContact: z.string().trim().max(200),
    retentionMonths: z.number().int().min(1).max(240),
    directoryInactiveYears: z.number().int().min(1).max(50),
    invitationMail: template,
  })
  .partial()
  .strict();
export type AppSettingsPatch = z.infer<typeof appSettingsPatchSchema>;

/** Mention rendue : sans adresse de contact, la phrase de contact est retirée. */
export function renderPrivacyNotice(s: Pick<AppSettings, 'privacyNotice' | 'privacyContact'>): string {
  if (s.privacyContact.trim()) return s.privacyNotice.replaceAll('{contact}', s.privacyContact.trim());
  return s.privacyNotice
    .split(/(?<=\.)\s+/)
    .filter((sentence) => !sentence.includes('{contact}'))
    .join(' ');
}
