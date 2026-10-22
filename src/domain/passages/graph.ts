import { resolveBracket, type CombatBracket, type Match, type MatchPhase, type SlotSource } from '../brackets/index.js';

/** Combat numéroté d'un tableau. `feeds` : combats numérotés du même tableau joués avant lui et qui peuvent lui fournir un combattant. */
export interface MatchNode {
  matchId: string;
  phase: MatchPhase;
  order: number;
  /** 0 s'il ne fournit aucun combattant à un autre combat ; sinon 1 + la plus grande distance des combats qu'il fournit. */
  distance: number;
  feeds: string[];
}

const entrantsOf = (m: Match) => [m.a, m.b].flatMap((s) => (s.kind === 'entrant' ? [s.registrationId] : []));

/**
 * Combats à numéroter (exemptions connues sans aucun résultat exclues), avec leurs dépendances : l'ordre de passage
 * se calcule sur la structure du tableau, jamais sur les résultats.
 */
export function matchNodes(bracket: CombatBracket): MatchNode[] {
  if (bracket.entrants.length < 2) return [];
  const byes = new Set(resolveBracket(bracket, {}).matches.filter((m) => m.bye).map((m) => m.id));
  const numbered = bracket.matches.filter((m) => !byes.has(m.id));
  const ids = new Set(numbered.map((m) => m.id));
  const main = bracket.matches.filter((m) => m.phase === 'main');
  const mainRounds = Math.max(0, ...main.map((m) => m.round));
  const byId = new Map(bracket.matches.map((m) => [m.id, m]));

  const fromSource = (src: SlotSource): string[] => {
    switch (src.kind) {
      case 'winner':
      case 'loser': {
        // Une exemption est transparente : son combattant vient de ses propres sources.
        const m = byId.get(src.matchId)!;
        return byes.has(m.id) ? [...fromSource(m.a), ...fromSource(m.b)] : [m.id];
      }
      case 'poolRank':
        return bracket.matches.filter((m) => m.phase === 'pool' && m.pool === src.pool).map((m) => m.id);
      case 'beatenBy': {
        // Battu par le finaliste de la moitié `half` : un des combats de ce tour dans cette moitié ; on ne le connaît
        // qu'une fois ce finaliste désigné (demi-finale de la moitié).
        const round = main.filter((m) => m.round === src.round);
        const half = round.length / 2;
        const beaten = round.filter((m) => Math.floor(Number(m.id.split('-')[1]) / half) === src.half).map((m) => m.id);
        return [...beaten, ...fromSource({ kind: 'winner', matchId: `w${mainRounds - 1}-${src.half}` })];
      }
      default:
        return [];
    }
  };
  // Poules et meilleur des trois : les journées (manches) précédentes qui partagent un combattant.
  const earlierShared = (m: Match): string[] =>
    m.phase !== 'pool' && m.phase !== 'series'
      ? []
      : numbered
          .filter((x) => x.phase === m.phase && x.pool === m.pool && x.round < m.round && entrantsOf(x).some((e) => entrantsOf(m).includes(e)))
          .map((x) => x.id);

  const feeds = new Map(numbered.map((m) => [m.id, [...new Set([...fromSource(m.a), ...fromSource(m.b), ...earlierShared(m)])].filter((id) => ids.has(id))]));
  const dependents = new Map<string, string[]>();
  for (const [id, list] of feeds) for (const f of list) dependents.set(f, [...(dependents.get(f) ?? []), id]);
  const memo = new Map<string, number>();
  const distance = (id: string): number => {
    if (!memo.has(id)) memo.set(id, Math.max(-1, ...(dependents.get(id) ?? []).map(distance)) + 1);
    return memo.get(id)!;
  };
  return numbered.map((m) => ({ matchId: m.id, phase: m.phase, order: m.order, distance: distance(m.id), feeds: feeds.get(m.id)! }));
}
