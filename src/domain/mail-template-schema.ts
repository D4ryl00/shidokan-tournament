import { z } from 'zod';

export interface MailTemplate {
  subject: string;
  body: string;
}

export const mailTemplateSchema = z.object({ subject: z.string().trim().min(1).max(200), body: z.string().min(1).max(5000) }).strict();
