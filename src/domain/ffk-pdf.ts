import { normalizeName } from './names.js';
import type { Sex } from './types.js';

/** Une ligne de texte du PDF (structurellement égale à `PdfTextLine` du serveur). */
export interface FfkTextLine {
  page: number;
  y: number;
  items: { x: number; text: string }[];
}

export interface FfkCategoryTitle {
  sex: Sex;
  ageLabel: string;
  weightLabel: string | null;
  rulesetLabel: string | null;
}

export interface FfkPdfEntry {
  order: number;
  fullName: string;
  category: string;
  title: FfkCategoryTitle;
}

const TITLE_RE = /^(.+?)\s+(masculin|f[ée]minine?)\s*(?:([+-])\s*(\d+(?:[.,]\d+)?)\s*kg)?\s*$/i;
const LICENCE_RE = /^\d{6,}[A-Z]$/;
const FOOTER_RE = /^\d{2}\/\d{2}\/\d{4}/;
/** Au-delà de cet x, on est dans la colonne « Rattachement ». */
const ATTACHMENT_X = 500;

const squeeze = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Lit un titre de catégorie FFK (texte brut : le signe du poids compte). */
export function parseFfkCategory(title: string): FfkCategoryTitle | null {
  const spaced = squeeze(
    title
      .replace(/(\p{L})(\d)/gu, '$1 $2')
      .replace(/([\p{L}\d])([+-]\s*\d)/gu, '$1 $2'),
  );
  const m = TITLE_RE.exec(spaced);
  if (!m) return null;
  let prefix = m[1]!;
  const rulesetMatch = /\b(jiyu|shobu)\b/i.exec(prefix);
  const rulesetLabel = rulesetMatch ? rulesetMatch[1]!.toLowerCase() : null;
  if (rulesetMatch) {
    prefix = prefix.replace(/\b(jiyu|shobu)\b/i, ' ').replace(/\bippon\s+kumit[eé](?!\p{L})/iu, ' ');
  }
  const ageLabel = squeeze(prefix);
  if (!ageLabel) return null;
  return {
    sex: m[2]!.toLowerCase().startsWith('m') ? 'M' : 'F',
    ageLabel,
    weightLabel: m[3] ? `${m[3]}${m[4]!.replace(',', '.')}` : null,
    rulesetLabel,
  };
}

function fighterName(items: { x: number; text: string }[]): string {
  const parts: string[] = [];
  for (const it of items.slice(1)) {
    if (it.x >= ATTACHMENT_X) break;
    parts.push(it.text);
  }
  const joined = squeeze(parts.join(' '));
  const cut = joined.search(/\bLIGUE\b/i);
  return squeeze(cut >= 0 ? joined.slice(0, cut) : joined);
}

/** Lit les combattants et leur catégorie ; la catégorie courante se prolonge d’une page à l’autre. */
export function parseFfkPdfLines(lines: FfkTextLine[]): { entries: FfkPdfEntry[]; duplicates: string[] } {
  const entries: FfkPdfEntry[] = [];
  const duplicates: string[] = [];
  const seen = new Set<string>();
  let current: { category: string; title: FfkCategoryTitle } | null = null;
  for (const l of lines) {
    const first = l.items[0];
    if (!first) continue;
    if (LICENCE_RE.test(first.text.trim())) {
      if (!current) continue;
      const fullName = fighterName(l.items);
      if (!fullName) continue;
      const key = `${current.title.sex}|${normalizeName(fullName)}`;
      if (seen.has(key)) {
        duplicates.push(fullName);
        continue;
      }
      seen.add(key);
      entries.push({ order: entries.length, fullName, category: current.category, title: current.title });
      continue;
    }
    const text = squeeze(l.items.map((i) => i.text).join(' '));
    if (FOOTER_RE.test(text)) continue;
    const title = parseFfkCategory(text);
    if (title) current = { category: text, title };
  }
  return { entries, duplicates };
}
