import { finalMatchIds, waveKey } from '../passages/index.js';
import { clockToSeconds, isoToDaySeconds, secondsToClock } from '../schedule/clock.js';
import { buildTimeline, zoneDrift, type TimelineInput } from '../schedule/timeline.js';
import { passageKey, type PublicCompetition } from './types.js';

/** Heures calculées d'une vue publique (spec §5.3). Tout est null pour une compétition passée. */
export interface PublicTimes {
  /** Heure de départ estimée d'un passage (`passageKey`), « H:MM ». */
  at(key: string): string | null;
  /** Démarrage d'une session : saisi, ou estimé d'après le premier résultat ; null sinon. */
  waveStart(waveId: string | null): { clock: string; estimated: boolean } | null;
  /** Départ estimé des finales d'une session, « H:MM ». */
  finalsAt(waveId: string | null): string | null;
  /** Heure estimée de la finale d'une catégorie (bloc de finale d'un kata, ou bloc entier). */
  categoryFinalAt(categoryId: string): string | null;
  /** Avance (négatif) ou retard (positif) d'une zone, en minutes arrondies. */
  drift(zoneId: string): number | null;
}

const NONE: PublicTimes = { at: () => null, waveStart: () => null, finalsAt: () => null, categoryFinalAt: () => null, drift: () => null };

const orNull = (hhmm: string | null) => (hhmm === null ? null : clockToSeconds(hhmm));

/** `now` : secondes depuis minuit le jour de la compétition (`nowOnDay`), null hors de ce jour. */
export function publicTimes(pub: PublicCompetition, now: number | null): PublicTimes {
  if (pub.phase === 'past') return NONE;
  const launched = pub.waves.filter((w) => w.launched);
  const order = new Map(launched.map((w, i) => [waveKey(w.id), i]));
  const input: TimelineInput = {
    now,
    changeoverSec: pub.changeoverSec,
    finalsZoneId: pub.finalsZoneId,
    waves: launched.map((w) => ({ key: waveKey(w.id), plannedStart: orNull(w.plannedStart), actualStart: orNull(w.actualStart), finalsStart: orNull(w.finalsStart) })),
    // Ordre des sessions puis ordre de la file : les numéros peuvent reprendre à 1 dans une session.
    zones: pub.queues.map((q) => ({
      zoneId: q.zoneId,
      items: q.items
        .filter((i) => order.has(waveKey(i.waveId)))
        .map((i, idx) => ({ i, idx }))
        .sort((a, b) => order.get(waveKey(a.i.waveId))! - order.get(waveKey(b.i.waveId))! || a.idx - b.idx)
        .map(({ i }) => ({
          key: passageKey(i),
          waveKey: waveKey(i.waveId),
          durationSec: i.durationSec,
          endedAt: i.endedAt === null ? null : isoToDaySeconds(i.endedAt, pub.date),
          finals: i.finals,
        })),
    })),
  };
  const timeline = buildTimeline(input);
  const at = (key: string) => {
    const s = timeline.starts.get(key);
    return s === undefined ? null : secondsToClock(s);
  };
  return {
    at,
    waveStart: (waveId) => {
      const w = timeline.waveStarts.get(waveKey(waveId));
      return w ? { clock: secondsToClock(w.at), estimated: w.estimated } : null;
    },
    finalsAt: (waveId) => {
      const s = timeline.finalsStarts.get(waveKey(waveId));
      return s === undefined ? null : secondsToClock(s);
    },
    categoryFinalAt: (categoryId) => {
      const c = pub.categories.find((x) => x.id === categoryId);
      if (!c) return null;
      const items = pub.queues.flatMap((q) => q.items).filter((i) => i.categoryId === categoryId);
      let wanted: typeof items;
      if (c.bracket.kind === 'combat') {
        const finals = finalMatchIds(c.bracket);
        wanted = items.filter((i) => i.matchId !== null && finals.includes(i.matchId));
      } else {
        const finale = items.filter((i) => i.kataPart === 'finale');
        wanted = finale.length > 0 ? finale : items.filter((i) => i.kataPart === null);
      }
      const starts = wanted.map((i) => timeline.starts.get(passageKey(i))).filter((s): s is number => s !== undefined);
      return starts.length > 0 ? secondsToClock(Math.max(...starts)) : null;
    },
    drift: (zoneId) => {
      const d = zoneDrift(input, zoneId);
      return d === null ? null : Math.round(d / 60);
    },
  };
}
