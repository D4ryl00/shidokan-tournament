import { z } from 'zod';
import { EMAIL_LIMITS, TOO_MANY_EMAILS, cleanEmails, isAcceptableEmail } from '../../domain/emails.js';

/** Adresses e-mail d'un club : une adresse valide par élément ; espaces, vides et doublons retirés. L'erreur cite l'adresse refusée. */
export const emailList = z
  .array(z.string().max(1000))
  .transform(cleanEmails)
  .superRefine((list, ctx) => {
    const invalid = list.filter((e) => !isAcceptableEmail(e));
    if (invalid.length) ctx.addIssue({ code: 'custom', message: `${invalid.length > 1 ? 'Adresses e-mail invalides' : 'Adresse e-mail invalide'} : ${invalid.join(', ')}` });
    else if (list.length > EMAIL_LIMITS.count) ctx.addIssue({ code: 'custom', message: TOO_MANY_EMAILS });
  });
