/** Ligne de temps des zones (spec §5.3) : pure, en secondes depuis minuit (Paris) du jour de la compétition. */

export interface TimelineItem {
  key: string;
  waveKey: string;
  durationSec: number;
  /** Heure de fin du résultat saisi ; null : pas encore joué. */
  endedAt: number | null;
  finals: boolean;
}

export interface TimelineInput {
  now: number | null;
  changeoverSec: number;
  finalsZoneId: string | null;
  /** Sessions lancées, dans l'ordre. */
  waves: { key: string; plannedStart: number | null; actualStart: number | null; finalsStart: number | null }[];
  /** Passages de chaque zone dans l'ordre de la file, toutes sessions mêlées. */
  zones: { zoneId: string; items: TimelineItem[] }[];
}

export interface Timeline {
  starts: Map<string, number>;
  waveStarts: Map<string, { at: number; estimated: boolean } | null>;
  finalsStarts: Map<string, number>;
}

export function buildTimeline(input: TimelineInput): Timeline {
  const { now, changeoverSec, finalsZoneId } = input;
  const starts = new Map<string, number>();
  const waveStarts: Timeline['waveStarts'] = new Map();
  const finalsStarts = new Map<string, number>();

  for (const w of input.waves) {
    const played = input.zones.flatMap((z) => z.items).filter((i) => i.waveKey === w.key && i.endedAt !== null);
    const estimate = played.length > 0 ? Math.min(...played.map((i) => i.endedAt! - i.durationSec)) : null;
    const begin: { at: number; estimated: boolean } | null =
      w.actualStart !== null ? { at: w.actualStart, estimated: false }
      : estimate !== null ? { at: estimate, estimated: true }
      : w.plannedStart !== null ? { at: w.plannedStart, estimated: false }
      : null;
    waveStarts.set(w.key, begin);
    const started = w.actualStart !== null || played.length > 0;
    const floor = started && now !== null ? now : -Infinity;

    // État par zone : curseur (null : pas d'heures) et fin la plus tardive des passages joués.
    const cursor = new Map<string, number | null>();
    const lastEnd = new Map<string, number | null>();
    const lines = input.zones.map((z) => ({ zoneId: z.zoneId, items: z.items.filter((i) => i.waveKey === w.key) }));
    for (const l of lines) { cursor.set(l.zoneId, begin ? begin.at : null); lastEnd.set(l.zoneId, null); }
    const nonFinalsEnds: number[] = [];

    const place = (zoneId: string, it: TimelineItem): number | null => {
      if (it.endedAt !== null) {
        const start = it.endedAt - it.durationSec;
        const end = Math.max(lastEnd.get(zoneId) ?? -Infinity, it.endedAt);
        lastEnd.set(zoneId, end);
        cursor.set(zoneId, end + changeoverSec);
        starts.set(it.key, start);
        return start;
      }
      const c = cursor.get(zoneId) ?? null;
      if (c === null) return null;
      const start = Math.max(c, floor);
      cursor.set(zoneId, start + it.durationSec + changeoverSec);
      starts.set(it.key, start);
      return start;
    };

    // Passe A : jusqu'à la première finale sur la zone des finales, tout sur les autres zones.
    const rest = new Map<string, TimelineItem[]>();
    for (const l of lines) {
      let cut = l.items.length;
      if (l.zoneId === finalsZoneId) {
        const f = l.items.findIndex((i) => i.finals);
        if (f >= 0) cut = f;
      }
      for (const it of l.items.slice(0, cut)) {
        const s = place(l.zoneId, it);
        if (!it.finals) {
          if (it.endedAt !== null) nonFinalsEnds.push(it.endedAt);
          else if (s !== null) nonFinalsEnds.push(s + it.durationSec);
        }
      }
      rest.set(l.zoneId, l.items.slice(cut));
    }

    // Passe B : la suite de la zone des finales.
    for (const l of lines) {
      let waited = false;
      for (const it of rest.get(l.zoneId) ?? []) {
        if (it.finals && it.endedAt === null && !waited) {
          waited = true;
          const base = w.finalsStart ?? (nonFinalsEnds.length > 0 ? Math.max(...nonFinalsEnds) : null);
          if (base !== null) cursor.set(l.zoneId, Math.max(cursor.get(l.zoneId) ?? -Infinity, base));
          const s = place(l.zoneId, it);
          if (s !== null) finalsStarts.set(w.key, s);
        } else {
          place(l.zoneId, it);
        }
      }
    }
  }
  return { starts, waveStarts, finalsStarts };
}

/**
 * Avance / retard d'une zone : départ estimé du prochain passage non joué moins son départ avec les seules heures
 * prévues (positif = en retard). null si l'un des deux manque ou si la zone est terminée.
 */
export function zoneDrift(input: TimelineInput, zoneId: string): number | null {
  const zone = input.zones.find((z) => z.zoneId === zoneId);
  const next = zone?.items.find((i) => i.endedAt === null);
  if (!next) return null;
  const planned = buildTimeline({
    ...input,
    now: null,
    waves: input.waves.map((w) => ({ ...w, actualStart: null })),
    zones: input.zones.map((z) => ({ zoneId: z.zoneId, items: z.items.map((i) => ({ ...i, endedAt: null })) })),
  });
  const a = buildTimeline(input).starts.get(next.key);
  const p = planned.starts.get(next.key);
  return a === undefined || p === undefined ? null : a - p;
}
