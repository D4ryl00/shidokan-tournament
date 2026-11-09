import { resolveBracket, type Bracket, type Entrant, type KataScores, type Match, type MatchResult, type Podium, type ResolvedMatch, type SlotSource } from '../brackets/index.js';
import { activeEntrantCount, type Category } from '../categories.js';
import { finalMatchIds, waveKey, type PassagePlan } from '../passages/index.js';
import { categoryProgress, medalTable, validResults, type CategoryProgress, type ResultRecord } from '../results.js';
import type { PublicCategory, PublicCompetition, PublicEntrant, PublicPhase, PublicQueueItem, SideSource } from './types.js';

/** Résultats d'une catégorie, tels que les charge l'organisation. */
export interface PublicCategoryResults {
  records: ResultRecord[];
  kataScores: KataScores | null;
  tieBreaks: { pools: Record<number, string[]>; kata: string[]; kataFinal: string[] };
}

/**
 * Données brutes d'une compétition, chargées par le serveur, d'où sort la vue publique. Données simples (pas d'accès à la
 * base) ; seuls les champs nommés ici sont lus, champ par champ : tout le reste (poids, grade, coordonnées…) est ignoré.
 */
export interface PublicSource {
  /** Date du jour à Paris (AAAA-MM-JJ), voir `todayInParis`. */
  today: string;
  competition: { id: string; name: string; date: string; location: string | null };
  waves: { id: string; name: string; order: number }[];
  /** Clés des vagues actuellement lancées ('' : vague implicite d'une compétition sans vague). */
  launchedWaveKeys: Iterable<string>;
  zones: { id: string; name: string; order: number }[];
  fighters: { id: string; lastName: string; firstName: string; clubId: string | null; publicNameHidden: boolean }[];
  clubs: { id: string; name: string }[];
  registrations: { id: string; fighterId: string }[];
  categories: Category[];
  /** Par catégorie ; absente : aucun résultat. */
  results: Record<string, PublicCategoryResults>;
  /** Heure du dernier résultat (ou note de kata) de chaque catégorie. */
  lastResultAt: Record<string, string>;
  plan: PassagePlan;
  /** Catégories numérotées dans une vague actuellement lancée (`launchedCategoryIds`). */
  launchedCategoryIds: Iterable<string>;
  /** Zone des finales des réglages (`settings.finalsZoneId`) ; absente ou null : aucune. */
  finalsZoneId?: string | null;
}

export const HIDDEN_NAME = 'Combattant masqué';
const NO_CLUB = 'Sans club';
const IMPLICIT_WAVE = 'Session unique';

/** Le jour de la compétition (ou une vague lancée en avance) : aujourd'hui ; date passée : historique. */
export function publicPhase(date: string, today: string, anyWaveLaunched: boolean): PublicPhase {
  if (date < today) return 'past';
  if (date === today || anyWaveLaunched) return 'today';
  return 'upcoming';
}

