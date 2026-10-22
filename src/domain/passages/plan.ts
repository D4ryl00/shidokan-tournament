import type { Bracket } from '../brackets/index.js';
import type { PassageOrderMode } from '../settings.js';
import type { DisciplineId } from '../types.js';
import { distributeZones, type ZoneSpec } from './distribute.js';
import { finalMatchIds } from './finals.js';
import { matchNodes, type MatchNode } from './graph.js';
import { zoneOrder, type OrderCategory, type Passage } from './order.js';

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

/** Clé d'une vague ; '' : la vague implicite d'une compétition sans vague. */
export const waveKey = (waveId: string | null) => waveId ?? '';

/** Numéro enregistré au lancement d'une vague. */
export interface FrozenPassage {
  waveKey: string;
  zoneId: string;
  number: number;
  categoryId: string;
  matchId: string | null;
  noRest: boolean;
}

export interface PlanInput {
  categories: PlanCategory[];
  zones: ZoneSpec[];
  waves: { id: string; order: number }[];
  mode: PassageOrderMode;
  /** Numéros des vagues lancées au moins une fois. */
  frozen?: FrozenPassage[];
  /** Vagues numérotées à partir de 1 (« reprendre les numéros à 1 ») : les vagues suivantes continuent après elles. */
  restart?: string[];
  /** Zone des finales (combats pour la 1re place, et finales de kata si `kata`). */
  finals?: { zoneId: string | null; kata: boolean };
  /** Passages joués (clé `${categoryId}:${matchId ?? 'kata'}`) : ils gardent numéro et zone, même après un déplacement. */
  played?: Set<string>;
}

export type PlannedPassage = Passage & { waveId: string | null };
export interface PassagePlan {
  /** Zone de chaque catégorie ; `auto` : répartie par l'app (pas épinglée). */
  categories: Record<string, { zoneId: string | null; auto: boolean }>;
  /** Dans l'ordre des zones ; passages par numéro. */
  zones: { zoneId: string; passages: PlannedPassage[] }[];
  /** Catégories qu'aucune zone n'accepte (discipline). */
  impossible: { categoryId: string; discipline: DisciplineId }[];
  /** Catégories d'une vague figée sans numéros à jour (nouvelles ou régénérées) : à numéroter. */
  pending: { waveId: string | null; categoryId: string }[];
  /** Clés des vagues figées. */
  frozenWaves: string[];
}

interface Context {
  zones: ZoneSpec[];
  mode: PassageOrderMode;
  finalsZone: string | null;
  kataFinals: boolean;
  nodes: Map<string, MatchNode[]>;
  /** La zone accueille la discipline. */
  accepts: (zoneId: string, discipline: DisciplineId) => boolean;
}

function context(input: PlanInput): Context {
  const zones = [...input.zones].sort((a, b) => a.order - b.order);
  const finalsZone = input.finals?.zoneId && zones.some((z) => z.id === input.finals!.zoneId) ? input.finals.zoneId : null;
  const nodes = new Map<string, MatchNode[]>(input.categories.map((c) => [c.id, c.playable && c.bracket?.kind === 'combat' ? matchNodes(c.bracket) : []]));
  const accepts = (zoneId: string, discipline: DisciplineId) => {
    const z = zones.find((x) => x.id === zoneId);
    return !!z && (z.disciplines === null || z.disciplines.includes(discipline));
  };
  return { zones, mode: input.mode, finalsZone, kataFinals: !!input.finals?.kata && finalsZone !== null, nodes, accepts };
}

const isKata = (c: PlanCategory) => c.bracket?.kind === 'kata';
/** Finales qui passent sur la zone des finales : seulement si elle accueille la discipline de la catégorie. */
const finalsOf = (c: PlanCategory, ctx: Context) =>
  ctx.finalsZone && c.bracket?.kind === 'combat' && ctx.accepts(ctx.finalsZone, c.discipline) ? finalMatchIds(c.bracket) : [];
const kataSplit = (c: PlanCategory, ctx: Context) => ctx.kataFinals && ctx.accepts(ctx.finalsZone!, c.discipline);

