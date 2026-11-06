import { doubleElimination, firstRoundSlots, singleElimination } from './elimination.js';
import type { Bracket } from './index.js';
import { kataBracket } from './kata.js';
import { bestOfThree, poolsThenBracket, roundRobin, serpentinePools, singleMatch, threeWithRepechage } from './pools.js';
import { nextPowerOfTwo } from './seeding.js';
import type { BracketFormat, Entrant, SlotSource } from './types.js';

/** Identifiant d'inscription, ou exemption (null). */
type Place = string | null;

const isElimination = (f: BracketFormat) => f === 'single_elimination' || f === 'double_elimination' || f === 'single_match';
const placeOf = (s: SlotSource | undefined): Place => (s?.kind === 'entrant' ? s.registrationId : null);
const slotOf = (p: Place): SlotSource => (p === null ? { kind: 'bye' } : { kind: 'entrant', registrationId: p });

/**
 * Places du tableau précédent, et nombre de paires du 1er tour qu'elles contiennent (positions 0-1, 2-3…) :
 * cases du 1er tour (élimination, exemptions comprises), combats (meilleur des trois, trois avec repêchage),
 * poules aplaties, ordre de passage (kata).
 */
function previousPlaces(b: Bracket): { places: Place[]; pairCount: number } {
  if (b.kind === 'kata') return { places: b.order, pairCount: 0 };
  const match = (id: string) => b.matches.find((m) => m.id === id);
  if (isElimination(b.format) && b.matches.length > 0) {
    const places = b.matches.filter((m) => m.phase === 'main' && m.round === 1).flatMap((m) => [placeOf(m.a), placeOf(m.b)]);
    return { places, pairCount: places.length / 2 };
  }
  const s1 = match('s1');
  if (b.format === 'best_of_three' && s1) return { places: [placeOf(s1.a), placeOf(s1.b)], pairCount: 1 };
  const [m1, m2] = [match('m1'), match('m2')];
  if (b.format === 'three_with_repechage' && m1 && m2) return { places: [placeOf(m1.a), placeOf(m1.b), placeOf(m2.b)], pairCount: 1 };
  return { places: b.pools?.flat() ?? b.entrants.map((e) => e.registrationId), pairCount: 0 };
}

/** Ordre des joueurs pour que la méthode du cercle (circleMatches) oppose au 1er tour ids[0]–ids[1], ids[2]–ids[3]… */
function circleOrder(ids: string[]): string[] {
  const n = ids.length;
  const m = n + (n % 2);
  const seats: number[] = [];
  for (let i = n % 2; i < m / 2; i++) seats.push(i, m - 1 - i);
  if (n % 2) seats.push(0); // nombre impair : le dernier est au repos au 1er tour
  const players: string[] = [];
  seats.forEach((seat, k) => (players[seat] = ids[k]!));
  return players;
}

/** Parmi `candidates`, la première poule sans membre du club de `e` (sinon la première). */
const awayFromClub = (pools: string[][], candidates: number[], e: Entrant, byId: Map<string, Entrant>) =>
  candidates.find((i) => e.clubId === null || !pools[i]!.some((id) => byId.get(id)!.clubId === e.clubId)) ?? candidates[0]!;

/**
 * Anciennes poules moins les partants (même nombre de poules) ; chaque arrivant dans la plus petite (égalité : sans son
 * club, puis l'indice le plus bas). Pas gardées si une poule a moins de 2 membres.
 */
function keptPools(previous: Bracket, byId: Map<string, Entrant>, arrivals: Entrant[]): string[][] | null {
  if (previous.kind !== 'combat' || previous.format !== 'pools_then_bracket' || !previous.pools) return null;
  if (Math.max(1, Math.ceil(byId.size / 4)) !== previous.pools.length) return null;
  const pools = previous.pools.map((p) => p.filter((id) => byId.has(id)));
  for (const e of arrivals) {
    const min = Math.min(...pools.map((p) => p.length));
    pools[awayFromClub(pools, pools.flatMap((p, i) => (p.length === min ? [i] : [])), e, byId)]!.push(e.registrationId);
  }
  return byId.size >= 2 && pools.some((p) => p.length < 2) ? null : pools;
}

