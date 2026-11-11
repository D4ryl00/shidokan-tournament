import type { Bracket } from '../brackets/index.js';
import type { PassageOrderMode } from '../settings.js';
import type { DisciplineId } from '../types.js';
import { distributeZones, type ZoneSpec } from './distribute.js';
import { finalMatchIds } from './finals.js';
import { resolveFinals, type ResolvedFinals, type StoredFinals, type WaveFinals } from './finals-choice.js';
import { matchNodes, type MatchNode } from './graph.js';
import { zoneOrder, type OrderCategory, type Passage, type PlacedMatch } from './order.js';

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
  /** Où et quand se joue sa finale ; absent : valeurs de la session, sinon défaut. */
  finals?: StoredFinals;
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
  /** Zone des finales et derniers « Tout… » de chaque session (clé `waveKey`) ; absente : aucune. */
  waveFinals?: WaveFinals[];
  /**
   * Durée estimée d'un passage, changement compris (`matchId` null / 'kata:tour1' / 'kata:finale' : bloc de kata) : range les
   * finales « dès que finie » de la zone des finales par fin estimée de leur catégorie. Absente : dans l'ordre des catégories.
   */
  durationSec?: (categoryId: string, matchId: string | null) => number;
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
  /** Où et quand se joue la finale de chaque catégorie jouable placée sur une zone. */
  finals: Record<string, ResolvedFinals>;
}

interface Context {
  zones: ZoneSpec[];
  mode: PassageOrderMode;
  /** Réglages des finales de chaque session ; une zone des finales inconnue vaut « Aucune ». */
  waveFinals: Map<string, WaveFinals>;
  durationSec: PlanInput['durationSec'];
  nodes: Map<string, MatchNode[]>;
  /** La zone accueille la discipline. */
  accepts: (zoneId: string, discipline: DisciplineId) => boolean;
}

function context(input: PlanInput): Context {
  const zones = [...input.zones].sort((a, b) => a.order - b.order);
  const known = (id: string | null) => id !== null && zones.some((z) => z.id === id);
  const waveFinals = new Map((input.waveFinals ?? []).map((w) => [w.waveKey, known(w.finalsZoneId) ? w : { ...w, finalsZoneId: null }]));
  const nodes = new Map<string, MatchNode[]>(input.categories.map((c) => [c.id, c.playable && c.bracket?.kind === 'combat' ? matchNodes(c.bracket) : []]));
  const accepts = (zoneId: string, discipline: DisciplineId) => {
    const z = zones.find((x) => x.id === zoneId);
    return !!z && (z.disciplines === null || z.disciplines.includes(discipline));
  };
  return { zones, mode: input.mode, waveFinals, durationSec: input.durationSec, nodes, accepts };
}

const isKata = (c: PlanCategory) => c.bracket?.kind === 'kata';
const NO_CHOICE: StoredFinals = { where: null, when: null };

/** Où et quand se joue la finale de `c` quand la catégorie est sur `zoneId`. */
const finalsChoice = (c: PlanCategory, zoneId: string | null, ctx: Context): ResolvedFinals =>
  resolveFinals({
    kata: isKata(c),
    entrants: c.bracket?.entrants.length ?? 0,
    zoneId,
    stored: c.finals ?? NO_CHOICE,
    wave: ctx.waveFinals.get(waveKey(c.waveId)),
    mode: ctx.mode,
    accepts: (z) => ctx.accepts(z, c.discipline),
  });