const sameKeys = (a: (string | null)[], b: (string | null)[]) => a.length === b.length && a.every((k) => b.includes(k));

/**
 * Des numéros figés sont-ils encore à jour ? Mêmes combats (ou un bloc de kata, entier ou séparé : le réglage des finales
 * peut avoir changé depuis le lancement) et chacun sur la zone de la catégorie, sauf une finale (zone des finales).
 */
function stillValid(c: PlanCategory, rows: FrozenPassage[], zoneId: string | null, ctx: Context, played: Set<string>): boolean {
  const keys = rows.map((r) => r.matchId);
  let shape: boolean;
  let finals: (string | null)[];
  if (isKata(c)) {
    const split: (string | null)[] = c.bracket!.entrants.length > 2 ? ['kata:tour1', 'kata:finale'] : ['kata:finale'];
    shape = sameKeys(keys, [null]) || sameKeys(keys, split);
    finals = ['kata:finale'];
  } else {
    shape = sameKeys(keys, ctx.nodes.get(c.id)!.map((n) => n.matchId));
    finals = c.bracket?.kind === 'combat' ? finalMatchIds(c.bracket) : [];
  }
  // Un passage joué reste sur sa zone (catégorie déplacée en cours de compétition).
  return shape && rows.every((r) => r.zoneId === zoneId || finals.includes(r.matchId) || played.has(`${r.categoryId}:${r.matchId ?? 'kata'}`));
}

/**
 * Numérote les catégories jouables `cats` d'une vague à partir des compteurs `next` (mis à jour) : chaque zone (kata d'abord,
 * puis les combats), puis, sur la zone des finales, les combats pour la 1re place et les finales de kata, à la fin de la vague.
 */
function orderWave(
  cats: PlanCategory[],
  zoneOf: (id: string) => string | null,
  waveId: string | null,
  ctx: Context,
  next: Map<string, number>,
  opts: { keep?: Set<string>; zones?: Set<string> } = {},
): (PlannedPassage & { zoneId: string })[] {
  const out: (PlannedPassage & { zoneId: string })[] = [];
  // Passages gardés (joués) : ni émis ni renumérotés ; `zones` : seulement ces zones.
  const kept = (c: PlanCategory, matchId: string | null) => opts.keep?.has(`${c.id}:${matchId ?? 'kata'}`) ?? false;
  const kataEntry = (c: PlanCategory, block: string | null): OrderCategory[] =>
    kept(c, block) ? [] : [{ id: c.id, rank: c.rank, kataEntrants: c.bracket!.entrants.length, kataBlock: block, nodes: [] }];
  const emit = (zoneId: string, here: OrderCategory[]) => {
    if (opts.zones && !opts.zones.has(zoneId)) return;
    const passages = zoneOrder(here, ctx.mode, next.get(zoneId)!);
    out.push(...passages.map((p) => ({ ...p, waveId, zoneId })));
    next.set(zoneId, next.get(zoneId)! + passages.length);
  };
  for (const z of ctx.zones) {
    const here: OrderCategory[] = [];
    for (const c of cats.filter((x) => zoneOf(x.id) === z.id)) {
      if (isKata(c)) {
        if (!kataSplit(c, ctx)) here.push(...kataEntry(c, null));
        else if (c.bracket!.entrants.length > 2) here.push(...kataEntry(c, 'kata:tour1'));
      } else {
        const finals = finalsOf(c, ctx);
        here.push({ id: c.id, rank: c.rank, kataEntrants: null, nodes: ctx.nodes.get(c.id)!.filter((x) => !finals.includes(x.matchId) && !kept(c, x.matchId)) });
      }
    }
    emit(z.id, here);
  }
  if (ctx.finalsZone) {
    const finals: OrderCategory[] = [];
    for (const c of cats.filter((x) => zoneOf(x.id) !== null)) {
      if (isKata(c)) {
        if (kataSplit(c, ctx)) finals.push(...kataEntry(c, 'kata:finale'));
      } else {
        const ids = finalsOf(c, ctx);
        const nodes = ctx.nodes.get(c.id)!.filter((x) => ids.includes(x.matchId) && !kept(c, x.matchId));
        if (nodes.length) finals.push({ id: c.id, rank: c.rank, kataEntrants: null, nodes });
      }
    }
    emit(ctx.finalsZone, finals);
  }
  return out;
}

