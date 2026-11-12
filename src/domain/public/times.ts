import { finalMatchIds, waveKey } from '../passages/index.js';
import { clockToSeconds, isoToDaySeconds, secondsToClock } from '../schedule/clock.js';
import { buildTimeline, zoneDrift, type TimelineInput } from '../schedule/timeline.js';
import { isClock } from '../schedule/types.js';
import { passageKey, type PublicCompetition } from './types.js';

/** Heures calculées d'une vue publique (spec §5.3). Tout est null pour une compétition passée. */
export interface PublicTimes {
  /**
   * Heure de départ estimée d'un passage (`passageKey`), « H:MM » : seulement si elle est après maintenant. Un départ déjà passé
   * est celui du combat sur le tatami (« À suivre », ou un passage sauté quand un résultat est saisi en retard) : jamais
   * d'heure dépassée à l'écran.
   */
  at(key: string): string | null;
  /** Démarrage d'une session : saisi, ou estimé d'après le premier résultat ; null sinon. */
  waveStart(waveId: string | null): { clock: string; estimated: boolean } | null;
  /** Départ estimé des finales « Fin de session » de la zone des finales d'une session, « H:MM » : seulement s'il est après maintenant. */
  finalsAt(waveId: string | null): string | null;
  /**
   * Heure estimée de la finale d'une catégorie (bloc de finale d'un kata, ou bloc entier) : le premier passage de finale pas
   * encore joué (au meilleur des trois : le premier combat de la série restant) ; null une fois la finale jouée ou sur le tatami.
   */
  categoryFinalAt(categoryId: string): string | null;
  /** Avance (négatif) ou retard (positif) d'une zone, en minutes arrondies. */
  drift(zoneId: string): number | null;
}

const NONE: PublicTimes = { at: () => null, waveStart: () => null, finalsAt: () => null, categoryFinalAt: () => null, drift: () => null };

/** Heure d'une session en secondes ; absente ou illisible (pas HH:MM) : null, jamais « NaN:NaN ». */
const orNull = (hhmm: string | null) => (hhmm !== null && isClock(hhmm) ? clockToSeconds(hhmm) : null);

/** `now` : secondes depuis minuit le jour de la compétition (`nowOnDay`), null hors de ce jour. */
export function publicTimes(pub: PublicCompetition, now: number | null): PublicTimes {
  if (pub.phase === 'past') return NONE;
  const launched = pub.waves.filter((w) => w.launched);
  const order = new Map(launched.map((w, i) => [waveKey(w.id), i]));
  // Une finale « Dès que finie » jouée hors de la zone de sa catégorie attend la fin des passages non finaux de celle-ci.
  const zoneOf = new Map(pub.categories.map((c) => [c.id, c.zoneId]));
  const nonFinals = new Map<string, string[]>();
  for (const i of pub.queues.flatMap((q) => q.items)) if (i.finals === null) nonFinals.set(i.categoryId, [...(nonFinals.get(i.categoryId) ?? []), passageKey(i)]);
  const input: TimelineInput = {
    now,
    changeoverSec: pub.changeoverSec,
    waves: launched.map((w) => ({
      key: waveKey(w.id),
      plannedStart: orNull(w.plannedStart),
      actualStart: orNull(w.actualStart),
      finalsStart: orNull(w.finalsStart),
      finalsZoneId: pub.finalsZones[waveKey(w.id)] ?? null,
    })),
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
          ...(i.finals === 'ready' && zoneOf.get(i.categoryId) !== q.zoneId ? { waitsFor: nonFinals.get(i.categoryId) ?? [] } : {}),
        })),
    })),
  };
  const timeline = buildTimeline(input);
  /** Une heure à afficher : jamais une heure déjà passée le jour J. */
  const shown = (s: number | undefined) => (s === undefined || (now !== null && s <= now) ? null : secondsToClock(s));
  return {
    at: (key) => shown(timeline.starts.get(key)),
    waveStart: (waveId) => {
      const w = timeline.waveStarts.get(waveKey(waveId));
      return w ? { clock: secondsToClock(w.at), estimated: w.estimated } : null;
    },
    finalsAt: (waveId) => shown(timeline.finalsStarts.get(waveKey(waveId))),
    categoryFinalAt: (categoryId) => {
      const c = pub.categories.find((x) => x.id === categoryId);
      if (!c) return null;
      const items = pub.queues.flatMap((q) => q.items).filter((i) => i.categoryId === categoryId);
      const unplayed = (list: typeof items) => list.filter((i) => i.endedAt === null);
      let wanted: typeof items;
      if (c.bracket.kind === 'combat') {
        const finals = finalMatchIds(c.bracket);
        wanted = items.filter((i) => i.matchId !== null && finals.includes(i.matchId));
      } else {
        const finale = items.filter((i) => i.kataPart === 'finale');
        wanted = finale.length > 0 ? finale : items.filter((i) => i.kataPart === null);
      }
      const starts = unplayed(wanted).map((i) => timeline.starts.get(passageKey(i))).filter((s): s is number => s !== undefined);
      return starts.length > 0 ? shown(Math.min(...starts)) : null;
    },
    drift: (zoneId) => {
      const d = zoneDrift(input, zoneId);
      return d === null ? null : Math.round(d / 60);
    },
  };
}
