import { weightClassesFor } from './grid.js';
import type { CategoryGrid, Sex, WeightClass } from './types.js';

/**
 * Comprend « -35 », -35, « -35 kg », « +84 », « 84+ », « 84 kg et + ».
 * maxKg null = catégorie ouverte.
 */
export function parseWeightLabel(raw: string | number): { label: string; maxKg: number | null } | null {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw !== 0 ? { label: `-${Math.abs(raw)}`, maxKg: Math.abs(raw) } : null;
  }
  const s = raw.toLowerCase().replace(/[−–—‑﹣－]/g, '-').replace(/kg/g, '').replace(/\bet\b/g, '').replace(/\s+/g, '').replace(',', '.');
  const m = /^([+-]?)(\d+(?:\.\d+)?)(\+?)$/.exec(s);
  if (!m) return null;
  const kg = Number(m[2]);
  if (!(kg > 0)) return null;
  const open = m[1] === '+' || m[3] === '+';
  if (open && m[1] === '-') return null;
  return open ? { label: `+${kg}`, maxKg: null } : { label: `-${kg}`, maxKg: kg };
}

/** Catégorie correspondant à un poids réel, tolérance comprise ; la catégorie ouverte sinon. */
export function weightClassForWeight(
  grid: CategoryGrid,
  ageBandCode: string,
  sex: Sex,
  weightKg: number,
  toleranceKg: number,
): WeightClass | null {
  return pickWeightClass(weightClassesFor(grid, ageBandCode, sex), weightKg, toleranceKg);
}

/** Parmi des catégories triées de la plus légère à l'ouverte, celle d'un poids, tolérance comprise ; l'ouverte sinon. */
export function pickWeightClass<W extends Pick<WeightClass, 'maxKg'>>(classes: W[], weightKg: number, toleranceKg: number): W | null {
  // Arrondi au gramme pour éviter les erreurs de virgule flottante (67 + 0.3).
  const grams = (kg: number) => Math.round(kg * 1000);
  return (
    classes.find((w) => w.maxKg !== null && grams(weightKg) <= grams(w.maxKg) + grams(toleranceKg)) ??
    classes.find((w) => w.maxKg === null) ??
    null
  );
}

export function neighborWeightClasses(
  grid: CategoryGrid,
  wc: WeightClass,
): { lighter: WeightClass | null; heavier: WeightClass | null } {
  const classes = weightClassesFor(grid, wc.ageBandCode, wc.sex);
  const i = classes.findIndex((w) => w.maxKg === wc.maxKg);
  return { lighter: classes[i - 1] ?? null, heavier: i >= 0 ? (classes[i + 1] ?? null) : null };
}

export type WeightCellResult =
  | { kind: 'ok'; weightClass: WeightClass; warning: string | null }
  | { kind: 'unknown'; label: string; maxKg: number | null } // libellé lisible, absent de la grille
  | { kind: 'error'; message: string };

/**
 * Interprète une cellule « catégorie de poids ». Un tableur transforme souvent « +84 » en 84 :
 * un nombre sans signe n'est donc jamais lu comme « -N » en silence.
 */
export function resolveWeightCell(grid: CategoryGrid, ageBandCode: string, sex: Sex, cell: unknown): WeightCellResult {
  const raw = cell === null || cell === undefined ? '' : String(cell).trim();
  if (!raw) return { kind: 'error', message: 'La catégorie de poids est obligatoire.' };
  const classes = weightClassesFor(grid, ageBandCode, sex);
  const unsigned = typeof cell === 'number' ? cell > 0 : /^\d+(?:[.,]\d+)?\s*(?:kg)?$/i.test(raw);
  if (unsigned) {
    const n = Number(raw.replace(/kg/i, '').replace(',', '.'));
    const minus = classes.find((w) => w.label === `-${n}`);
    const plus = classes.find((w) => w.label === `+${n}`);
    if (minus && plus) return { kind: 'error', message: `Catégorie de poids « ${raw} » ambiguë : écrire -${n} ou +${n}.` };
    const only = minus ?? plus;
    if (only) return { kind: 'ok', weightClass: only, warning: `Catégorie de poids « ${raw} » interprétée comme « ${only.label} ».` };
    return { kind: 'error', message: `Catégorie de poids « ${raw} » inconnue : écrire -${n} ou +${n}.` };
  }
  const parsed = parseWeightLabel(raw);
  if (!parsed) return { kind: 'error', message: `Catégorie de poids incompréhensible : « ${raw} ».` };
  const wc = classes.find((w) => w.label === parsed.label);
  if (wc) return { kind: 'ok', weightClass: wc, warning: null };
  if (parsed.maxKg === null) {
    // Ancienne catégorie ouverte « +N » (la grille a été complétée au-dessus de N) : catégorie juste au-dessus.
    const n = Number(parsed.label.slice(1));
    const above = classes.find((w) => w.maxKg !== null && w.maxKg > n);
    if (above && classes.some((w) => w.maxKg === n)) {
      return { kind: 'ok', weightClass: above, warning: `« ${parsed.label} » (ancienne catégorie ouverte) placé en « ${above.label} ».` };
    }
  }
  return { kind: 'unknown', label: parsed.label, maxKg: parsed.maxKg };
}
