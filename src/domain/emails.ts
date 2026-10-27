import { isSingleEmail } from './mail-template.js';

// Adresses e-mail d'un club (annuaire et club de compétition) : une liste, la première étant la principale.

/** Au plus 10 adresses par club, de 160 caractères chacune. */
export const EMAIL_LIMITS = { count: 10, length: 160 } as const;

export const TOO_MANY_EMAILS = `Au plus ${EMAIL_LIMITS.count} adresses e-mail par club.`;

/** Même adresse, casse et espaces autour ignorés. */
export const sameEmail = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Une adresse que la fiche d'un club accepte. */
export const isAcceptableEmail = (v: string): boolean => {
  const t = v.trim();
  return t.length > 0 && t.length <= EMAIL_LIMITS.length && isSingleEmail(t);
};

/** Découpe un texte (case d'une fiche, champ Google) en adresses : virgule, point-virgule, espaces ou retour à la ligne. */
export const splitEmails = (text: string | null | undefined): string[] => (text ?? '').split(/[\s,;]+/).filter(Boolean);

/** Espaces retirés, vides et doublons (casse ignorée) retirés, ordre gardé. */
export function cleanEmails(list: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of list) {
    const v = raw.trim();
    if (v && !out.some((e) => sameEmail(e, v))) out.push(v);
  }
  return out;
}

/** Adresses de `extra` absentes de `list` (casse ignorée), sans dépasser la limite d'une liste. */
export function missingEmails(list: readonly string[], extra: readonly string[]): string[] {
  const added = cleanEmails(extra).filter((e) => !list.some((x) => sameEmail(x, e)));
  return added.slice(0, Math.max(0, EMAIL_LIMITS.count - list.length));
}

/** « a@x.fr, b@y.fr » : pour l'affichage et le journal des mails. */
export const joinEmails = (list: readonly string[]): string => list.join(', ');
