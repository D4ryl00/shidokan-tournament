/** Ligne de temps des zones (spec §5.3) : pure, en secondes depuis minuit (Paris) du jour de la compétition. */
import type { FinalsWhen } from '../passages/finals-choice.js';

export interface TimelineItem {
  key: string;
  waveKey: string;
  durationSec: number;
  /** Heure de fin du résultat saisi ; null : pas encore joué. */
  endedAt: number | null;
  /** Passage de finale : quand se joue la finale de sa catégorie (« Dès que finie », « Fin de session ») ; null : pas une finale. */
  finals: FinalsWhen | null;
  /**
   * Finale « Dès que finie » jouée sur une autre zone que celle de sa catégorie : clés des passages non finaux de sa
   * catégorie. Elle ne part pas avant la plus tardive de leurs fins estimées.
   */
  waitsFor?: string[];
}

export interface TimelineInput {
  now: number | null;
  changeoverSec: number;
  /** Sessions lancées, dans l'ordre ; `finalsZoneId` : zone des finales de la session (null : aucune). */
  waves: { key: string; plannedStart: number | null; actualStart: number | null; finalsStart: number | null; finalsZoneId: string | null }[];
  /** Passages de chaque zone dans l'ordre de la file, toutes sessions mêlées. */
  zones: { zoneId: string; items: TimelineItem[] }[];
}

export interface Timeline {
  starts: Map<string, number>;
  waveStarts: Map<string, { at: number; estimated: boolean } | null>;
  /** Départ de la première finale « Fin de session » de la zone des finales de chaque session. */
  finalsStarts: Map<string, number>;
}

/**
 * Dernier passage joué dans l'ordre d'une file d'une session (index, -1 : aucun) et finales jouées en avance. Une finale jouée
 * alors qu'un passage la précède encore sans résultat (depuis le dernier joué dans l'ordre) est jouée en avance : elle ne
 * rend pas « saisis en retard » les passages qui la précèdent.
 */
function playedOrder(items: TimelineItem[]): { last: number; early: Set<string> } {
  let last = -1;
  let pending = false;
  const early = new Set<string>();
  items.forEach((it, idx) => {
    if (it.endedAt === null) pending = true;
    else if (it.finals !== null && pending) early.add(it.key);
    else {
      last = idx;
      pending = false;
    }
  });
  return { last, early };
}

