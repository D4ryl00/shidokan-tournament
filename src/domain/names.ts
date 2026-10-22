import type { Sex } from './types.js';

function asText(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

/** Majuscules, sans accents ; espaces, tirets et apostrophes réduits à un seul espace. */
export function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[’'`\-‐–—_.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

/** « NOM PRÉNOM » (convention FFK) : sans prénom séparé, le dernier mot est le prénom. */
export function splitFullName(full: string, firstName?: string | null): { lastName: string; firstName: string } {
  const last = full.replace(/\s+/g, ' ').trim();
  const first = (firstName ?? '').replace(/\s+/g, ' ').trim();
  if (first) return { lastName: last, firstName: first };
  const words = last.split(' ');
  if (words.length < 2) return { lastName: last, firstName: '' };
  return { lastName: words.slice(0, -1).join(' '), firstName: words[words.length - 1]! };
}

export function parseYesNo(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v === 1 ? true : v === 0 ? false : null;
  const s = normalizeName(asText(v));
  if (['OUI', 'O', 'X', 'YES', 'Y', 'TRUE', 'VRAI', '1'].includes(s)) return true;
  if (['NON', 'N', 'NO', 'FALSE', 'FAUX', '0'].includes(s)) return false;
  return null;
}

export function parseSex(v: unknown): Sex | null {
  const s = normalizeName(asText(v));
  if (!s) return null;
  if (['F', 'FEM', 'FEMININ', 'FEMININE', 'FEMININES', 'FILLE', 'FEMME', 'FILLES', 'FEMMES'].includes(s)) return 'F';
  if (['M', 'H', 'MASC', 'MASCULIN', 'MASCULINS', 'GARCON', 'HOMME', 'GARCONS', 'HOMMES'].includes(s)) return 'M';
  return null;
}
