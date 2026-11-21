import type { Bracket } from '../brackets/index.js';
import { finalMatchIds, kataFinaleKey, waveKey } from '../passages/index.js';
import { publicTimes } from '../public/times.js';
import { passageKey, type PublicCompetition, type PublicQueueItem } from '../public/types.js';
import { clockToSeconds } from './clock.js';

/** Heure d'un passage côté organisation : sur le tatami, ou « vers H:MM » (`planned` : estimation d'une session pas encore lancée). */
export type PassageTime = { kind: 'onTatami' } | { kind: 'at'; clock: string; planned: boolean };

/** Heures d'une catégorie : `first` = aucun de ses passages n'est joué ; prochain passage et prochaine finale à venir. */
export interface CategoryTimes {
  first: boolean;
  next: PassageTime | null;
  final: PassageTime | null;
}

export interface OrganiserTimes {
  /** Heure d'un passage ; null : joué, sauté, sans heure connue ou compétition passée. */
  passage(categoryId: string, matchId: string): PassageTime | null;
  /** Heure brute du passage (même dépassée) : carte « À l'appel ». */
  onCall(categoryId: string, matchId: string): string | null;
  category(c: { id: string; bracket: Bracket | null }): CategoryTimes | null;
  /** Avance (négatif) ou retard (positif) d'une zone, en minutes ; null hors compétition lancée. */
  drift(zoneId: string): number | null;
  /** Session présente et lancée dans la vue des heures (session implicite : `waveId` null). */
  waveLaunched(waveId: string | null): boolean;
}

const NONE: OrganiserTimes = { passage: () => null, onCall: () => null, category: () => null, drift: () => null, waveLaunched: () => false };

/**
 * Heures présumées côté organisation : celles de la page publique pour les sessions lancées (jamais une heure passée, sauf
 * `onCall`), les heures prévues (`planned`, clé `passageKey`) pour les autres.
 */
export function organiserTimes(pub: PublicCompetition | null, planned: Record<string, string> | null, now: number | null): OrganiserTimes {
  if (!pub || pub.phase === 'past') return NONE;
  const times = publicTimes(pub, now);
  const plan = planned ?? {};
  // Sessions lancées : même ordre que publicTimes (ordre des sessions puis de la file).
  const launched = pub.waves.filter((w) => w.launched);
  const order = new Map(launched.map((w, i) => [waveKey(w.id), i]));
  const items: PublicQueueItem[] = pub.queues.flatMap((q) => q.items.filter((i) => order.has(waveKey(i.waveId))));
  const inQueue = new Set(items.map(passageKey));
  // Premier passage sans résultat de chaque zone : celui qui est sur le tatami.
  const onTatami = new Set<string>();
  for (const q of pub.queues) {
    const first = q.items
      .map((i, idx) => ({ i, idx }))
      .filter(({ i }) => order.has(waveKey(i.waveId)) && i.endedAt === null)
      .sort((a, b) => order.get(waveKey(a.i.waveId))! - order.get(waveKey(b.i.waveId))! || a.idx - b.idx)[0];
    if (first) onTatami.add(passageKey(first.i));
  }

  const passage = (categoryId: string, matchId: string): PassageTime | null => {
    const key = `${categoryId}:${matchId}`;
    const item = items.find((i) => passageKey(i) === key);
    if (item) {
      if (item.endedAt !== null) return null;
      if (onTatami.has(key)) return { kind: 'onTatami' };
      const clock = times.at(key);
      return clock === null ? null : { kind: 'at', clock, planned: false };
    }
    const clock = plan[key];
    return inQueue.has(key) || clock === undefined ? null : { kind: 'at', clock, planned: true };
  };

  /** Rang d'un passage à venir dans l'ordre des heures (le brut pour une session lancée, même dépassé). */
  const rank = (key: string): number => {
    const clock = inQueue.has(key) ? times.rawAt(key) : (plan[key] ?? null);
    return clock === null ? Infinity : clockToSeconds(clock);
  };

  return {
    passage,
    onCall: (categoryId, matchId) => times.rawAt(`${categoryId}:${matchId}`),
    category: (c) => {
      const prefix = `${c.id}:`;
      const own = items.filter((i) => i.categoryId === c.id);
      const keys = [
        ...own.filter((i) => i.endedAt === null).map((i) => i.matchId),
        ...Object.keys(plan).filter((k) => k.startsWith(prefix) && !inQueue.has(k)).map((k) => k.slice(prefix.length)),
      ].sort((a, b) => rank(prefix + a) - rank(prefix + b));
      const upcoming = keys.map((matchId) => ({ matchId, time: passage(c.id, matchId) })).filter((p) => p.time !== null);
      const finals = c.bracket === null ? [] : c.bracket.kind === 'combat' ? finalMatchIds(c.bracket) : [kataFinaleKey(1), kataFinaleKey(2)];
      const next = upcoming[0]?.time ?? null;
      const final = upcoming.find((p) => finals.includes(p.matchId))?.time ?? null;
      if (next === null && final === null) return null;
      return { first: own.every((i) => i.endedAt === null), next, final };
    },
    drift: (zoneId) => times.drift(zoneId),
    waveLaunched: (waveId) => order.has(waveKey(waveId)),
  };
}