/**
 * Poules à refaire : tailles du serpentin ; les groupes à garder ensemble (paires gardées, ou anciennes poules) d'abord,
 * chacun dans la poule la plus libre (coupé seulement s'il n'y tient pas), puis les autres anciens, puis les arrivants
 * (poule la plus libre, sans leur club si possible). Sans groupe : serpentin de `sequence`.
 */
function poolLayout(previous: Bracket, byId: Map<string, Entrant>, arrivals: Entrant[], pairs: [string, string][], sequence: string[]): string[][] {
  const kept = keptPools(previous, byId, arrivals);
  if (kept) return kept;
  const groups: string[][] =
    previous.kind === 'combat' && previous.format === 'pools_then_bracket' && previous.pools
      ? previous.pools.map((p) => p.filter((id) => byId.has(id))).filter((g) => g.length > 0).sort((a, b) => b.length - a.length)
      : pairs;
  if (groups.length === 0) return serpentinePools(sequence);
  const capacity = serpentinePools(sequence).map((p) => p.length);
  const pools: string[][] = capacity.map(() => []);
  const room = (i: number) => capacity[i]! - pools[i]!.length;
  const roomiest = () => pools.reduce((best, _, i) => (room(i) > room(best) ? i : best), 0);
  for (const group of groups) {
    const rest = [...group];
    while (rest.length) {
      const i = roomiest();
      pools[i]!.push(...rest.splice(0, room(i)));
    }
  }
  const placed = new Set(groups.flat());
  const arriving = new Set(arrivals.map((e) => e.registrationId));
  for (const id of sequence) if (!placed.has(id) && !arriving.has(id)) pools[roomiest()]!.push(id);
  for (const e of arrivals) {
    const max = room(roomiest());
    pools[awayFromClub(pools, pools.flatMap((_, i) => (room(i) === max ? [i] : [])), e, byId)]!.push(e.registrationId);
  }
  return pools;
}

/**
 * Cases du 1er tour d'une élimination. Même nombre de places : anciennes cases, partants ➜ exemption, chaque arrivant
 * prend la première exemption face à un autre club, sinon face à un combattant, sinon la première (gardées s'il ne reste
 * aucun match exemption contre exemption). Sinon : exemptions
 * placées comme le tirage ; matchs complets remplis par les paires gardées puis par des isolés (en évitant le même
 * club) ; les paires qui ne tiennent plus au 1er tour vont dans deux matchs avec exemption voisins (elles se
 * rencontrent au 2e tour) ; les autres isolés prennent les exemptions restantes.
 */
function eliminationSlots(previous: Bracket, kept: Place[], pairs: [string, string][], arrivals: Entrant[], byId: Map<string, Entrant>): Place[] {
  const n = byId.size;
  const size = nextPowerOfTwo(n);
  const club = (id: string) => byId.get(id)!.clubId;
  const sameClub = (a: string, b: string) => club(a) !== null && club(a) === club(b);

  if (previous.kind === 'combat' && isElimination(previous.format) && kept.length === size) {
    const slots = [...kept];
    for (const e of arrivals) {
      const byes = slots.flatMap((p, i) => (p === null ? [i] : []));
      const facing = (i: number) => slots[i ^ 1] ?? null;
      const i =
        byes.find((i) => facing(i) !== null && !sameClub(e.registrationId, facing(i)!)) ?? byes.find((i) => facing(i) !== null) ?? byes[0]!;
      slots[i] = e.registrationId;
    }
    // Un match exemption contre exemption enverrait un combattant loin sans combattre : exemptions remises comme le tirage.
    if (!slots.some((p, i) => i % 2 === 0 && p === null && slots[i + 1] === null)) return slots;
  }

  const model = firstRoundSlots(Array.from({ length: n }, (_, i): SlotSource => ({ kind: 'entrant', registrationId: String(i) })));
  const full: number[] = [];
  const withBye: number[] = [];
  for (let k = 0; k < size / 2; k++) (model[2 * k]!.kind !== 'bye' && model[2 * k + 1]!.kind !== 'bye' ? full : withBye).push(k);
  const keptPairs = pairs.slice(0, full.length);
  const inKeptPair = new Set(keptPairs.flat());
  const loose = [...kept.filter((p): p is string => p !== null && !inKeptPair.has(p)), ...arrivals.map((e) => e.registrationId)];
  const slots: Place[] = Array.from({ length: size }, () => null);

  full.forEach((k, j) => {
    let pair = keptPairs[j];
    if (!pair) {
      const a = loose.shift()!;
      const other = loose.findIndex((b) => !sameClub(a, b));
      pair = [a, loose.splice(Math.max(0, other), 1)[0]!];
    }
    [slots[2 * k], slots[2 * k + 1]] = pair;
  });
  const free = new Set(withBye);
  const place = (k: number, id: string) => {
    slots[model[2 * k]!.kind === 'bye' ? 2 * k + 1 : 2 * k] = id;
    free.delete(k);
    loose.splice(loose.indexOf(id), 1);
  };
  for (const [a, b] of pairs.slice(full.length)) {
    const k = withBye.find((k) => k % 2 === 0 && free.has(k) && free.has(k + 1));
    if (k === undefined) break;
    place(k, a);
    place(k + 1, b);
  }
  for (const k of withBye) if (free.has(k)) place(k, loose[0]!);
  return slots;
}

