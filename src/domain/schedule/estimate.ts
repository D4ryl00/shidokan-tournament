/**
 * Horaires estimés de la journée (spec §7.7) : toutes les sessions, lancées ou non, sans les résultats saisis (estimation de
 * planification). Pur, en secondes depuis minuit du jour de la compétition (ou depuis le début : `relative`).
 */
import type { FinalsWhen } from '../passages/finals-choice.js';
import { buildTimeline } from './timeline.js';

export interface EstimateItem {
  key: string;
  waveKey: string;
  /** Durée du passage, sans le changement. */
  durationSec: number;
  finals: FinalsWhen | null;
  /** Finale « Dès que finie » jouée hors de la zone de sa catégorie : passages non finaux de sa catégorie (voir `TimelineItem`). */
  waitsFor?: string[];
}

export interface EstimateInput {
  changeoverSec: number;
  /** « Décaler une session qui commence avant la fin de la précédente » : sur chaque zone, pas avant cette fin (+ changement). */
  shift: boolean;
  /** Sessions dans l'ordre. */
  waves: { key: string; plannedStart: number | null; finalsZoneId: string | null }[];
  /** Passages de chaque zone dans l'ordre de la file, toutes sessions mêlées (ordre des sessions, puis numéro). */
  zones: { zoneId: string; items: EstimateItem[] }[];
}

export interface DayEstimate {
  /** Aucune heure de début connue (première session sans début prévu) : secondes depuis le début. */
  relative: boolean;
  waves: {
    key: string;
    /** Début de la session : prévu, sinon à la suite de la précédente. */
    start: number;
    /** Fin estimée : la zone la plus chargée. */
    end: number;
    /** Départ des finales « Fin de session » sur la zone des finales. */
    finalsStart: number | null;
    /** Zones jouées par la session, dans l'ordre des zones. */
    zones: { zoneId: string; start: number; end: number; passages: number }[];
    /** Zones où la session commence avant la fin estimée de la précédente (+ changement), en minutes arrondies au-dessus. */
    overlap: { zoneId: string; minutes: number }[];
  }[];
  end: number;
}

/** Réponse de l'API : l'estimation, les noms des sessions et les zones de la compétition. */
export type DayEstimateView = Omit<DayEstimate, 'waves'> & {
  zones: { id: string; name: string }[];
  waves: (DayEstimate['waves'][number] & { name: string })[];
};

export function estimateDay(input: EstimateInput): DayEstimate {
  const { changeoverSec, shift } = input;
  // Sans début prévu pour la première session, rien ne situe la journée : tout s'enchaîne depuis 0.
  const relative = input.waves[0]?.plannedStart == null;
  /** Fin estimée (sans le changement) de la dernière session jouée sur chaque zone. */
  const zoneEnd = new Map<string, number>();
  const waves: DayEstimate['waves'] = [];
  let previousEnd: number | null = null;
  for (const w of input.waves) {
    const start = !relative && w.plannedStart !== null ? w.plannedStart : previousEnd === null ? 0 : previousEnd + changeoverSec;
    const zones = input.zones
      .map((z) => ({ zoneId: z.zoneId, items: z.items.filter((i) => i.waveKey === w.key).map((i) => ({ ...i, endedAt: null })) }))
      .filter((z) => z.items.length > 0);
    // Chevauchement mesuré dans les deux cas ; décalé, il devient le plancher de la zone.
    const floors = zones.flatMap((z) => {
      const e = zoneEnd.get(z.zoneId);
      return e === undefined ? [] : [{ zoneId: z.zoneId, at: e + changeoverSec }];
    });
    const overlap = floors.filter((f) => f.at > start).map((f) => ({ zoneId: f.zoneId, minutes: Math.ceil((f.at - start) / 60) }));
    const timeline = buildTimeline({
      now: null,
      changeoverSec,
      waves: [{
        key: w.key,
        plannedStart: start,
        actualStart: null,
        finalsStart: null,
        finalsZoneId: w.finalsZoneId,
        ...(shift ? { zoneFloors: Object.fromEntries(floors.map((f) => [f.zoneId, f.at])) } : {}),
      }],
      zones,
    });
    const rows = zones.map((z) => {
      const placed = z.items.flatMap((i) => {
        const s = timeline.starts.get(i.key);
        return s === undefined ? [] : [{ start: s, end: s + i.durationSec }];
      });
      return {
        zoneId: z.zoneId,
        start: placed.length === 0 ? start : Math.min(...placed.map((p) => p.start)),
        end: placed.length === 0 ? start : Math.max(...placed.map((p) => p.end)),
        passages: z.items.length,
      };
    });
    for (const r of rows) zoneEnd.set(r.zoneId, Math.max(zoneEnd.get(r.zoneId) ?? -Infinity, r.end));
    const end = Math.max(start, ...rows.map((r) => r.end));
    waves.push({ key: w.key, start, end, finalsStart: timeline.finalsStarts.get(w.key) ?? null, zones: rows, overlap });
    previousEnd = end;
  }
  return { relative, waves, end: waves.length === 0 ? 0 : Math.max(...waves.map((w) => w.end)) };
}
