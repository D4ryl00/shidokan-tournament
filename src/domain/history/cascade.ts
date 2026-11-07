import type { HistoryKind } from './types.js';

export interface CascadeEntry {
  id: string;
  seq: number;
  active: boolean;
  kind: HistoryKind;
  categoryIds: string[];
  afterMembers: Record<string, string[]>;
}

export const lockedReason = (label: string) => `${label} est lancée : déverrouillez-la pour annuler.`;
export const CHANGED_REASON = 'Le tableau a changé depuis (inscrits différents) : refaites le tirage ou échangez à la main.';

/**
 * Lot d'actions à annuler pour annuler `targetIds` : les cibles plus les actions actives plus récentes
 * qui touchent, de proche en proche, une même catégorie. Plus récente d'abord.
 */
export function undoSet<T extends CascadeEntry>(entries: T[], targetIds: string[]): T[] {
  const active = entries.filter((e) => e.active).sort((a, b) => a.seq - b.seq);
  const targetSet = new Set(targetIds);
  if (!active.some((e) => targetSet.has(e.id))) return [];
  const inSet = new Set<string>();
  const cats = new Set<string>();
  // Dans l'ordre : les catégories d'une cible ne comptent qu'à partir d'elle (union des cascades de chaque cible).
  for (const e of active) {
    if (targetSet.has(e.id) || e.categoryIds.some((c) => cats.has(c))) {
      inSet.add(e.id);
      for (const c of e.categoryIds) cats.add(c);
    }
  }
  return active.filter((e) => inSet.has(e.id)).sort((a, b) => b.seq - a.seq);
}

const sameMembers = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n');

/**
 * Vrai si le tableau d'une catégorie ne correspond plus à ce qu'une action du lot (échange de places ou
 * nouveau tirage) a laissé : l'annuler rendrait un tableau incohérent.
 */
export function compositionChanged(set: CascadeEntry[], currentMembers: Map<string, string[]>): boolean {
  const cats = new Set(set.filter((e) => e.kind === 'places' || e.kind === 'redraw').flatMap((e) => e.categoryIds));
  for (const cat of cats) {
    let last: CascadeEntry | null = null;
    for (const e of set) if (e.categoryIds.includes(cat) && (!last || e.seq > last.seq)) last = e;
    const after = last?.afterMembers[cat];
    const now = currentMembers.get(cat);
    if (!after || !now) continue;
    if (!sameMembers(after, now)) return true;
  }
  return false;
}
