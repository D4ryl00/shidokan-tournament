import { keyString, naturalKey } from '../categories.js';
import { DISCIPLINES } from '../disciplines.js';
import type { Case, CategoryState, Member, State } from './types.js';
import { activeMembers, categoryWeightGap, effectiveWeight, gapThreshold, isOverweight } from './weights.js';

export const isLocked = (c: CategoryState | undefined) => c !== undefined && (c.status === 'started' || c.status === 'finished' || c.frozen === true);

/** Catégorie qui accueille une clé naturelle (clé propre ou absorbée par une fusion). */
export function categoryForKey(state: State, ks: string): CategoryState | undefined {
  return state.categories.find((c) => keyString(c.key) === ks || c.aliasKeys.includes(ks));
}

/** Catégorie naturelle d'origine d'un combattant recasé. */
export function originalCategory(state: State, m: Member): CategoryState | undefined {
  if (!m.original) return undefined;
  return categoryForKey(state, keyString(naturalKey({ ...m.original }, m)));
}

const KIND_ORDER = ['return', 'weight_out', 'alone', 'weight_gap'] as const;

export function detectCases(state: State): Case[] {
  const cases: Case[] = [];
  const byId = new Map(state.categories.map((c) => [c.id, c]));
  const withWeightOut = new Set<string>();

  for (const m of state.members) {
    if (m.presence === 'absent' || m.placementLocked) continue;
    const wic = isOverweight(m, state);
    if (wic && !isLocked(byId.get(m.categoryId ?? ''))) {
      withWeightOut.add(m.registrationId);
      const current = state.grid.weightClasses.find((w) => w.id === m.weightClassId);
      const kg = (x: number) => String(x).replace('.', ',');
      const detail = `Pesé(e) ${kg(m.weighInKg!)} kg : trop lourd pour ${current?.label ?? '?'} kg (tolérance ${kg(state.settings.weighInToleranceKg[m.sex])} kg) — sa catégorie de poids est ${wic.label} kg`;
      cases.push({ id: `weight_out:${m.registrationId}`, kind: 'weight_out', registrationId: m.registrationId, categoryId: m.categoryId, detail });
    }
  }

  for (const c of state.categories) {
    if (isLocked(c)) continue;
    const active = activeMembers(state, c.id);
    if (active.length === 1 && !withWeightOut.has(active[0]!.registrationId)) {
      cases.push({ id: `alone:${active[0]!.registrationId}`, kind: 'alone', registrationId: active[0]!.registrationId, categoryId: c.id, detail: 'Seul(e) dans sa catégorie' });
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

  for (const m of state.members) {
    if (!m.placementLocked || !m.original || m.presence === 'absent') continue;
    const current = byId.get(m.categoryId ?? '');
    if (isLocked(current)) continue;
    // Seul un combattant déplacé parce qu'il était seul revient, et seulement si le retour respecte l'écart de poids.
    if (m.original.reason && m.original.reason !== 'alone') continue;
    const home = originalCategory(state, m);
    const homeMembers = home ? activeMembers(state, home.id).filter((x) => x.registrationId !== m.registrationId) : [];
    const back = { ...m, ...m.original };
    const viable = homeMembers.length > 0 && categoryWeightGap([...homeMembers, back], state.grid) <= gapThreshold([...homeMembers, back], state) + 1e-9;
    if (home && home.id !== m.categoryId && !isLocked(home) && viable) {
      cases.push({ id: `return:${m.registrationId}`, kind: 'return', registrationId: m.registrationId, categoryId: m.categoryId, detail: 'Un adversaire est disponible dans la catégorie d’origine' });
    }
  }

  const label = (c: Case) => state.members.find((m) => m.registrationId === c.registrationId)?.label ?? '';
  return cases.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || label(a).localeCompare(label(b)));
}
