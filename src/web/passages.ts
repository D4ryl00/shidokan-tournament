import type { PassagePlan } from '../domain/passages/index.js';

/** Ce que le plan de passage dit d'une catégorie : zone (épinglée ou automatique), numéros de ses combats, bloc de kata. */
export function categoryPassages(plan: PassagePlan | undefined, categoryId: string) {
  const numbers = new Map<string, number>();
  const noRest = new Set<string>();
  let kataNumber: number | null = null;
  for (const z of plan?.zones ?? []) {
    for (const p of z.passages) {
      if (p.categoryId !== categoryId) continue;
      if (p.matchId === null) kataNumber = p.number;
      else {
        numbers.set(p.matchId, p.number);
        if (p.noRest) noRest.add(p.matchId);
      }
    }
  }
  const zone = plan?.categories[categoryId] ?? { zoneId: null, auto: false };
  return { zoneId: zone.zoneId, auto: zone.auto, numbers, noRest, kataNumber };
}