/** Fin estimée (secondes depuis le début de la session) du dernier passage de chaque catégorie dans ces files. */
function estimatedEnds(queues: Passage[][], durationSec: (categoryId: string, matchId: string | null) => number): Map<string, number> {
  const ends = new Map<string, number>();
  for (const queue of queues) {
    let t = 0;
    for (const p of queue) {
      t += durationSec(p.categoryId, p.matchId);
      ends.set(p.categoryId, Math.max(ends.get(p.categoryId) ?? 0, t));
    }
  }
  return ends;
}

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
 * Numérote les catégories jouables `cats` d'une vague à partir des compteurs `next` (mis à jour), zone par zone :
 * - sur chaque zone, ses passages (kata d'abord, puis les combats), chaque finale « Sa zone » + « Dès que finie » juste après
 *   le dernier combat de sa catégorie ;
 * - sur la zone des finales de la session, puis les finales « Dès que finie » qui y passent, dans l'ordre où leurs catégories
 *   se terminent (durées estimées ; à défaut, ou à égalité, ordre des catégories) ;
 * - enfin, sur chaque zone, les finales « Fin de session » qui y passent, dans l'ordre des catégories.
 */
function orderWave(
  cats: PlanCategory[],
  zoneOf: (id: string) => string | null,
  waveId: string | null,
  ctx: Context,
  next: Map<string, number>,
  opts: { keep?: Set<string>; zones?: Set<string> } = {},
): (PlannedPassage & { zoneId: string })[] {
  // Passages gardés (joués) : ni émis ni renumérotés ; `zones` : seulement ces zones.
  const kept = (c: PlanCategory, matchId: string | null) => opts.keep?.has(`${c.id}:${matchId ?? 'kata'}`) ?? false;
  const kataEntry = (c: PlanCategory, block: string | null): OrderCategory[] =>
    kept(c, block) ? [] : [{ id: c.id, rank: c.rank, kataEntrants: c.bracket!.entrants.length, kataBlock: block, nodes: [] }];
  const finalsZone = ctx.waveFinals.get(waveKey(waveId))?.finalsZoneId ?? null;

  const own = new Map(ctx.zones.map((z) => [z.id, [] as OrderCategory[]]));
  const atEnd = new Map(ctx.zones.map((z) => [z.id, [] as OrderCategory[]]));
  const ready: OrderCategory[] = [];
  for (const c of cats) {
    const zoneId = zoneOf(c.id);
    if (zoneId === null || !own.has(zoneId)) continue;
    const r = finalsChoice(c, zoneId, ctx);
    let finals: OrderCategory[];
    if (isKata(c)) {
      if (!r.kataSplit) {
        own.get(zoneId)!.push(...kataEntry(c, null));
        continue;
      }
      if (c.bracket!.entrants.length > 2) own.get(zoneId)!.push(...kataEntry(c, 'kata:tour1'));
      finals = kataEntry(c, 'kata:finale');
    } else {
      const ids = c.bracket?.kind === 'combat' ? finalMatchIds(c.bracket) : [];
      const nodes = ctx.nodes.get(c.id)!.filter((x) => !kept(c, x.matchId));
      const entry = (list: MatchNode[]): OrderCategory => ({ id: c.id, rank: c.rank, kataEntrants: null, nodes: list });
      const rounds = nodes.filter((x) => !ids.includes(x.matchId));
      const last = nodes.filter((x) => ids.includes(x.matchId));
      if (!r.onFinalsZone && r.when === 'ready') {
        own.get(zoneId)!.push({ ...entry(rounds), finalsAfter: last });
        continue;
      }
      own.get(zoneId)!.push(entry(rounds));
      finals = last.length > 0 ? [entry(last)] : [];
    }
    if (r.onFinalsZone && r.when === 'ready') ready.push(...finals);
    else atEnd.get(r.finalZoneId!)!.push(...finals);
  }

  const queues = new Map(ctx.zones.map((z) => [z.id, zoneOrder(own.get(z.id)!, ctx.mode, 1)]));
  // Derniers combats de la file (le repos se compte jusqu'au bloc de kata précédent).
  const tail = (queue: Passage[]): PlacedMatch[] => {
    const out: PlacedMatch[] = [];
    for (let i = queue.length - 1; i >= 0 && out.length < 2; i--) {
      const p = queue[i]!;
      const node = ctx.nodes.get(p.categoryId)?.find((n) => n.matchId === p.matchId);
      if (!node) break;
      out.unshift({ categoryId: p.categoryId, node });
    }
    return out;
  };
  const append = (queue: Passage[], here: OrderCategory[], mode: PassageOrderMode) => queue.push(...zoneOrder(here, mode, queue.length + 1, tail(queue)));

  if (finalsZone !== null && ready.length > 0) {
    const ends = ctx.durationSec ? estimatedEnds([...queues.values()], ctx.durationSec) : new Map<string, number>();
    const end = (c: OrderCategory) => ends.get(c.id) ?? 0;
    // Une à une : un bloc de kata ne passe pas devant une finale de combat finie avant lui.
    for (const c of [...ready].sort((a, b) => end(a) - end(b) || a.rank - b.rank)) append(queues.get(finalsZone)!, [c], ctx.mode);
  }
  for (const z of ctx.zones) append(queues.get(z.id)!, atEnd.get(z.id)!, ctx.mode);

  const out: (PlannedPassage & { zoneId: string })[] = [];
  for (const z of ctx.zones) {
    if (opts.zones && !opts.zones.has(z.id)) continue;
    const first = next.get(z.id)!;
    const queue = queues.get(z.id)!;
    out.push(...queue.map((p) => ({ ...p, number: first + p.number - 1, waveId, zoneId: z.id })));
    next.set(z.id, first + queue.length);
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
  const plan: PassagePlan = { categories: {}, zones: ctx.zones.map((z) => ({ zoneId: z.id, passages: [] })), impossible: [], pending: [], frozenWaves: [], finals: {} };
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
    for (const c of playable) {
      const zoneId = zoneOf.get(c.id) ?? null;
      if (zoneId !== null) plan.finals[c.id] = finalsChoice(c, zoneId, ctx);
    }
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
export function segmentOf(input: PlanInput, waveId: string | null): string[] {
  const order = input.waves.length === 0 ? [''] : [...input.waves].sort((a, b) => a.order - b.order).map((w) => w.id);
  const at = order.indexOf(waveKey(waveId));
  const restarts = order.map((k, i) => (i === 0 || input.restart?.includes(k) ? i : -1)).filter((i) => i >= 0);
  const from = Math.max(...restarts.filter((i) => i <= at));
  const to = Math.min(order.length, ...restarts.filter((i) => i > at));
  return order.slice(from, to);
}

export interface RenumberOptions {
  /** Passages joués : jamais renumérotés ; le plus grand numéro joué fixe le départ de « mélangés ». Par défaut `input.played`. */
  played?: Set<string>;
  /** Passages gardés tels quels sans être joués (finale restée sur la zone des finales). */
  pinned?: Set<string>;
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
  const keep = new Set([...(opts.played ?? input.played ?? []), ...(opts.pinned ?? [])]);
  return orderWave(cats, zoneOf, waveId, ctx, next, { keep }).map(toFrozen);
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
  const played = opts.played ?? input.played ?? new Set<string>();
  const keep = new Set([...played, ...(opts.pinned ?? [])]);
  // Départ : après le plus grand numéro réellement joué de la zone.
  const kept = (input.frozen ?? []).filter((f) => segment.includes(f.waveKey) && f.zoneId === zoneId && played.has(`${f.categoryId}:${f.matchId ?? 'kata'}`));
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
