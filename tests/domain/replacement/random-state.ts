import { seededRandom } from '../../../src/domain/brackets/seeding.js';
import { naturalKey, keyString } from '../../../src/domain/categories.js';
import { weightClassesFor } from '../../../src/domain/grid.js';
import { ffkDefaultGrid } from '../../../src/domain/grid-ffk.js';
import type { Member, State } from '../../../src/domain/replacement/types.js';
import type { DisciplineId, Ruleset, Sex } from '../../../src/domain/types.js';
import { makeState, member } from './fixtures.js';

const BANDS = ['benjamin', 'minime', 'cadet', 'junior', 'senior', 'v1'];
const DISCIPLINES: DisciplineId[] = ['karate', 'shido-boxing', 'shido-mix'];

/**
 * État réaliste et reproductible : 3 disciplines, 6 tranches, 2 sexes, des poids dans leur catégorie, des préférences
 * de discipline, quelques absents et quelques pesées hors catégorie ; environ une inscription sur quatre seule.
 */
export function randomState(seed: number, size: number): State {
  const rnd = seededRandom(seed);
  const grid = ffkDefaultGrid();
  const keys: { band: string; sex: Sex; discipline: DisciplineId; ruleset: Ruleset; wc: string; low: number; high: number; weight: number }[] = [];
  for (const discipline of DISCIPLINES) {
    for (const band of BANDS) {
      const adult = !grid.ageBands.find((b) => b.code === band)!.isMinor;
      for (const sex of ['F', 'M'] as Sex[]) {
        const wcs = weightClassesFor(grid, band, sex);
        wcs.forEach((wc, i) => {
          const low = i === 0 ? (wc.maxKg ?? 40) - 6 : wcs[i - 1]!.maxKg!;
          const high = wc.maxKg ?? low + 10;
          for (const ruleset of adult ? (['jiyu', 'shobu'] as Ruleset[]) : (['jiyu'] as Ruleset[])) {
            // Popularité inégale : certaines catégories sont rares (combattants seuls), d'autres pleines.
            keys.push({ band, sex, discipline, ruleset, wc: wc.id, low, high, weight: (ruleset === 'shobu' ? 0.3 : 1) * (0.5 + rnd()) });
          }
        });
      }
    }
  }
  // Autant de catégories que d'inscriptions / 2,6 (au plus toutes) : la part des seuls ne dépend pas de la taille.
  for (let i = keys.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [keys[i], keys[j]] = [keys[j]!, keys[i]!];
  }
  keys.splice(Math.max(4, Math.round(size / 1.4)));
  const total = keys.reduce((n, k) => n + k.weight, 0);
  const pick = () => {
    let x = rnd() * total;
    for (const k of keys) if ((x -= k.weight) <= 0) return k;
    return keys[keys.length - 1]!;
  };
  const members: Member[] = [];
  for (let i = 0; i < size; i++) {
    const k = pick();
    const kg = Math.round((k.low + 0.2 + rnd() * (k.high - k.low - 0.2)) * 10) / 10;
    const others = rnd() < 0.3 ? DISCIPLINES.filter((d) => d !== k.discipline && rnd() < 0.6) : [];
    const weighed = rnd() < 0.15;
    members.push(member({
      label: `R${String(i).padStart(3, '0')}`,
      sex: k.sex, ageBandCode: k.band, discipline: k.discipline, ruleset: k.ruleset, weightClassId: k.wc,
      approxWeightKg: kg,
      // Une pesée sur dix déborde de la catégorie (poids hors catégorie).
      weighInKg: weighed ? Math.round((kg + (rnd() < 0.35 ? 2 + rnd() * 4 : 0)) * 10) / 10 : null,
      presence: rnd() < 0.05 ? 'absent' : weighed ? 'present' : 'unknown',
      otherDisciplines: others,
      acceptsJiyuFirst: k.ruleset === 'shobu' ? rnd() < 0.3 : null,
      clubPreApproval: rnd() < 0.3,
    }));
  }
  return makeState(members);
}

/** Part des inscriptions actives seules dans leur catégorie naturelle (pour régler le générateur). */
export function aloneShare(s: State): number {
  const counts = new Map<string, number>();
  const active = s.members.filter((m) => m.presence !== 'absent');
  for (const m of active) counts.set(keyString(naturalKey(m, m)), (counts.get(keyString(naturalKey(m, m))) ?? 0) + 1);
  return active.filter((m) => counts.get(keyString(naturalKey(m, m))) === 1).length / active.length;
}
