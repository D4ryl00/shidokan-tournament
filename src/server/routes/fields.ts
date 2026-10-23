import { z } from 'zod';
import { isSingleEmail } from '../../domain/mail-template.js';

/** Champ e-mail facultatif : une seule adresse ; vide → null. */
export const optionalEmail = z
  .string()
  .trim()
  .max(160)
  .refine((v) => v === '' || isSingleEmail(v), 'Adresse e-mail invalide (une seule adresse).')
  .transform((v) => v || null)
  .nullable();
