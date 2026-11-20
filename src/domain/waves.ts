import type { CategoryKey } from './categories.js';
import { normalizeName } from './names.js';
import type { Presence } from './replacement/types.js';
import type { CategoryGrid, DisciplineId } from './types.js';

/**
 * Vague : groupe de catégories qui se pèsent, se recasent et se lancent ensemble (« Samedi matin », « Dimanche »…).
 * La vague d'une catégorie n'est pas enregistrée : elle se déduit des règles, des tranches de ses combattants et d'un
 * éventuel choix individuel.
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

/** Rang d'une tranche dans la grille (les inconnues à la fin). */
function bandIndex(code: string, grid: CategoryGrid): number {
  const i = grid.ageBands.findIndex((b) => b.code === code);
  return i < 0 ? Number.MAX_SAFE_INTEGER : i;
}

/** Tranche la plus jeune parmi `codes`. */
function youngestBand(codes: string[], grid: CategoryGrid): string | undefined {
  return [...codes].sort((a, b) => bandIndex(a, grid) - bandIndex(b, grid))[0];
}

/** Décompte des tranches des combattants d'une catégorie : une voix par combattant. */
export type BandCounts = Record<string, number>;

/**
 * Voix des combattants d'une catégorie (recasés compris) : les absents votent tant que les sessions ne sont pas figées,
 * plus ensuite.
 */
export function bandCounts(members: { ageBandCode: string; presence: Presence }[], frozen: boolean): BandCounts {
  const counts: BandCounts = {};
  for (const m of members) if (!frozen || m.presence !== 'absent') counts[m.ageBandCode] = (counts[m.ageBandCode] ?? 0) + 1;
  return counts;
}

/** Ce qui décide de la session d'une catégorie : sa clé et les voix de ses combattants (`bandCounts`). */
type WaveSubject = { key: CategoryKey; bandCounts?: BandCounts };

/** Tranches qui ont au moins une voix. */
const votingBands = (c: WaveSubject) => Object.entries(c.bandCounts ?? {}).filter(([, n]) => n > 0);

/** La règle prend la catégorie : tranche (la plus jeune de `bands`, à défaut de la clé) et discipline acceptées ; une règle vide ne prend rien. */
export function ruleMatches(rules: WaveRules, key: CategoryKey, grid: CategoryGrid, bands?: string[]): boolean {
  if (rules.ageBandCodes.length === 0 && rules.disciplines.length === 0) return false;
  const band = youngestBand(bands && bands.length ? bands : key.ageBandCodes, grid);
  const bandOk = rules.ageBandCodes.length === 0 || (band !== undefined && rules.ageBandCodes.includes(band));
  const disciplineOk = rules.disciplines.length === 0 || rules.disciplines.includes(key.discipline);
  return bandOk && disciplineOk;
}

const byOrder = (waves: Wave[]) => [...waves].sort((a, b) => a.order - b.order);

/** Session d'une tranche pour la discipline de la clé : la première (par ordre) dont la règle la prend. */
const waveOfBand = (ordered: Wave[], key: CategoryKey, grid: CategoryGrid, band: string) => ordered.find((w) => ruleMatches(w.rules, key, grid, [band]));

/**
 * Session gagnante du vote : le plus de voix ; à égalité, la session de la tranche la plus jeune parmi les ex-aequo, puis
 * l'ordre des sessions. undefined : aucune voix (aucun combattant, ou aucune tranche prise par une session).
 */
function votedWave(c: WaveSubject, ordered: Wave[], grid: CategoryGrid): Wave | undefined {
  const tally = new Map<Wave, { votes: number; rank: number }>();
  for (const [band, n] of votingBands(c)) {
    const w = waveOfBand(ordered, c.key, grid, band);
    if (!w) continue;
    const t = tally.get(w) ?? { votes: 0, rank: Number.MAX_SAFE_INTEGER };
    tally.set(w, { votes: t.votes + n, rank: Math.min(t.rank, bandIndex(band, grid)) });
  }
  return [...tally]
    .sort(([wa, a], [wb, b]) => b.votes - a.votes || a.rank - b.rank || wa.order - wb.order)
    .map(([w]) => w)[0];
}

/** Choix qui ne bougent pas avec les combattants : valeur (`none` compris) seulement si c'est `none` ou une session existante. */
const fixedChoice = (choice: string | null | undefined, waves: Wave[]) =>
  choice === WAVE_NONE || (!!choice && waves.some((w) => w.id === choice)) ? choice : undefined;

/** Session choisie à la main ou figée : elle ne suit pas ses combattants. */
export const hasFixedWave = (c: { waveOverride: string | null; frozenWave?: string | null }, waves: Wave[]) =>
  fixedChoice(c.waveOverride, waves) !== undefined || fixedChoice(c.frozenWave, waves) !== undefined;

/**
 * Session d'une catégorie : le choix individuel (`waveOverride`), sinon la session figée (`frozenWave`), sinon aucune
 * pour un tableau libre, sinon la majorité de ses combattants, sinon (aucune voix) la tranche la plus jeune de sa clé.
 */
export function waveOfCategory(
  c: WaveSubject & { waveOverride: string | null; frozenWave?: string | null },
  waves: Wave[],
  grid: CategoryGrid,
): string | null {
  const fixed = fixedChoice(c.waveOverride, waves) ?? fixedChoice(c.frozenWave, waves);
  if (fixed !== undefined) return fixed === WAVE_NONE ? null : fixed;
  if (c.key.free !== undefined) return null;
  const ordered = byOrder(waves);
  return (votedWave(c, ordered, grid) ?? ordered.find((w) => ruleMatches(w.rules, c.key, grid)))?.id ?? null;
}

/**
 * Catégories (ni choisies à la main, ni figées) dont une tranche votante (ou, sans voix, la tranche la plus jeune de la
 * clé) est prise par plusieurs sessions : cette tranche vote pour la première.
 */
export function waveConflicts(
  cats: (WaveSubject & { id: string; waveOverride: string | null; frozenWave?: string | null })[],
  waves: Wave[],
  grid: CategoryGrid,
): { categoryId: string; waveIds: string[] }[] {
  const ordered = byOrder(waves);
  const takers = (key: CategoryKey, bands?: string[]) => ordered.filter((w) => ruleMatches(w.rules, key, grid, bands));
  return cats
    .filter((c) => c.key.free === undefined)
    .filter((c) => !hasFixedWave(c, waves))
    .map((c) => {
      const voting = votingBands(c).map(([band]) => takers(c.key, [band])).filter((ws) => ws.length > 0);
      const disputed = (voting.length > 0 ? voting : [takers(c.key)]).filter((ws) => ws.length > 1).flat();
      return { categoryId: c.id, waveIds: ordered.filter((w) => disputed.includes(w)).map((w) => w.id) };
    })
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
