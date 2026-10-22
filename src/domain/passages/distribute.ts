import type { DisciplineId } from '../types.js';

/** Zone de combat vue par la répartition : `disciplines` null = toutes les disciplines. */
export interface ZoneSpec {
  id: string;
  order: number;
  disciplines: DisciplineId[] | null;
}
export interface DistributionCategory {
  id: string;
  discipline: DisciplineId;
  /** Zone choisie à la main (prioritaire sur la règle de discipline). */
  pinnedZoneId: string | null;
  /** Nombre de combats numérotés ; kata : nombre de katakas. */
  weight: number;
  rank: number;
}

const byOrder = (zones: ZoneSpec[]) => [...zones].sort((a, b) => a.order - b.order);

/** Zones qui accueillent une discipline, dans l'ordre des zones. */
export function zonesFor(discipline: DisciplineId, zones: ZoneSpec[]): ZoneSpec[] {
  return byOrder(zones).filter((z) => z.disciplines === null || z.disciplines.includes(discipline));
}

/**
 * Les épinglées d'abord (dans la charge de leur zone), puis les autres de la plus lourde à la plus légère sur la zone
 * autorisée la moins chargée (à charge égale, la première zone) : les zones finissent à peu près ensemble.
 */
export function distributeZones(cats: DistributionCategory[], zones: ZoneSpec[]): { zoneOf: Map<string, string | null>; impossible: string[] } {
  const load = new Map(zones.map((z) => [z.id, 0]));
  const zoneOf = new Map<string, string | null>();
  const impossible: string[] = [];
  const pinned = cats.filter((c) => c.pinnedZoneId !== null && load.has(c.pinnedZoneId));
  for (const c of pinned) {
    zoneOf.set(c.id, c.pinnedZoneId);
    load.set(c.pinnedZoneId!, load.get(c.pinnedZoneId!)! + c.weight);
  }
  const rest = cats.filter((c) => !pinned.includes(c)).sort((a, b) => b.weight - a.weight || a.rank - b.rank);
  for (const c of rest) {
    const allowed = zonesFor(c.discipline, zones);
    if (allowed.length === 0) {
      zoneOf.set(c.id, null);
      impossible.push(c.id);
      continue;
    }
    const best = allowed.reduce((x, z) => (load.get(z.id)! < load.get(x.id)! ? z : x));
    zoneOf.set(c.id, best.id);
    load.set(best.id, load.get(best.id)! + c.weight);
  }
  return { zoneOf, impossible };
}
