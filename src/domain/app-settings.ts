import { z } from 'zod';
import { mailTemplateSchema, type MailTemplate } from './mail-template-schema.js';
import { rulesView, rulesViewSchema, type RulesView } from './replacement/rules.js';
import { defaultSettings } from './settings.js';

export { mailTemplateSchema, type MailTemplate };

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
/** Envoi par un serveur SMTP (identifiant et mot de passe) ou par un compte Google (API Gmail, droit d'envoyer seulement). */
export type MailMode = 'smtp' | 'google';
/** Compte Google connecté : `status` passe à `reconnect` quand Google a retiré l'accès. */
export interface GoogleSender {
  email: string;
  fromName: string;
  refreshToken: string;
  status: 'ok' | 'reconnect';
  lastRefreshAt: string | null;
  /** Droits accordés par Google à la connexion ; absent = connexion d'avant la synchronisation des contacts (envoi seulement). */
  scopes?: string[];
}
export const CONTACTS_SCOPE = 'https://www.googleapis.com/auth/contacts.readonly';
export const hasContactsScope = (g: { scopes?: string[] } | null): boolean => !!g?.scopes?.includes(CONTACTS_SCOPE);
/** Synchronisation des contacts : compte pour lequel les liens ont été faits, libellé choisi, contacts mis « plus tard ». */
export interface GoogleContactsState {
  account: string | null;
  label: string | null;
  pending: string[];
}
export interface AppSettings {
  smtp: SmtpSettings | null;
  mailMode: MailMode;
  google: GoogleSender | null;
  googleContacts: GoogleContactsState;
  /** Mention affichée sur la page du club ; `{contact}` est remplacé par l'adresse de contact. */
  privacyNotice: string;
  privacyContact: string;
  retentionMonths: number;
  directoryInactiveYears: number;
  invitationMail: MailTemplate;
  /** Liste des règles de réaffectation copiée dans chaque nouvelle compétition. */
  defaultReplacementRules: RulesView;
}
export type PublicSmtpSettings = Omit<SmtpSettings, 'password'> & { hasPassword: boolean };
export type PublicGoogleSender = Omit<GoogleSender, 'refreshToken'>;
export type PublicAppSettings = Omit<AppSettings, 'smtp' | 'google' | 'googleContacts'> & { smtp: PublicSmtpSettings | null; google: PublicGoogleSender | null; googleAvailable: boolean };

export const GOOGLE_RECONNECT = 'L’accès au compte Google a été retiré ou a expiré. Reconnectez-vous dans les Réglages de l’application.';
export const GOOGLE_NOT_CONFIGURED = 'Le compte Google n’est plus configuré sur le serveur (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).';
export const GOOGLE_NOT_SENT = 'Non envoyé : accès au compte Google retiré. Reconnectez-vous, puis relancez l’envoi pour ce club.';
export const GOOGLE_CONNECT_FIRST = 'Connectez d’abord un compte Google.';

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
  mailMode: 'smtp',
  google: null,
  googleContacts: { account: null, label: null, pending: [] },
  privacyNotice:
    'Les informations saisies sur cette page sont traitées par Shidokan France pour organiser la compétition (inscriptions, catégories, tableaux). Le poids, le grade et les coordonnées du coach sont effacés 13 mois après la compétition ; les résultats (nom, club, catégorie, classement) sont conservés comme archive sportive. Pour toute question, ou pour exercer vos droits sur ces données : {contact}.',
  privacyContact: '',
  retentionMonths: 13,
  directoryInactiveYears: 3,
  invitationMail: DEFAULT_INVITATION_MAIL,
  defaultReplacementRules: rulesView(defaultSettings()),
};

const template = mailTemplateSchema;

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
    mailMode: z.enum(['smtp', 'google']),
    /** Nom de l'expéditeur du compte Google connecté. */
    googleFromName: z.string().trim().min(1).max(120),
    privacyNotice: z.string().trim().min(1).max(3000),
    privacyContact: z.string().trim().max(200),
    retentionMonths: z.number().int().min(1).max(240),
    directoryInactiveYears: z.number().int().min(1).max(50),
    invitationMail: template,
    defaultReplacementRules: rulesViewSchema,
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