/** Date du jour (AAAA-MM-JJ) à l'heure de Paris. */
export function todayInParis(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

// Copies champ par champ (liste blanche) : jamais d'objet source renvoyé tel quel.

function copySlot(s: SlotSource): SlotSource {
  switch (s.kind) {
    case 'entrant':
      return { kind: 'entrant', registrationId: s.registrationId };
    case 'bye':
      return { kind: 'bye' };
    case 'empty':
      return { kind: 'empty' };
    case 'winner':
    case 'loser':
      return { kind: s.kind, matchId: s.matchId };
    case 'poolRank':
      return { kind: 'poolRank', pool: s.pool, rank: s.rank };
    case 'beatenBy':
      return { kind: 'beatenBy', half: s.half, round: s.round };
  }
}

function copyMatch(m: Match): Match {
  return {
    id: m.id,
    phase: m.phase,
    round: m.round,
    order: m.order,
    a: copySlot(m.a),
    b: copySlot(m.b),
    ...(m.pool !== undefined ? { pool: m.pool } : {}),
    ...(m.optional !== undefined ? { optional: m.optional } : {}),
  };
}

function copyBracket(b: Bracket, entrant: (e: Entrant) => Entrant): Bracket {
  if (b.kind === 'kata') return { kind: 'kata', entrants: b.entrants.map(entrant), order: [...b.order], bronzeCount: b.bronzeCount, seed: b.seed };
  return {
    kind: 'combat',
    format: b.format,
    entrants: b.entrants.map(entrant),
    matches: b.matches.map(copyMatch),
    ...(b.pools ? { pools: b.pools.map((p) => [...p]) } : {}),
    options: { repechage: b.options.repechage, thirdPlace: b.options.thirdPlace },
    seed: b.seed,
  };
}

const copyResult = (r: MatchResult): MatchResult => ({ winner: r.winner, method: r.method, ...(r.score ? { score: r.score } : {}) });

const copyPodium = (p: Podium): Podium => ({
  first: p.first,
  second: p.second,
  thirds: [...p.thirds],
  complete: p.complete,
  ties: p.ties.map((t) => [...t]),
  ...(p.tieScopes ? { tieScopes: [...p.tieScopes] } : {}),
});

function copyNotes(notes: Record<string, number[]>, ids: string[]): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const id of ids) if (notes[id]) out[id] = notes[id]!.map(Number);
  return out;
}

/** « MARTIN L. » : nom et initiale du prénom. */
function shortNameOf(lastName: string, firstName: string): string {
  const initial = Array.from(firstName.trim())[0];
  return initial ? `${lastName} ${initial}.`.trim() : lastName.trim();
}

/** État d'une catégorie publique pour ses files. */
interface CategoryState {
  matches: ResolvedMatch[];
  progress: CategoryProgress;
  /** Tour 1 du kata noté pour chaque kataka présent. */
  round1Done: boolean;
}

/**
 * Vue publique d'une compétition, en liste blanche : seulement les catégories d'une vague lancée, leurs inscrits (nom
 * remplacé par « Combattant masqué » s'il est masqué), leurs tableaux, résultats, numéros et files de zone.
 */
