import type { Bracket } from '../domain/brackets/index.js';
import { finalMatchIds, isKataKey, parseKataKey, type PassagePlan } from '../domain/passages/index.js';

/**
 * Ce que le plan de passage dit d'une catégorie : zone (épinglée ou automatique), numéros de ses combats et leur zone
 * (une finale peut passer sur la zone des finales), passages de kata (un par kataka).
 */
export function categoryPassages(plan: PassagePlan | undefined, categoryId: string) {
  const numbers = new Map<string, number>();
  const noRest = new Set<string>();
  const matchZones = new Map<string, string>();
  const kata: { key: string; number: number; zoneId: string }[] = [];
  for (const z of plan?.zones ?? []) {
    for (const p of z.passages) {
      if (p.categoryId !== categoryId) continue;
      if (isKataKey(p.matchId)) {
        kata.push({ key: p.matchId, number: p.number, zoneId: z.zoneId });
        numbers.set(p.matchId, p.number);
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

/** « n° 14 à 18 », « n° 3 et 4 », « n° 14, 15, 17 » (numéros pas consécutifs, après un déplacement), « n° 14 ». */
function numbersText(ns: number[]): string {
  const sorted = [...ns].sort((a, b) => a - b);
  if (sorted.length === 1) return `n° ${sorted[0]}`;
  const consecutive = sorted.every((n, i) => i === 0 || n === sorted[i - 1]! + 1);
  if (!consecutive) return `n° ${sorted.join(', ')}`;
  return sorted.length === 2 ? `n° ${sorted[0]} et ${sorted[1]}` : `n° ${sorted[0]} à ${sorted[sorted.length - 1]}`;
}

/**
 * Numéros d'un kata : « n° 14 à 20 » (tour 1 et finale à la suite sur la zone de la catégorie), ou « tour 1 : n° 14 à 18 ·
 * finale : n° 3 et 4 (Ring) » ; la zone n'est dite que pour une finale sur une autre zone que la catégorie.
 */
export function kataPassageText(p: ReturnType<typeof categoryPassages>, zones: { id: string; name: string }[]): string {
  const name = (zid: string) => zones.find((z) => z.id === zid)?.name ?? '?';
  const tour1 = p.kata.filter((k) => parseKataKey(k.key)?.round !== 'finale');
  const finale = p.kata.filter((k) => parseKataKey(k.key)?.round === 'finale');
  if (tour1.length === 0 && finale.length === 0) return '';
  const all = [...tour1, ...finale];
  const together = all.every((k) => k.zoneId === all[0]!.zoneId) && numbersText(all.map((k) => k.number)).includes(' à ');
  if (tour1.length > 0 && finale.length > 0 && together) return numbersText(all.map((k) => k.number));
  const parts: string[] = [];
  if (tour1.length > 0) parts.push(`${finale.length > 0 ? 'tour 1 : ' : ''}${numbersText(tour1.map((k) => k.number))}`);
  if (finale.length > 0) {
    const elsewhere = finale[0]!.zoneId !== p.zoneId && finale.every((k) => k.zoneId === finale[0]!.zoneId);
    parts.push(`finale : ${numbersText(finale.map((k) => k.number))}${elsewhere ? ` (${name(finale[0]!.zoneId)})` : ''}`);
  }
  return parts.join(' · ');
}
