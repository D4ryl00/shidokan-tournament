/** Valeurs des variables d'un message aux clubs. */
export interface MailValues {
  club: string;
  coach: string;
  competition: string;
  date: string;
  lieu: string;
  date_limite: string;
  lien: string;
}

/** Remplace `{club}`, `{coach}`… ; une variable inconnue reste telle quelle. */
export function renderTemplate(text: string, values: MailValues): string {
  return text.replace(/\{([a-z_]+)\}/g, (all, name: string) => (name in values ? values[name as keyof MailValues] : all));
}

/** « 2026-11-22 » → « 22/11/2026 ». */
export const frenchDate = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');