export function toPublicCompetition(src: PublicSource): PublicCompetition {
  const launchedWaves = new Set(src.launchedWaveKeys);
  const launchedCats = new Set(src.launchedCategoryIds);
  const waves = src.waves.length === 0
    ? [{ id: null, name: IMPLICIT_WAVE, launched: launchedWaves.has(waveKey(null)) }]
    : [...src.waves].sort((a, b) => a.order - b.order).map((w) => ({ id: w.id, name: w.name, launched: launchedWaves.has(w.id) }));
  const launchedWaveIds = new Set(waves.filter((w) => w.launched).map((w) => waveKey(w.id)));

  // À disputer comme pour l'organisation (`playableCategory` : un tableau et au moins 2 combattants), numérotée et dans une
  // vague actuellement lancée.
  const cats = src.categories.filter(
    (c): c is Category & { bracket: Bracket } => !!c.bracket && activeEntrantCount(c) >= 2 && launchedCats.has(c.id) && launchedWaveIds.has(waveKey(c.waveId)),
  );
  const publicIds = new Set(cats.map((c) => c.id));

  // Inscrits des catégories publiques.
  const fighters = new Map(src.fighters.map((f) => [f.id, f]));
  const clubs = new Map(src.clubs.map((c) => [c.id, c]));
  const registrations = new Map(src.registrations.map((r) => [r.id, r]));
  const entrants: Record<string, PublicEntrant> = {};
  const entrantOf = (rid: string): PublicEntrant => {
    const known = entrants[rid];
    if (known) return known;
    const f = fighters.get(registrations.get(rid)?.fighterId ?? '');
    const clubId = f?.clubId ?? null;
    const club = (clubId && clubs.get(clubId)?.name) || NO_CLUB;
    const hidden = !!f?.publicNameHidden;
    const name = !f ? '?' : hidden ? HIDDEN_NAME : `${f.lastName} ${f.firstName}`.trim();
    const shortName = !f ? '?' : hidden ? HIDDEN_NAME : shortNameOf(f.lastName, f.firstName);
    const e: PublicEntrant = { registrationId: rid, fighterId: f && !hidden ? f.id : null, name, shortName, club, clubId, hidden };
    entrants[rid] = e;
    return e;
  };
  for (const c of cats) for (const rid of new Set([...c.registrationIds, ...c.bracket.entrants.map((e) => e.registrationId)])) entrantOf(rid);
  const publicEntrant = (e: Entrant): Entrant => {
    const p = entrantOf(e.registrationId);
    return { registrationId: p.registrationId, clubId: p.clubId, label: p.name };
  };

  // Passages des catégories publiques, dans l'ordre des zones.
  const zoneOrder = new Map(src.zones.map((z) => [z.id, z.order]));
  const zoneName = new Map(src.zones.map((z) => [z.id, z.name]));
  const planZones = src.plan.zones
    .filter((z) => zoneOrder.has(z.zoneId))
    .sort((a, b) => zoneOrder.get(a.zoneId)! - zoneOrder.get(b.zoneId)!)
    .map((z) => ({ zoneId: z.zoneId, passages: z.passages.filter((p) => publicIds.has(p.categoryId)).sort((a, b) => a.number - b.number) }));
  const numberOf = new Map(planZones.flatMap((z) => z.passages.map((p) => [`${p.categoryId}:${p.matchId ?? 'kata'}`, { number: p.number, zoneId: z.zoneId }] as const)));

  const empty: PublicCategoryResults = { records: [], kataScores: null, tieBreaks: { pools: {}, kata: [], kataFinal: [] } };
  const states = new Map<string, CategoryState>();
  const categories: PublicCategory[] = cats.map((c) => {
    const res = src.results[c.id] ?? empty;
    const tb = res.tieBreaks;
    const progress = categoryProgress(c.bracket, res.records, res.kataScores, tb.pools, tb.kata, tb.kataFinal);
    let results: Record<string, MatchResult> = {};
    let matches: ResolvedMatch[] = [];
    let kataScores: KataScores | null = null;
    let round1Done = false;
    if (c.bracket.kind === 'combat') {
      results = validResults(c.bracket, res.records, tb.pools).results;
      matches = resolveBracket(c.bracket, results, tb.pools).matches;
    } else {
      const scores = res.kataScores ?? { round1: {}, final: {} };
      kataScores = { round1: copyNotes(scores.round1, c.bracket.order), final: copyNotes(scores.final, c.bracket.order) };
      round1Done = c.bracket.entrants.filter((e) => !c.absentIds.includes(e.registrationId)).every((e) => (scores.round1[e.registrationId] ?? []).length > 0);
    }
    states.set(c.id, { matches, progress, round1Done });

    const zoneId = src.plan.categories[c.id]?.zoneId ?? null;
    const finals = c.bracket.kind === 'combat' ? finalMatchIds(c.bracket) : [];
    const numbers: Record<string, number> = {};
    const matchZones: Record<string, string> = {};
    for (const z of planZones) {
      for (const p of z.passages) {
        if (p.categoryId !== c.id) continue;
        numbers[p.matchId ?? 'kata'] = p.number;
        const kata = p.matchId === null || p.matchId.startsWith('kata:');
        if (!kata && z.zoneId !== zoneId) {
          const name = zoneName.get(z.zoneId) ?? '?';
          matchZones[p.matchId!] = finals.includes(p.matchId!) ? `Zone des finales : ${name}` : `Joué sur : ${name}`;
        }
      }
    }
    // Sur les résultats valables seulement : un résultat écarté (ancien tableau) ne fait pas commencer la catégorie.
    const status = progress.status === 'finished' ? 'finished' : progress.played > 0 ? 'started' : 'upcoming';
    return {
      id: c.id,
      label: c.label,
      discipline: c.key.discipline,
      waveId: c.waveId,
      zoneId,
      status,
      finishedAt: status === 'finished' ? (src.lastResultAt[c.id] ?? null) : null,
      bracket: copyBracket(c.bracket, publicEntrant),
      registrationIds: [...c.registrationIds],
      absentIds: [...c.absentIds],
      results: Object.fromEntries(Object.entries(results).map(([id, r]) => [id, copyResult(r)])),
      kataScores,
      tieBreaks: {
        pools: Object.fromEntries(Object.entries(tb.pools).map(([p, order]) => [Number(p), [...order]])),
        kata: [...tb.kata],
        kataFinal: [...tb.kataFinal],
      },
      numbers,
      matchZones,
      podium: copyPodium(progress.podium),
    };
  });

  const bracketOf = new Map(cats.map((c) => [c.id, c.bracket]));
  const from = (categoryId: string, side: SlotSource, known: string | null): SideSource | null => {
    if (known !== null || (side.kind !== 'winner' && side.kind !== 'loser')) return null;
    const origin = numberOf.get(`${categoryId}:${side.matchId}`);
    return { kind: side.kind, number: origin?.number ?? null, zoneId: origin?.zoneId ?? null };
  };
  const queues = planZones
    .map((z) => ({
      zoneId: z.zoneId,
      items: z.passages.flatMap((p): PublicQueueItem[] => {
        const st = states.get(p.categoryId)!;
        const bracket = bracketOf.get(p.categoryId)!;
        // Sur la zone des finales, les finales de la vague passent à la fin de sa file (voir `planPassages`).
        const finals = z.zoneId === (src.finalsZoneId ?? null) && (p.matchId === 'kata:finale' || (bracket.kind === 'combat' && p.matchId !== null && finalMatchIds(bracket).includes(p.matchId)));
        const base = { number: p.number, categoryId: p.categoryId, waveId: p.waveId, finals };
        // Bloc de kata, comme dans la file de l'organisation : terminé avec la catégorie (ou le tour 1 noté).
        if (p.matchId === null || p.matchId.startsWith('kata:')) {
          const kataPart = p.matchId === 'kata:tour1' ? ('tour1' as const) : p.matchId === 'kata:finale' ? ('finale' as const) : null;
          const done = st.progress.status === 'finished' || (kataPart === 'tour1' && st.round1Done);
          const needsRound1 = kataPart === 'finale' && bracket.kind === 'kata' && bracket.order.length > 2 && !st.round1Done;
          const state = done ? 'played' : needsRound1 ? 'waiting' : 'ready';
          return [{ ...base, matchId: null, kataPart, a: null, b: null, aFrom: null, bFrom: null, state }];
        }
        const m = st.matches.find((x) => x.id === p.matchId);
        // Exemption, ou 3e manche d'un meilleur des trois devenue inutile : rien à disputer.
        if (!m || m.bye || (m.optional && !m.playable && st.progress.podium.complete)) return [];
        const state = m.result ? 'played' : m.playable ? 'ready' : 'waiting';
        return [{
          ...base,
          matchId: m.id,
          kataPart: null,
          a: m.entrantA,
          b: m.entrantB,
          aFrom: from(p.categoryId, m.a, m.entrantA),
          bFrom: from(p.categoryId, m.b, m.entrantB),
          state,
        }];
      }),
    }))
    .filter((q) => q.items.length > 0);

  const shownZones = new Set([...queues.map((q) => q.zoneId), ...categories.map((c) => c.zoneId).filter((z): z is string => z !== null)]);
  const zones = [...src.zones].sort((a, b) => a.order - b.order).filter((z) => shownZones.has(z.id)).map((z) => ({ id: z.id, name: z.name }));

  // Décompte par club des podiums complets (comme la page Résultats de l'organisation).
  const medals = medalTable(
    categories.filter((c) => c.podium.complete && states.get(c.id)!.progress.played > 0),
    (rid) => ({ id: entrants[rid]?.clubId ?? null, name: entrants[rid]?.club ?? NO_CLUB }),
  ).map((r) => ({ clubId: r.clubId, club: r.club, gold: r.gold, silver: r.silver, bronze: r.bronze }));

  return {
    id: src.competition.id,
    name: src.competition.name,
    date: src.competition.date,
    location: src.competition.location,
    phase: publicPhase(src.competition.date, src.today, waves.some((w) => w.launched)),
    waves,
    zones,
    entrants,
    categories,
    queues,
    medals,
  };
}
