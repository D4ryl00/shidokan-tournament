import type { Bracket } from '../domain/brackets/index.js';
import { finalMatchIds, type PassagePlan } from '../domain/passages/index.js';

/**
 * Ce que le plan de passage dit d'une catégorie : zone (épinglée ou automatique), numéros de ses combats et leur zone
 * (une finale peut passer sur la zone des finales), blocs de kata (entier, ou tour 1 et finale).
 */
export function categoryPassages(plan: PassagePlan | undefined, categoryId: string) {
  const numbers = new Map<string, number>();
  const noRest = new Set<string>();
  const matchZones = new Map<string, string>();
  const kata: { part: 'all' | 'tour1' | 'finale'; number: number; zoneId: string }[] = [];
  for (const z of plan?.zones ?? []) {
    for (const p of z.passages) {
      if (p.categoryId !== categoryId) continue;
      if (p.matchId === null || p.matchId.startsWith('kata:')) {
        kata.push({ part: p.matchId === null ? 'all' : p.matchId === 'kata:tour1' ? 'tour1' : 'finale', number: p.number, zoneId: z.zoneId });
        continue;
      }
      numbers.set(p.matchId, p.number);
      matchZones.set(p.matchId, z.zoneId);
      if (p.noRest) noRest.add(p.matchId);
    }
  }
  const zone = plan?.categories[categoryId] ?? { zoneId: null, auto: false };
  // Plan pas encore chargé : `numbers` absent (numérotation propre à la catégorie, sans marque).
  return { zoneId: zone.zoneId, auto: zone.auto, numbers: plan ? numbers : undefined, noRest, matchZones, kata: kata.sort((a, b) => a.number - b.number) };
}

/**
 * Combats sur une autre zone que leur catégorie : « Zone des finales : Ring » pour une finale déplacée, « Joué sur : Tatami 1 »
 * pour un combat joué avant un déplacement de la catégorie.
 */
export function movedMatchZones(p: ReturnType<typeof categoryPassages> | null, zones: { id: string; name: string }[], bracket?: Bracket | null): Map<string, string> {
  const finals = bracket?.kind === 'combat' ? finalMatchIds(bracket) : [];
  const name = (zid: string) => zones.find((z) => z.id === zid)?.name ?? '?';
  return new Map(
    [...(p?.matchZones ?? [])]
      .filter(([, zid]) => zid !== p?.zoneId)
      .map(([mid, zid]) => [mid, finals.includes(mid) ? `Zone des finales : ${name(zid)}` : `Joué sur : ${name(zid)}`]),
  );
}
