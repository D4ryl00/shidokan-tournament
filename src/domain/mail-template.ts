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

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Version HTML d'un message texte : un paragraphe par bloc (séparé par une ligne vide), retours à la ligne gardés, liens cliquables.
 * Jointe au texte brut parce que Gmail recoupe celui-ci à ~76 caractères à l'envoi ; les messageries affichent la version HTML.
 */
export function textToHtml(text: string): string {
  const line = (l: string) => escapeHtml(l).replace(/https?:\/\/[^\s<>"]*[^\s<>".,;:!?)»]/g, (url) => `<a href="${url}">${url}</a>`);
  return text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).map((p) => `<p>${p.split('\n').map(line).join('<br>\n')}</p>`).join('\n');
}

/** Corps d'un message en HTML : le format html tel quel ; un ancien texte est converti, jamais lu comme du HTML. */
export function mailBodyToHtml(t: { body: string; format?: 'html' }): string {
  return t.format === 'html' ? t.body : textToHtml(t.body);
}

/** Adresse de lien permise : http, https, mailto, ou la variable `{lien}` seule. La même règle vaut dans l'éditeur et dans le filtre du serveur. */
export const mailLinkAllowed = (href: string): boolean => /^(https?:\/\/|mailto:)/i.test(href) || href === '{lien}';

const BARE_EMAIL = /^[^\s@:/,;<>"']+@[^\s@:/,;<>"']+\.[^\s@:/,;<>"']+$/;

/** Adresse telle qu'on l'écrit dans la fenêtre de lien : `www.…` devient `https://www.…`, `x@y.fr` devient `mailto:x@y.fr`. Le reste ne change pas. */
export function normalizeMailLink(href: string): string {
  const h = href.trim();
  if (/^www\./i.test(h)) return `https://${h}`;
  return BARE_EMAIL.test(h) ? `mailto:${h}` : h;
}

/** « 2026-11-22 » → « 22/11/2026 ». */
export const frenchDate = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');

/** Une seule adresse e-mail, sans séparateur de liste ni nom (le champ vient parfois d'une fiche ou de la page d'un club). */
export const isSingleEmail = (v: string) => /^[^\s@,;<>"']+@[^\s@,;<>"']+\.[^\s@,;<>"']+$/.test(v);
