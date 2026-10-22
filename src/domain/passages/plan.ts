import type { Bracket } from '../brackets/index.js';
import type { PassageOrderMode } from '../settings.js';
import type { DisciplineId } from '../types.js';
import { distributeZones, type ZoneSpec } from './distribute.js';
import { matchNodes, type MatchNode } from './graph.js';
import { zoneOrder, type Passage } from './order.js';

export interface PlanCategory {
  id: string;
  /** Vague de la catégorie (null : en attente, ou aucune vague définie). */
  waveId: string | null;
  discipline: DisciplineId;
  pinnedZoneId: string | null;
  rank: number;
  bracket: Bracket | null;
  /** Au moins deux inscrits actifs. */
  playable: boolean;
}
export interface PassagePlan {
  /** Zone de chaque catégorie ; `auto` : répartie par l'app (pas épinglée). */
  categories: Record<string, { zoneId: string | null; auto: boolean }>;
  /** Dans l'ordre des zones ; passages par numéro. */
  zones: { zoneId: string; passages: (Passage & { waveId: string | null })[] }[];
  /** Catégories qu'aucune zone n'accepte (discipline). */
  impossible: { categoryId: string; discipline: DisciplineId }[];
}

/**
 * Répartition et numéros de toute la compétition : vague par vague (une vague implicite sans vague), chaque zone continue
 * sa numérotation. Une catégorie sans vague alors qu'il y en a n'a ni zone automatique ni numéro.
 */
export function planPassages(input: { categories: PlanCategory[]; zones: ZoneSpec[]; waves: { id: string; order: number }[]; mode: PassageOrderMode }): PassagePlan {
  const zones = [...input.zones].sort((a, b) => a.order - b.order);
  const zoneIds = new Set(zones.map((z) => z.id));
  const plan: PassagePlan = { categories: {}, zones: zones.map((z) => ({ zoneId: z.id, passages: [] })), impossible: [] };
  const nodes = new Map<string, MatchNode[]>(
    input.categories.map((c) => [c.id, c.playable && c.bracket?.kind === 'combat' ? matchNodes(c.bracket) : []]),
  );
  const isKata = (c: PlanCategory) => c.bracket?.kind === 'kata';
  const weight = (c: PlanCategory) => (isKata(c) ? (c.playable ? c.bracket!.entrants.length : 0) : nodes.get(c.id)!.length);
  const next = new Map(zones.map((z) => [z.id, 1]));

  const waves = input.waves.length === 0 ? [null] : [...input.waves].sort((a, b) => a.order - b.order).map((w) => w.id);
  for (const waveId of waves) {
    const cats = input.categories.filter((c) => c.waveId === waveId);
    const { zoneOf, impossible } = distributeZones(
      cats.map((c) => ({ id: c.id, discipline: c.discipline, pinnedZoneId: c.pinnedZoneId, weight: weight(c), rank: c.rank })),
      zones,
    );
    for (const c of cats) plan.categories[c.id] = { zoneId: zoneOf.get(c.id) ?? null, auto: !(c.pinnedZoneId && zoneIds.has(c.pinnedZoneId)) };
    for (const id of impossible) plan.impossible.push({ categoryId: id, discipline: cats.find((c) => c.id === id)!.discipline });
    for (const z of plan.zones) {
      const here = cats
        .filter((c) => c.playable && zoneOf.get(c.id) === z.zoneId)
        .map((c) => ({ id: c.id, rank: c.rank, kataEntrants: isKata(c) ? c.bracket!.entrants.length : null, nodes: nodes.get(c.id)! }));
      const passages = zoneOrder(here, input.mode, next.get(z.zoneId)!);
      z.passages.push(...passages.map((p) => ({ ...p, waveId })));
      next.set(z.zoneId, next.get(z.zoneId)! + passages.length);
    }
  }
  // Sans vague alors qu'il y en a : ni zone automatique ni numéro (seul un épinglage s'affiche).
  for (const c of input.categories) {
    if (!(c.id in plan.categories)) plan.categories[c.id] = { zoneId: c.pinnedZoneId && zoneIds.has(c.pinnedZoneId) ? c.pinnedZoneId : null, auto: false };
  }
  return plan;
}
