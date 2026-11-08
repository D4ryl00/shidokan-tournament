import { resolveBracket } from '../brackets/index.js';
import { resolveKata } from '../brackets/kata.js';
import { normalizeName } from '../names.js';
import type { FighterLine, PublicCategory, PublicCompetition, PublicFighter, PublicQueueItem } from './types.js';

export type { FighterLine, PublicFighter } from './types.js';

/** Combattants non masqués de la vue publique, avec leurs inscriptions (dans l'ordre des catégories). */
function publicFighters(pub: PublicCompetition): PublicFighter[] {
  const byId = new Map<string, PublicFighter>();
  for (const e of Object.values(pub.entrants)) {
    if (e.hidden || e.fighterId === null) continue;
    const f = byId.get(e.fighterId) ?? { fighterId: e.fighterId, name: e.name, club: e.club, clubId: e.clubId, registrationIds: [] };
    f.registrationIds.push(e.registrationId);
    byId.set(e.fighterId, f);
  }
  return [...byId.values()];
}

/**
 * Recherche par nom, prénom ou club, sans accents ni majuscules (au moins 2 caractères) ; chaque mot cherché doit se
 * trouver. Un combattant masqué n'est jamais trouvé, ni compté dans son club.
 */
export function searchPublic(pub: PublicCompetition, q: string): { clubs: { clubId: string; club: string; count: number }[]; fighters: PublicFighter[] } {
  const words = normalizeName(q).split(' ').filter(Boolean);
  if (words.join(' ').length < 2) return { clubs: [], fighters: [] };
  const matches = (text: string) => {
    const t = normalizeName(text);
    return words.every((w) => t.includes(w));
  };
  const all = publicFighters(pub);
  const clubs = new Map<string, { clubId: string; club: string; count: number }>();
  for (const f of all) {
    if (f.clubId === null || !matches(f.club)) continue;
    const c = clubs.get(f.clubId) ?? { clubId: f.clubId, club: f.club, count: 0 };
    c.count++;
    clubs.set(f.clubId, c);
  }
  const byName = (a: string, b: string) => a.localeCompare(b, 'fr');
  return {
    clubs: [...clubs.values()].sort((a, b) => byName(a.club, b.club)),
    fighters: all.filter((f) => matches(`${f.name} ${f.club}`)).sort((a, b) => byName(a.name, b.name)),
  };
}

/** Passage d'une file, avec sa zone et le nombre de passages non joués avant lui sur la zone. */
interface Located {
  zoneId: string;
  item: PublicQueueItem;
  before: number;
}

function located(pub: PublicCompetition, categoryId: string): Located[] {
  return pub.queues.flatMap((q) => {
    let before = 0;
    const out: Located[] = [];
    for (const item of q.items) {
      if (item.categoryId === categoryId) out.push({ zoneId: q.zoneId, item, before });
      if (item.state !== 'played') before++;
    }
    return out;
  });
}

function medalOf(c: PublicCategory, rid: string): 1 | 2 | 3 | null {
  const p = c.podium;
  if (p.ties.some((t) => t.includes(rid))) return null;
  return p.first === rid ? 1 : p.second === rid ? 2 : p.thirds.includes(rid) ? 3 : null;
}

function line(pub: PublicCompetition, c: PublicCategory, rid: string): FighterLine {
  const here = located(pub, c.id).filter((l) => l.item.state !== 'played');
  const played: FighterLine['played'] = [];
  let candidates: Located[];
  let lost = false;
  if (c.bracket.kind === 'combat') {
    const { matches } = resolveBracket(c.bracket, c.results, c.tieBreaks.pools);
    for (const m of [...matches].sort((x, y) => x.order - y.order)) {
      if (!m.result || (m.entrantA !== rid && m.entrantB !== rid)) continue;
      const mine = m.entrantA === rid ? 'a' : 'b';
      const other = mine === 'a' ? m.entrantB : m.entrantA;
      const won = m.result.winner === mine;
      if (!won) lost = true;
      played.push({ number: c.numbers[m.id] ?? null, opponent: other ? (pub.entrants[other]?.name ?? '?') : '?', won });
    }
    candidates = here.filter((l) => l.item.matchId !== null && (l.item.a === rid || l.item.b === rid));
  } else {
    // Finale de kata : seulement pour un finaliste connu (tour 1 noté, ou deux katakas).
    const scores = c.kataScores ?? { round1: {}, final: {} };
    const finalists = c.bracket.order.length <= 2 ? c.bracket.order : resolveKata(c.bracket, scores, c.tieBreaks.kata, c.tieBreaks.kataFinal).finalists;
    candidates = here.filter((l) => l.item.kataPart !== 'finale' || (l.item.state === 'ready' && finalists.includes(rid)));
  }
  if (c.absentIds.includes(rid)) candidates = [];
  // Un combat jouable d'abord, puis sur la zone de la catégorie (les finales viennent à la fin de la zone des finales).
  const rank = (l: Located) => [l.item.state === 'ready' ? 0 : 1, l.zoneId === c.zoneId ? 0 : 1, l.item.number];
  const best = [...candidates].sort((x, y) => {
    const [a, b] = [rank(x), rank(y)];
    return a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]!;
  })[0];
  let next: FighterLine['next'] = null;
  if (best) {
    const { item } = best;
    const mineA = item.a === rid;
    const other = item.matchId === null ? null : mineA ? item.b : item.a;
    const from = item.matchId === null ? null : mineA ? item.bFrom : item.aFrom;
    const entrant = other ? pub.entrants[other] : undefined;
    next = {
      number: item.number,
      zoneId: best.zoneId,
      before: best.before,
      opponent: entrant ? { name: entrant.name, club: entrant.club } : from ? { from: { kind: from.kind, number: from.number } } : null,
    };
  }
  const medal = medalOf(c, rid);
  let state: FighterLine['state'];
  if (medal) state = { medal };
  else if (c.absentIds.includes(rid)) state = 'finished';
  else if (next) state = 'upcoming';
  else if (c.status === 'finished') state = 'eliminated';
  else if (c.bracket.kind === 'combat' && c.bracket.format === 'single_elimination' && !c.bracket.options.repechage && lost) state = 'eliminated';
  else if (c.status === 'upcoming') state = 'upcoming';
  else state = 'waiting';
  return { categoryId: c.id, label: c.label, discipline: c.discipline, next, played, state };
}

/** Une ligne par catégorie publique du combattant (plusieurs disciplines : plusieurs lignes) ; masqué ou inconnu : aucune. */
export function fighterTimeline(pub: PublicCompetition, fighterId: string): FighterLine[] {
  const mine = new Set(Object.values(pub.entrants).filter((e) => !e.hidden && e.fighterId === fighterId).map((e) => e.registrationId));
  const lines: FighterLine[] = [];
  for (const c of pub.categories) {
    const rid = [...new Set([...c.registrationIds, ...c.bracket.entrants.map((e) => e.registrationId)])].find((id) => mine.has(id));
    if (rid) lines.push(line(pub, c, rid));
  }
  return lines;
}

/** File d'une zone : passages non joués dans l'ordre ; `next` le premier (jouable ou en attente d'un résultat). */
export function zoneQueue(pub: PublicCompetition, zoneId: string): { next: PublicQueueItem | null; following: PublicQueueItem[] } {
  const items = (pub.queues.find((q) => q.zoneId === zoneId)?.items ?? []).filter((i) => i.state !== 'played');
  return { next: items[0] ?? null, following: items.slice(1) };
}
