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
  return text.replace(/\{([a-z_]+)\}/g, (all, name: string) => (Object.hasOwn(values, name) ? values[name as keyof MailValues] : all));
}

/** « 2026-11-22 » → « 22/11/2026 ». */
export const frenchDate = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');

/** Une seule adresse e-mail, sans séparateur de liste ni nom (le champ vient parfois d'une fiche ou de la page d'un club). */
export const isSingleEmail = (v: string) => /^[^\s@,;<>"']+@[^\s@,;<>"']+\.[^\s@,;<>"']+$/.test(v);