export function buildTimeline(input: TimelineInput): Timeline {
  const { now, changeoverSec } = input;
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
    // Sur chaque zone, trois règles autour du dernier passage joué dans l'ordre de la session :
    // - non joué AVANT lui (résultat ou notes saisis en retard) : pas d'heure, et il ne pousse rien ;
    // - le premier non joué APRÈS lui, session commencée : c'est le passage en cours, sa fin estimée n'est jamais avant maintenant ;
    // - non joué avant une finale jouée en avance : à venir, pas avant la fin de cette finale (+ changement).
    const late = new Set<string>();
    const inProgress = new Set<string>();
    const early = new Set<string>();
    const floor = new Map<string, number>();
    for (const l of lines) {
      cursor.set(l.zoneId, begin);
      lastEnd.set(l.zoneId, null);
      const order = playedOrder(l.items);
      order.early.forEach((k) => early.add(k));
      l.items.slice(0, Math.max(order.last, 0)).forEach((i) => { if (i.endedAt === null) late.add(i.key); });
      const current = l.items[order.last + 1];
      if (current && started && now !== null) inProgress.add(current.key);
      let earlyEnd = -Infinity;
      for (let k = l.items.length - 1; k > order.last; k--) {
        const it = l.items[k]!;
        if (order.early.has(it.key)) earlyEnd = Math.max(earlyEnd, it.endedAt!);
        else if (it.endedAt === null && earlyEnd > -Infinity) floor.set(it.key, earlyEnd + changeoverSec);
      }
    }

    const place = (zoneId: string, it: TimelineItem, wait: number | null): number | null => {
      if (it.endedAt !== null) {
        const start = it.endedAt - it.durationSec;
        const end = Math.max(lastEnd.get(zoneId) ?? -Infinity, it.endedAt);
        lastEnd.set(zoneId, end);
        // Finale jouée en avance : les passages qui la précèdent sont déjà placés après elle, le curseur ne recule pas.
        cursor.set(zoneId, early.has(it.key) ? Math.max(cursor.get(zoneId) ?? -Infinity, end + changeoverSec) : end + changeoverSec);
        starts.set(it.key, start);
        return start;
      }
      const c = cursor.get(zoneId) ?? null;
      if (c === null || late.has(it.key)) return null;
      const from = Math.max(c, floor.get(it.key) ?? -Infinity, wait ?? -Infinity);
      // Passage en cours : départ ≥ maintenant − durée ; les suivants s'enchaînent (fin du précédent + changement).
      const start = inProgress.has(it.key) ? Math.max(from, now! - it.durationSec) : from;
      cursor.set(zoneId, start + it.durationSec + changeoverSec);
      starts.set(it.key, start);
      return start;
    };

    // Attentes des finales non jouées (et pas saisies en retard), sur les fins estimées des passages déjà placés :
    // - « Dès que finie » jouée hors de la zone de sa catégorie : la fin des passages non finaux de sa catégorie ;
    // - la première « Fin de session » de la zone des finales : « Finales à », sinon la fin de tous les passages non finaux
    //   de la session (seulement si elle n'est pas jouée : une fois les finales commencées, elles s'enchaînent) ;
    // - la première « Fin de session » d'une autre zone : « Finales à » s'il est saisi, rien sinon.
    const ends = new Map<string, number | null>();
    const inWave = new Set(lines.flatMap((l) => l.items.map((i) => i.key)));
    const nonFinals = lines.flatMap((l) => l.items.filter((i) => i.finals === null).map((i) => i.key));
    const firstEnd = new Map(lines.map((l) => [l.zoneId, l.items.find((i) => i.finals === 'end')?.key]));
    const latest = (keys: string[]) => {
      const known = keys.map((k) => ends.get(k)).filter((e): e is number => e !== null && e !== undefined);
      return known.length > 0 ? Math.max(...known) : null;
    };
    const waitOf = (zoneId: string, it: TimelineItem): { deps: string[]; at: () => number | null } => {
      const none = { deps: [], at: () => null };
      if (it.endedAt !== null || late.has(it.key)) return none;
      if (it.finals === 'ready' && it.waitsFor) {
        const deps = it.waitsFor.filter((k) => inWave.has(k));
        return { deps, at: () => latest(deps) };
      }
      if (it.finals === 'end' && firstEnd.get(zoneId) === it.key) {
        if (w.finalsStart !== null) return { deps: [], at: () => w.finalsStart };
        if (zoneId === w.finalsZoneId) return { deps: nonFinals, at: () => latest(nonFinals) };
      }
      return none;
    };
    const put = (zoneId: string, it: TimelineItem) => {
      const s = place(zoneId, it, waitOf(zoneId, it).at());
      ends.set(it.key, it.endedAt ?? (s === null ? null : s + it.durationSec));
      if (zoneId === w.finalsZoneId && firstEnd.get(zoneId) === it.key && s !== null) finalsStarts.set(w.key, s);
    };

    // Chaque file avance tant que son prochain passage n'attend plus rien ; une attente impossible à lever (dépendances en
    // boucle) laisse passer le premier passage bloqué.
    const pos = new Map(lines.map((l) => [l.zoneId, 0]));
    let left = inWave.size;
    while (left > 0) {
      let moved = false;
      for (const l of lines) {
        let k = pos.get(l.zoneId)!;
        while (k < l.items.length && waitOf(l.zoneId, l.items[k]!).deps.every((d) => ends.has(d))) {
          put(l.zoneId, l.items[k]!);
          k++;
          left--;
          moved = true;
        }
        pos.set(l.zoneId, k);
      }
      if (!moved) {
        const l = lines.find((x) => pos.get(x.zoneId)! < x.items.length)!;
        const k = pos.get(l.zoneId)!;
        put(l.zoneId, l.items[k]!);
        pos.set(l.zoneId, k + 1);
        left--;
      }
    }
  }
  return { starts, waveStarts, finalsStarts };
}

/**
 * Avance / retard d'une zone : départ estimé du prochain passage non joué (après le dernier joué dans l'ordre) moins son départ
 * avec les seules heures prévues (positif = en retard). null si l'un des deux manque ou si la zone est terminée.
 */
export function zoneDrift(input: TimelineInput, zoneId: string): number | null {
  const zone = input.zones.find((z) => z.zoneId === zoneId);
  // Prochain passage dans l'ordre des sessions, puis de la file (les numéros peuvent reprendre à 1) : le premier après le
  // dernier joué dans l'ordre de la session (un passage non joué avant lui, saisi en retard, n'a pas d'heure ; une finale
  // jouée en avance ne compte pas).
  let next: TimelineItem | undefined;
  for (const w of input.waves) {
    const items = zone?.items.filter((i) => i.waveKey === w.key) ?? [];
    next = items[playedOrder(items).last + 1];
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