/**
 * Répartition et numéros de toute la compétition, vague par vague (une vague implicite sans vague) ; chaque zone continue
 * sa numérotation. Une vague figée garde ses numéros ; ses catégories sans numéros à jour sont « à numéroter ».
 * Une catégorie sans vague alors qu'il y en a n'a ni zone automatique ni numéro.
 */
export function planPassages(input: PlanInput): PassagePlan {
  const ctx = context(input);
  const zoneIds = new Set(ctx.zones.map((z) => z.id));
  const plan: PassagePlan = { categories: {}, zones: ctx.zones.map((z) => ({ zoneId: z.id, passages: [] })), impossible: [], pending: [], frozenWaves: [] };
  const byZone = new Map(plan.zones.map((z) => [z.zoneId, z.passages]));
  const frozen = input.frozen ?? [];
  const weight = (c: PlanCategory) => (isKata(c) ? (c.playable ? c.bracket!.entrants.length : 0) : ctx.nodes.get(c.id)!.length);
  const next = new Map(ctx.zones.map((z) => [z.id, 1]));

  const waves = input.waves.length === 0 ? [null] : [...input.waves].sort((a, b) => a.order - b.order).map((w) => w.id);
  for (const waveId of waves) {
    const key = waveKey(waveId);
    const cats = input.categories.filter((c) => c.waveId === waveId);
    const { zoneOf, impossible } = distributeZones(
      cats.map((c) => ({ id: c.id, discipline: c.discipline, pinnedZoneId: c.pinnedZoneId, weight: weight(c), rank: c.rank })),
      ctx.zones,
    );
    for (const c of cats) plan.categories[c.id] = { zoneId: zoneOf.get(c.id) ?? null, auto: !(c.pinnedZoneId && zoneIds.has(c.pinnedZoneId)) };
    for (const id of impossible) plan.impossible.push({ categoryId: id, discipline: cats.find((c) => c.id === id)!.discipline });
    const playable = cats.filter((c) => c.playable);
    const rows = frozen.filter((f) => f.waveKey === key && zoneIds.has(f.zoneId));
    if (rows.length > 0) {
      plan.frozenWaves.push(key);
      for (const c of playable) {
        const mine = rows.filter((r) => r.categoryId === c.id);
        if (!stillValid(c, mine, zoneOf.get(c.id) ?? null, ctx, input.played ?? new Set())) plan.pending.push({ waveId, categoryId: c.id });
        else for (const r of mine) byZone.get(r.zoneId)!.push({ number: r.number, categoryId: r.categoryId, matchId: r.matchId, noRest: r.noRest, waveId });
      }
      // Les numéros figés (trous compris) sont pris : la suite vient après (après eux seuls si la vague a repris à 1).
      const restarted = input.restart?.includes(key) ?? false;
      for (const z of ctx.zones) {
        const top = Math.max(0, ...rows.filter((r) => r.zoneId === z.id).map((r) => r.number));
        next.set(z.id, restarted ? top + 1 : Math.max(next.get(z.id)!, top + 1));
      }
    } else {
      if (input.restart?.includes(key)) for (const z of ctx.zones) next.set(z.id, 1);
      for (const p of orderWave(playable, (id) => zoneOf.get(id) ?? null, waveId, ctx, next)) {
        const { zoneId, ...passage } = p;
        byZone.get(zoneId)!.push(passage);
      }
    }
  }
  for (const z of plan.zones) z.passages.sort((a, b) => a.number - b.number);
  // Sans vague alors qu'il y en a : ni zone automatique ni numéro (seul un épinglage s'affiche).
  for (const c of input.categories) {
    if (!(c.id in plan.categories)) plan.categories[c.id] = { zoneId: c.pinnedZoneId && zoneIds.has(c.pinnedZoneId) ? c.pinnedZoneId : null, auto: false };
  }
  return plan;
}

