import { z } from 'zod';

/** `format` absent : ancien message en texte brut ; `html` : message de l'éditeur riche. */
export interface MailTemplate {
  subject: string;
  body: string;
  format?: 'html';
}

export const MAIL_TEXT_MAX = 5000;
export const MAIL_HTML_MAX = 100_000;

export const mailTemplateSchema = z
  .object({ subject: z.string().trim().min(1).max(200), body: z.string().min(1).max(MAIL_HTML_MAX), format: z.literal('html').optional() })
  .strict()
  .refine((t) => t.format === 'html' || t.body.length <= MAIL_TEXT_MAX, { message: `Le texte ne peut pas dépasser ${MAIL_TEXT_MAX} caractères.`, path: ['body'] });

/** Deux messages disent-ils la même chose ? L'ordre de leurs clés ne compte pas ; `mail` peut venir tel quel d'une requête. */
export function sameMailTemplate(a: unknown, b: unknown): boolean {
  const key = (mail: unknown) => {
    const m = mail as Partial<MailTemplate> | null | undefined;
    return JSON.stringify(m ? [m.subject, m.body, m.format] : null);
  };
  return key(a) === key(b);
}