/**
 * Refait un tableau arrangé à la main en gardant les places (qui rencontre qui en premier) : partants retirés,
 * arrivants (triés par inscription) glissés à la place la plus logique. Ne défait jamais un échange. Déterministe.
 */
export function keepPlaces(
  previous: Bracket,
  entrants: Entrant[],
  format: BracketFormat,
  options: { repechage: boolean; thirdPlace: boolean; kataBronzeCount: 1 | 2 },
  seed: number,
): Bracket {
  const byId = new Map(entrants.map((e) => [e.registrationId, e]));
  const { places, pairCount } = previousPlaces(previous);
  const kept = places.map((p) => (p !== null && byId.has(p) ? p : null));
  const known = new Set(places);
  const arrivals = entrants
    .filter((e) => !known.has(e.registrationId))
    .sort((a, b) => (a.registrationId < b.registrationId ? -1 : a.registrationId > b.registrationId ? 1 : 0));
  const pairs: [string, string][] = [];
  for (let k = 0; k < pairCount; k++) {
    const [a, b] = [kept[2 * k], kept[2 * k + 1]];
    if (a && b) pairs.push([a, b]);
  }
  const inPair = new Set(pairs.flat());
  const sequence = [...pairs.flat(), ...kept.filter((p): p is string => p !== null && !inPair.has(p)), ...arrivals.map((e) => e.registrationId)];
  const ents = (ids: string[]) => ids.map((id) => byId.get(id)!);
  /** Poule : les paires gardées se rencontrent au 1er tour ; sans paire, l'ordre des joueurs est gardé tel quel. */
  const roundRobinOrder = () => ents(pairs.length ? circleOrder(sequence) : sequence);
  const opts = { repechage: options.repechage, thirdPlace: options.thirdPlace };

  switch (format) {
    case 'kata_two_rounds':
      return kataBracket(entrants, options.kataBronzeCount, seed, ents(sequence));
    case 'best_of_three':
      return bestOfThree(entrants, seed, ents(sequence));
    case 'round_robin':
      return roundRobin(entrants, seed, roundRobinOrder());
    case 'three_with_repechage':
      return threeWithRepechage(entrants, seed, entrants.length === 3 ? ents(sequence) : roundRobinOrder());
    case 'pools_then_bracket':
      return poolsThenBracket(entrants, seed, opts, poolLayout(previous, byId, arrivals, pairs, sequence));
    case 'single_elimination':
    case 'double_elimination':
    case 'single_match': {
      const slots = entrants.length < 2 ? [] : eliminationSlots(previous, kept, pairs, arrivals, byId);
      const ordered = entrants.length < 2 ? entrants : ents(slots.filter((p): p is string => p !== null));
      const sources = slots.map(slotOf);
      if (format === 'single_elimination') return singleElimination(ordered, opts, seed, sources);
      return format === 'double_elimination' ? doubleElimination(ordered, seed, sources) : singleMatch(ordered, seed, sources);
    }
  }
}