/** Vagues de la même numérotation que `waveId` (depuis le dernier « reprendre à 1 » jusqu'au suivant), dans l'ordre. */
function segmentOf(input: PlanInput, waveId: string | null): string[] {
  const order = input.waves.length === 0 ? [''] : [...input.waves].sort((a, b) => a.order - b.order).map((w) => w.id);
  const at = order.indexOf(waveKey(waveId));
  const restarts = order.map((k, i) => (i === 0 || input.restart?.includes(k) ? i : -1)).filter((i) => i >= 0);
  const from = Math.max(...restarts.filter((i) => i <= at));
  const to = Math.min(order.length, ...restarts.filter((i) => i > at));
  return order.slice(from, to);
}

export interface RenumberOptions {
  /** Passages gardés (joués, finale restée sur la zone des finales) : jamais renumérotés ; par défaut `input.played`. */
  played?: Set<string>;
  /** Zone imposée à des catégories (déplacement) ; sinon leur zone du plan. */
  zoneOf?: Record<string, string>;
}

const toFrozen = (p: PlannedPassage & { zoneId: string }): FrozenPassage => ({
  waveKey: waveKey(p.waveId), zoneId: p.zoneId, number: p.number, categoryId: p.categoryId, matchId: p.matchId, noRest: p.noRest,
});

/**
 * Numéros « à la suite » pour des catégories d'une vague figée (à numéroter, ou déplacées) : leurs passages non joués,
 * sur leur zone (imposée par `zoneOf`) et la zone des finales, après le dernier numéro figé de la zone parmi les vagues
 * de la même numérotation (depuis le dernier « reprendre à 1 »).
 */
export function appendPassages(input: PlanInput, waveId: string | null, categoryIds: string[], opts: RenumberOptions = {}): FrozenPassage[] {
  const ctx = context(input);
  const plan = planPassages(input);
  const segment = new Set(segmentOf(input, waveId));
  const rows = (input.frozen ?? []).filter((f) => segment.has(f.waveKey));
  const next = new Map(ctx.zones.map((z) => [z.id, 1 + Math.max(0, ...rows.filter((f) => f.zoneId === z.id).map((f) => f.number))]));
  const cats = input.categories.filter((c) => c.waveId === waveId && c.playable && categoryIds.includes(c.id));
  const zoneOf = (id: string) => opts.zoneOf?.[id] ?? plan.categories[id]?.zoneId ?? null;
  return orderWave(cats, zoneOf, waveId, ctx, next, { keep: opts.played ?? input.played }).map(toFrozen);
}

/**
 * « Mélangés » : nouveaux numéros de tous les passages non joués de la zone, dans les vagues figées de la même numérotation
 * que `waveId` (vague par vague, ordre de passage habituel), catégories `extra` comprises (à numéroter ou déplacées), à partir
 * du numéro qui suit le plus grand numéro joué de la zone. Les passages joués gardent leur numéro.
 */
export function reshuffleZone(input: PlanInput, zoneId: string, waveId: string | null, extra: string[], opts: RenumberOptions = {}): FrozenPassage[] {
  const ctx = context(input);
  const plan = planPassages(input);
  const segment = segmentOf(input, waveId);
  const keep = opts.played ?? input.played ?? new Set<string>();
  const kept = (input.frozen ?? []).filter((f) => segment.includes(f.waveKey) && f.zoneId === zoneId && keep.has(`${f.categoryId}:${f.matchId ?? 'kata'}`));
  const next = new Map(ctx.zones.map((z) => [z.id, 1]));
  next.set(zoneId, 1 + Math.max(0, ...kept.map((f) => f.number)));
  const pending = new Set(plan.pending.map((p) => p.categoryId).filter((id) => !extra.includes(id)));
  const zoneOf = (id: string) => opts.zoneOf?.[id] ?? plan.categories[id]?.zoneId ?? null;
  const out: FrozenPassage[] = [];
  for (const key of segment.filter((k) => plan.frozenWaves.includes(k))) {
    const wave = key === '' ? null : key;
    const cats = input.categories.filter((c) => c.waveId === wave && c.playable && !pending.has(c.id));
    out.push(...orderWave(cats, zoneOf, wave, ctx, next, { keep, zones: new Set([zoneId]) }).map(toFrozen));
  }
  return out;
}
