import type { CategoryGrid, Sex, WeightClass } from './types.js';
import { parseWeightLabel } from './weights.js';

const SEX_LABEL: Record<Sex, string> = { M: 'masculins', F: 'féminines' };

/** Catégories de poids d'une tranche et d'un sexe, de la plus légère à l'ouverte. */
export function weightClassesFor(grid: CategoryGrid, ageBandCode: string, sex: Sex): WeightClass[] {
  return grid.weightClasses
    .filter((w) => w.ageBandCode === ageBandCode && w.sex === sex)
    .sort((a, b) => (a.maxKg ?? Infinity) - (b.maxKg ?? Infinity));
}

/** Erreurs de cohérence de la grille, en français ; vide si la grille est valide. */
export function validateGrid(grid: CategoryGrid): string[] {
  const errors: string[] = [];
  const bandLabel = new Map<string, string>();
  for (const band of grid.ageBands) {
    if (bandLabel.has(band.code)) errors.push(`Tranche d'âge « ${band.code} » en double.`);
    bandLabel.set(band.code, band.label);
    if (!band.label.trim()) errors.push(`La tranche d'âge « ${band.code} » n'a pas de libellé.`);
    if (band.maxAge !== null && band.minAge > band.maxAge) {
      errors.push(`${band.label} : l'âge minimum (${band.minAge}) dépasse l'âge maximum (${band.maxAge}).`);
    }
  }

  const ids = new Set<string>();
  const groups = new Map<string, WeightClass[]>();
  for (const wc of grid.weightClasses) {
    if (ids.has(wc.id)) errors.push(`Catégorie de poids « ${wc.label} » : identifiant en double (${wc.id}).`);
    ids.add(wc.id);
    const parsed = parseWeightLabel(wc.label);
    if (!parsed) errors.push(`Libellé de poids incompréhensible : « ${wc.label} ».`);
    else if (parsed.maxKg !== wc.maxKg && wc.maxKg !== null) {
      errors.push(`Catégorie « ${wc.label} » : le libellé ne correspond pas au poids maximum (${wc.maxKg} kg).`);
    } else if (wc.maxKg === null && parsed.maxKg !== null) {
      errors.push(`Catégorie « ${wc.label} » : une catégorie ouverte s'écrit « +X ».`);
    }
    if (!bandLabel.has(wc.ageBandCode)) {
      errors.push(`Catégorie de poids « ${wc.label} » rattachée à une tranche d'âge inconnue : « ${wc.ageBandCode} ».`);
      continue;
    }
    const key = `${wc.ageBandCode}|${wc.sex}`;
    groups.set(key, [...(groups.get(key) ?? []), wc]);
  }
  for (const [key, classes] of groups) {
    const [code, sex] = key.split('|') as [string, Sex];
    const where = `${bandLabel.get(code)} ${SEX_LABEL[sex]}`;
    const open = classes.filter((w) => w.maxKg === null).length;
    if (open !== 1) errors.push(`${where} : il faut exactement une catégorie ouverte (« +X »), il y en a ${open}.`);
    const limits = classes.filter((w) => w.maxKg !== null).map((w) => w.maxKg!);
    if (new Set(limits).size !== limits.length) errors.push(`${where} : deux catégories ont le même poids maximum.`);
    if (limits.some((kg) => !(kg > 0))) errors.push(`${where} : un poids maximum doit être positif.`);
    const openClass = classes.find((w) => w.maxKg === null);
    if (openClass && limits.length > 0) {
      const expected = `+${Math.max(...limits)}`;
      if (parseWeightLabel(openClass.label)?.label !== expected) {
        errors.push(`${where} : la catégorie ouverte « ${openClass.label} » devrait être « ${expected} » (limite la plus haute).`);
      }
    }
  }

  const seenLinks = new Set<string>();
  for (const link of grid.ageLinks) {
    const k = `${link.from}>${link.to}`;
    if (seenLinks.has(k)) errors.push(`Passage d'âge « ${link.from} → ${link.to} » en double.`);
    seenLinks.add(k);
    for (const code of [link.from, link.to]) {
      if (!bandLabel.has(code)) errors.push(`Passage d'âge vers une tranche inconnue : « ${code} ».`);
    }
  }
  return errors;
}

/**
 * Ajoute des catégories de poids : ordre recalculé dans chaque groupe touché, et catégorie ouverte
 * renommée « +X » si une nouvelle limite dépasse l'ancienne (son identifiant ne change pas).
 */
export function mergeWeightClasses(grid: CategoryGrid, added: WeightClass[]): CategoryGrid {
  const weightClasses = [...grid.weightClasses.map((w) => ({ ...w })), ...added.map((w) => ({ ...w }))];
  const groups = new Set(added.map((w) => `${w.ageBandCode}|${w.sex}`));
  for (const g of groups) {
    const [band, sex] = g.split('|') as [string, Sex];
    const list = weightClasses.filter((w) => w.ageBandCode === band && w.sex === sex).sort((a, b) => (a.maxKg ?? Infinity) - (b.maxKg ?? Infinity));
    list.forEach((w, i) => (w.sortOrder = i));
    const limits = list.map((w) => w.maxKg).filter((kg): kg is number => kg !== null);
    const open = list.find((w) => w.maxKg === null);
    if (open && limits.length) open.label = `+${Math.max(...limits)}`;
  }
  return { ...grid, weightClasses };
}
