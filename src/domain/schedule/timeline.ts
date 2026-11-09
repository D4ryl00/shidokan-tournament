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
    // waveStarts : saisi ou estimé d'après le premier résultat, sinon null (l'heure prévue seule n'est pas un démarrage).
    const shown: { at: number; estimated: boolean } | null =
      w.actualStart !== null ? { at: w.actualStart, estimated: false }
      : estimate !== null ? { at: estimate, estimated: true }
      : null;
    waveStarts.set(w.key, shown);
    // Départ servant de point de départ du curseur : l'heure prévue est le dernier recours.
    const begin = shown ? shown.at : w.plannedStart;
    const started = w.actualStart !== null || played.length > 0;

    // État par zone : curseur (null : pas d'heures) et fin la plus tardive des passages joués.
    const cursor = new Map<string, number | null>();
    const lastEnd = new Map<string, number | null>();
    const lines = input.zones.map((z) => ({ zoneId: z.zoneId, items: z.items.filter((i) => i.waveKey === w.key) }));
    // Sur chaque zone, deux règles autour du dernier passage joué de la session :
    // - non joué AVANT lui (résultat ou notes saisis en retard) : pas d'heure, et il ne pousse rien ;
    // - le premier non joué APRÈS lui, session commencée : c'est le passage en cours, sa fin estimée n'est jamais avant maintenant.
    const late = new Set<string>();
    const inProgress = new Set<string>();
    for (const l of lines) {
      cursor.set(l.zoneId, begin);
      lastEnd.set(l.zoneId, null);
      const last = l.items.findLastIndex((i) => i.endedAt !== null);
      l.items.slice(0, Math.max(last, 0)).forEach((i) => { if (i.endedAt === null) late.add(i.key); });
      const current = l.items[last + 1];
      if (current && started && now !== null) inProgress.add(current.key);
    }
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
      if (c === null || late.has(it.key)) return null;
      // Passage en cours : départ ≥ maintenant − durée ; les suivants s'enchaînent (fin du précédent + changement).
      const start = inProgress.has(it.key) ? Math.max(c, now! - it.durationSec) : c;
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

    // Passe B : la suite de la zone des finales, à partir de la première finale. Seule celle-ci attend (fin des combats
    // éliminatoires ou « Finales à »), et seulement si elle n'est pas jouée : une fois les finales commencées, elles s'enchaînent.
    for (const l of lines) {
      (rest.get(l.zoneId) ?? []).forEach((it, k) => {
        if (k === 0 && it.endedAt === null && !late.has(it.key)) {
          const base = w.finalsStart ?? (nonFinalsEnds.length > 0 ? Math.max(...nonFinalsEnds) : null);
          if (base !== null) cursor.set(l.zoneId, Math.max(cursor.get(l.zoneId) ?? -Infinity, base));
        }
        const s = place(l.zoneId, it);
        if (k === 0 && s !== null) finalsStarts.set(w.key, s);
      });
    }
  }
  return { starts, waveStarts, finalsStarts };
}

/**
 * Avance / retard d'une zone : départ estimé du prochain passage non joué (après le dernier joué) moins son départ avec les seules heures
 * prévues (positif = en retard). null si l'un des deux manque ou si la zone est terminée.
 */
export function zoneDrift(input: TimelineInput, zoneId: string): number | null {
  const zone = input.zones.find((z) => z.zoneId === zoneId);
  // Prochain passage dans l'ordre des sessions, puis de la file (les numéros peuvent reprendre à 1) : le premier après le
  // dernier joué de la session (un passage non joué avant lui, saisi en retard, n'a pas d'heure).
  let next: TimelineItem | undefined;
  for (const w of input.waves) {
    const items = zone?.items.filter((i) => i.waveKey === w.key) ?? [];
    next = items[items.findLastIndex((i) => i.endedAt !== null) + 1];
    if (next) break;
  }
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
