import { keyString, naturalKey, type CategoryKey } from '../categories.js';
import { categoryKeyClosed, entryKey } from '../closed-categories.js';
import { DISCIPLINES } from '../disciplines.js';
import type { Case, CategoryState, Member, State } from './types.js';
import { categoryWeightGap, effectiveWeight, gapThreshold, isOverweight } from './weights.js';

export const isLocked = (c: CategoryState | undefined) => c !== undefined && (c.status === 'started' || c.status === 'finished' || c.frozen === true);

/** Catégorie qui accueille une clé naturelle (clé propre ou absorbée par une fusion). */
export function categoryForKey(state: State, ks: string): CategoryState | undefined {
  return state.categories.find((c) => keyString(c.key) === ks || c.aliasKeys.includes(ks));
}

/**
 * Index des clés d'un état : comme `categoryForKey`, la première catégorie (dans l'ordre) dont la clé propre ou une clé
 * absorbée correspond, mais sans recalculer la clé de chaque catégorie à chaque recherche.
 */
export function keyLookup(state: State): (ks: string) => CategoryState | undefined {
  const first = new Map<string, number>();
  state.categories.forEach((c, i) => {
    for (const k of [keyString(c.key), ...c.aliasKeys]) if (!first.has(k)) first.set(k, i);
  });
  return (ks) => {
    const i = first.get(ks);
    return i === undefined ? undefined : state.categories[i];
  };
}

/** Catégorie naturelle d'origine d'un combattant recasé. */
export function originalCategory(state: State, m: Member): CategoryState | undefined {
  if (!m.original) return undefined;
  return categoryForKey(state, keyString(naturalKey({ ...m.original }, m)));
}

/** Inscrit (non déplacé, non absent) d'une catégorie que l'organisateur n'a pas ouverte. */
export const isClosedMember = (state: State, m: Member): boolean =>
  !m.placementLocked && m.presence !== 'absent' && state.closedEntries.includes(entryKey({ ageBandCode: m.ageBandCode, sex: m.sex, discipline: m.discipline, ruleset: m.ruleset }));

/** Catégorie fermée : jamais une cible de réaffectation. */
export const isClosedTarget = (state: State, key: CategoryKey): boolean => categoryKeyClosed(new Set(state.closedEntries), key);

const KIND_ORDER = ['closed', 'return', 'weight_out', 'alone', 'weight_gap'] as const;

export function detectCases(state: State): Case[] {
  const cases: Case[] = [];
  // Actifs par catégorie (comme activeMembers, dans l'ordre des inscrits), en un seul passage.
  const byCategory = new Map<string, Member[]>();
  for (const m of state.members) if (m.categoryId && m.presence !== 'absent') byCategory.set(m.categoryId, [...(byCategory.get(m.categoryId) ?? []), m]);
  const activeIn = (id: string) => byCategory.get(id) ?? [];
  const byId = new Map(state.categories.map((c) => [c.id, c]));
  const withWeightOut = new Set<string>();
  // Catégorie fermée : un seul cas, qui remplace les autres (seul, écart, poids hors catégorie).
  const closed = new Set<string>();
  for (const m of state.members) {
    if (!isClosedMember(state, m) || isLocked(byId.get(m.categoryId ?? ''))) continue;
    closed.add(m.registrationId);
    cases.push({ id: `closed:${m.registrationId}`, kind: 'closed', registrationId: m.registrationId, categoryId: m.categoryId, detail: 'Catégorie non ouverte à cette compétition' });
  }

  for (const m of state.members) {
    if (m.presence === 'absent' || m.placementLocked || closed.has(m.registrationId)) continue;
    const wic = isOverweight(m, state);
    if (wic && !isLocked(byId.get(m.categoryId ?? ''))) {
      withWeightOut.add(m.registrationId);
      const current = state.grid.weightClasses.find((w) => w.id === m.weightClassId);
      const kg = (x: number) => String(x).replace('.', ',');
      const e = m.sex === 'F' ? 'e' : '';
      const detail = `Pesé${e} ${kg(m.weighInKg!)} kg : trop lourd${e} pour ${current?.label ?? '?'} kg (tolérance ${kg(state.settings.weighInToleranceKg[m.sex])} kg) — sa catégorie de poids est ${wic.label} kg`;
      cases.push({ id: `weight_out:${m.registrationId}`, kind: 'weight_out', registrationId: m.registrationId, categoryId: m.categoryId, detail });
    }
  }

  for (const c of state.categories) {
    if (isLocked(c)) continue;
    const active = activeIn(c.id).filter((m) => !closed.has(m.registrationId));
    if (active.length === 1 && !withWeightOut.has(active[0]!.registrationId)) {
      cases.push({ id: `alone:${active[0]!.registrationId}`, kind: 'alone', registrationId: active[0]!.registrationId, categoryId: c.id, detail: active[0]!.sex === 'F' ? 'Seule dans sa catégorie' : 'Seul dans sa catégorie' });
    } else if (active.length >= 2 && DISCIPLINES[c.key.discipline].hasWeight) {
      const gap = categoryWeightGap(active, state.grid);
      const threshold = gapThreshold(active, state);
      if (gap > threshold + 1e-9) {
        const weights = active.map((m) => effectiveWeight(m, state.grid) ?? 0).sort((a, b) => a - b);
        const median = weights[Math.floor(weights.length / 2)]!;
        const outlier = [...active].sort((a, b) => Math.abs((effectiveWeight(b, state.grid) ?? 0) - median) - Math.abs((effectiveWeight(a, state.grid) ?? 0) - median))[0]!;
        if (!withWeightOut.has(outlier.registrationId)) {
          cases.push({ id: `weight_gap:${outlier.registrationId}`, kind: 'weight_gap', registrationId: outlier.registrationId, categoryId: c.id, detail: `Écart de poids de ${gap.toFixed(1).replace('.', ',')} kg dans la catégorie (max ${threshold} kg)` });
        }
      }
    }
  }

  let lookup: ReturnType<typeof keyLookup> | null = null;
  for (const m of state.members) {
    if (!m.placementLocked || !m.original || m.presence === 'absent') continue;
    const current = byId.get(m.categoryId ?? '');
    if (isLocked(current)) continue;
    // Seul un combattant déplacé parce qu'il était seul revient, et seulement si le retour respecte l'écart de poids.
    if (m.original.reason && m.original.reason !== 'alone') continue;
    lookup ??= keyLookup(state);
    const home = lookup(keyString(naturalKey({ ...m.original }, m)));
    const homeMembers = home ? activeIn(home.id).filter((x) => x.registrationId !== m.registrationId) : [];
    const back = { ...m, ...m.original };
    const viable = homeMembers.length > 0 && categoryWeightGap([...homeMembers, back], state.grid) <= gapThreshold([...homeMembers, back], state) + 1e-9;
    // Une catégorie d'origine fermée n'accueille personne : pas de retour (la proposition serait de toute façon écartée).
    if (home && home.id !== m.categoryId && !isLocked(home) && !isClosedTarget(state, home.key) && viable) {
      cases.push({ id: `return:${m.registrationId}`, kind: 'return', registrationId: m.registrationId, categoryId: m.categoryId, detail: 'Un adversaire est disponible dans la catégorie d’origine' });
    }
  }

  const label = (c: Case) => state.members.find((m) => m.registrationId === c.registrationId)?.label ?? '';
  return cases.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || label(a).localeCompare(label(b)));
}
