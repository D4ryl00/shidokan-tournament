import type { AgeBand, AgeLink, CategoryGrid, Sex, WeightClass } from './types.js';

// Règlement des compétitions FFK 2026-2027, p. 17 (tableau des catégories de poids).

const AGE_BANDS: Omit<AgeBand, 'sortOrder'>[] = [
  { code: 'mini-poussin', label: 'Mini-poussins', minAge: 4, maxAge: 5, isMinor: true },
  { code: 'poussin', label: 'Poussins', minAge: 6, maxAge: 7, isMinor: true },
  { code: 'pupille', label: 'Pupilles', minAge: 8, maxAge: 9, isMinor: true },
  { code: 'benjamin', label: 'Benjamins', minAge: 10, maxAge: 11, isMinor: true },
  { code: 'minime', label: 'Minimes', minAge: 12, maxAge: 13, isMinor: true },
  { code: 'cadet', label: 'Cadets', minAge: 14, maxAge: 15, isMinor: true },
  { code: 'junior', label: 'Juniors', minAge: 16, maxAge: 17, isMinor: true },
  { code: 'espoir', label: 'Espoirs', minAge: 18, maxAge: 20, isMinor: false },
  { code: 'senior', label: 'Seniors', minAge: 18, maxAge: 34, isMinor: false },
  { code: 'v1', label: 'Vétérans 1', minAge: 35, maxAge: 45, isMinor: false },
  { code: 'v2', label: 'Vétérans 2', minAge: 46, maxAge: 55, isMinor: false },
  { code: 'v3', label: 'Vétérans 3', minAge: 56, maxAge: 65, isMinor: false },
  { code: 'v4', label: 'Vétérans 4', minAge: 66, maxAge: 75, isMinor: false },
  { code: 'v5', label: 'Vétérans 5', minAge: 76, maxAge: null, isMinor: false },
];

/** Limites hautes en kg ; la dernière valeur est la borne de la catégorie ouverte (« +X »). */
const WEIGHTS: Record<string, Record<Sex, number[]>> = {
  'mini-poussin': { F: [25, 35], M: [25, 35] },
  poussin: { F: [25, 35], M: [25, 35] },
  pupille: { F: [25, 30, 35, 40, 45], M: [25, 30, 35, 40, 45, 50] },
  benjamin: { F: [30, 35, 40, 45, 50], M: [30, 35, 40, 45, 50, 55] },
  minime: { F: [35, 40, 45, 50, 55], M: [35, 40, 45, 50, 55, 60, 65] },
  cadet: { F: [47, 54, 61], M: [52, 57, 63, 70] },
  junior: { F: [48, 53, 59, 66], M: [55, 61, 68, 76] },
  espoir: { F: [50, 55, 61, 68], M: [60, 67, 75, 84] },
  senior: { F: [50, 55, 61, 68], M: [60, 67, 75, 84] },
  v1: { F: [55, 61, 68], M: [67, 75, 84] },
  v2: { F: [55, 61, 68], M: [67, 75, 84] },
  v3: { F: [55, 61, 68], M: [67, 75, 84] },
  v4: { F: [55, 61, 68], M: [67, 75, 84] },
  v5: { F: [55, 61, 68], M: [67, 75, 84] },
};

const UP_CHAIN = ['mini-poussin', 'poussin', 'pupille', 'benjamin', 'minime', 'cadet', 'junior'];
const VETERANS = ['v1', 'v2', 'v3', 'v4', 'v5'];

function ageLinks(): AgeLink[] {
  const links: AgeLink[] = [];
  for (let i = 0; i + 1 < UP_CHAIN.length; i++) links.push({ from: UP_CHAIN[i]!, to: UP_CHAIN[i + 1]!, kind: 'C' });
  links.push({ from: 'junior', to: 'espoir', kind: 'C' });
  links.push({ from: 'junior', to: 'senior', kind: 'C' });
  links.push({ from: 'espoir', to: 'senior', kind: 'C' });
  links.push({ from: 'senior', to: 'v1', kind: 'D' }, { from: 'v1', to: 'senior', kind: 'D' });
  for (let i = 0; i + 1 < VETERANS.length; i++) {
    links.push({ from: VETERANS[i]!, to: VETERANS[i + 1]!, kind: 'C' });
    links.push({ from: VETERANS[i + 1]!, to: VETERANS[i]!, kind: 'C' });
  }
  return links;
}

export function ffkDefaultGrid(): CategoryGrid {
  const weightClasses: WeightClass[] = [];
  for (const [ageBandCode, bySex] of Object.entries(WEIGHTS)) {
    for (const sex of ['F', 'M'] as const) {
      const limits = bySex[sex];
      limits.forEach((kg, i) =>
        weightClasses.push({ id: `${ageBandCode}:${sex}:-${kg}`, ageBandCode, sex, label: `-${kg}`, maxKg: kg, sortOrder: i }),
      );
      const top = limits[limits.length - 1]!;
      weightClasses.push({
        id: `${ageBandCode}:${sex}:+${top}`, ageBandCode, sex, label: `+${top}`, maxKg: null, sortOrder: limits.length,
      });
    }
  }
  return {
    ageBands: AGE_BANDS.map((b, i) => ({ ...b, sortOrder: i })),
    weightClasses,
    ageLinks: ageLinks(),
  };
}
