import type { CategoryKey } from './categories.js';
import { normalizeName } from './names.js';
import type { CategoryGrid, DisciplineId } from './types.js';

/**
 * Vague : groupe de catégories qui se pèsent, se recasent et se lancent ensemble (« Samedi matin », « Dimanche »…).
 * La vague d'une catégorie n'est pas enregistrée : elle se déduit des règles et d'un éventuel choix individuel.
 */
export interface WaveRules {
  ageBandCodes: string[];
  disciplines: DisciplineId[];
}
export interface Wave {
  id: string;
  name: string;
  order: number;
  rules: WaveRules;
  weighInClosed: boolean;
}
export interface WaveInput {
  id?: string;
  name: string;
  rules: WaveRules;
}

/** Choix individuel « en attente » : la catégorie n'est dans aucune vague, quelles que soient les règles. */
export const WAVE_NONE = 'none';
export const WAVE_MAX = 20;
export const WAVE_NAME_MAX = 40;

/** Tranche la plus jeune parmi `codes`. */
function youngestBand(codes: string[], grid: CategoryGrid): string | undefined {
  const index = (code: string) => {
    const i = grid.ageBands.findIndex((b) => b.code === code);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  return [...codes].sort((a, b) => index(a) - index(b))[0];
}

/**
 * Tranches qui décident de la vague : celles des combattants d'origine de la catégorie (`waveBands`, sans les recasés),
 * pour qu'une catégorie d'arrivée garde sa vague ; à défaut, celles de sa clé.
 */
type WaveSubject = { key: CategoryKey; waveBands?: string[] };
const bandsOf = (c: WaveSubject) => (c.waveBands && c.waveBands.length ? c.waveBands : c.key.ageBandCodes);

/** La règle prend la catégorie : tranche et discipline acceptées ; une règle vide ne prend rien. */
export function ruleMatches(rules: WaveRules, key: CategoryKey, grid: CategoryGrid, waveBands?: string[]): boolean {
  if (rules.ageBandCodes.length === 0 && rules.disciplines.length === 0) return false;
  const band = youngestBand(bandsOf({ key, waveBands }), grid);
  const bandOk = rules.ageBandCodes.length === 0 || (band !== undefined && rules.ageBandCodes.includes(band));
  const disciplineOk = rules.disciplines.length === 0 || rules.disciplines.includes(key.discipline);
  return bandOk && disciplineOk;
}

const byOrder = (waves: Wave[]) => [...waves].sort((a, b) => a.order - b.order);

/** Vague d'une catégorie : choix individuel, sinon la première vague dont la règle la prend, sinon aucune (en attente). */
export function waveOfCategory(c: WaveSubject & { waveOverride: string | null }, waves: Wave[], grid: CategoryGrid): string | null {
  if (c.waveOverride === WAVE_NONE) return null;
  if (c.waveOverride && waves.some((w) => w.id === c.waveOverride)) return c.waveOverride;
  return byOrder(waves).find((w) => ruleMatches(w.rules, c.key, grid, c.waveBands))?.id ?? null;
}

/** Catégories (sans choix individuel) prises par les règles de plusieurs vagues : elles vont dans la première. */
export function waveConflicts(
  cats: (WaveSubject & { id: string; waveOverride: string | null })[],
  waves: Wave[],
  grid: CategoryGrid,
): { categoryId: string; waveIds: string[] }[] {
  const ordered = byOrder(waves);
  return cats
    .filter((c) => !c.waveOverride || (c.waveOverride !== WAVE_NONE && !waves.some((w) => w.id === c.waveOverride)))
    .map((c) => ({ categoryId: c.id, waveIds: ordered.filter((w) => ruleMatches(w.rules, c.key, grid, c.waveBands)).map((w) => w.id) }))
    .filter((x) => x.waveIds.length > 1);
}

export function validateWaves(input: WaveInput[]): string[] {
  if (input.length > WAVE_MAX) return [`Pas plus de ${WAVE_MAX} sessions.`];
  const errors: string[] = [];
  const ids = input.map((w) => w.id).filter(Boolean);
  if (new Set(ids).size !== ids.length) errors.push('La même session apparaît deux fois dans la liste.');
  const seen = new Map<string, string>();
  for (const w of input) {
    const name = w.name.trim();
    if (!name) {
      errors.push('Une session n’a pas de nom.');
      continue;
    }
    if (name.length > WAVE_NAME_MAX) errors.push(`Nom de session trop long (${WAVE_NAME_MAX} caractères au plus) : « ${name} ».`);
    const key = normalizeName(name);
    if (seen.has(key)) errors.push(`Deux sessions portent le même nom : « ${seen.get(key)} ».`);
    else seen.set(key, name);
  }
  return errors;
}
