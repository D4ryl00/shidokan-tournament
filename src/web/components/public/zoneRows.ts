import { waveKey } from '../../../domain/passages/index.js';
import { zoneQueue } from '../../../domain/public/follow.js';
import type { PublicCompetition, PublicQueueItem } from '../../../domain/public/types.js';
import type { PublicTimes } from '../../../domain/public/times.js';
import { sourceText } from './sourceText.js';

/** Nombre de passages suivants montrés avant « voir les N suivants ». */
export const SHOWN_FOLLOWING = 3;

/** Un côté du combat : nom court, ou « le vainqueur du n° 12 », ou « à déterminer ». */
export function sideText(pub: PublicCompetition, reg: string | null, from: PublicQueueItem['aFrom'], zoneId: string): string {
  if (reg !== null) return pub.entrants[reg]?.shortName ?? 'à déterminer';
  if (from) return sourceText(from, zoneId, pub);
  return 'à déterminer';
}

/** Le passage concerne-t-il un combattant suivi ? Bloc de kata : tous les inscrits de la catégorie. */
export function involvesFollowed(pub: PublicCompetition, item: PublicQueueItem, followed: Set<string>): boolean {
  const regs = item.matchId === null
    ? pub.categories.find((c) => c.id === item.categoryId)?.registrationIds ?? []
    : [item.a, item.b].filter((r): r is string => r !== null);
  return regs.some((r) => {
    const f = pub.entrants[r]?.fighterId;
    return f != null && followed.has(f);
  });
}

export interface ZoneView {
  zoneId: string;
  name: string;
  next: PublicQueueItem | null;
  /** Les premiers suivants, toujours visibles. */
  shown: PublicQueueItem[];
  /** Les autres, derrière « voir les N suivants ». */
  rest: PublicQueueItem[];
  /** Aucun passage restant : « Terminé sur cette zone. » */
  done: boolean;
}

/** Zones à afficher (celles qui ont au moins un passage, joué ou non) et leur découpage. */
export function zoneViews(pub: PublicCompetition): ZoneView[] {
  return pub.zones
    .filter((z) => (pub.queues.find((q) => q.zoneId === z.id)?.items.length ?? 0) > 0)
    .map((z) => {
      const { next, following } = zoneQueue(pub, z.id);
      return { zoneId: z.id, name: z.name, next, shown: following.slice(0, SHOWN_FOLLOWING), rest: following.slice(SHOWN_FOLLOWING), done: next === null };
    });
}

/** « vers 9:30 », avec une espace insécable : l'heure ne part jamais seule à la ligne sur un écran étroit. */
export const versText = (clock: string): string => `vers\u00a0${clock}`;

/** « 09:30 » → « 9:30 » (même écriture que les heures calculées). */
export const clockText = (hhmm: string): string => `${Number(hhmm.split(':')[0])}:${hhmm.split(':')[1]}`;

/** « prévue 9:30 · démarrée 9:41 » (« démarrée vers 9:41 » si estimée) ; parties absentes omises ; rien pour une compétition passée. */
export function waveHeaderText(pub: PublicCompetition, wave: { id: string | null; plannedStart: string | null }, times: PublicTimes): string {
  if (pub.phase === 'past') return '';
  const start = times.waveStart(wave.id);
  const parts = [
    wave.plannedStart ? `prévue ${clockText(wave.plannedStart)}` : null,
    start ? `démarrée ${start.estimated ? versText(start.clock) : start.clock}` : null,
  ].filter((p): p is string => p !== null);
  return parts.map((p) => ` · ${p}`).join('');
}

/** Sessions non lancées : leurs numéros ne sont pas publics, seulement l'heure prévue (jamais pour une compétition passée). */
export function waitingWaves(pub: PublicCompetition): string[] {
  return pub.waves.filter((w) => !w.launched).map((w) => {
    const base = `${w.name} : numéros et horaires au lancement de la session`;
    return w.plannedStart && pub.phase !== 'past' ? `${base}, prévu ${versText(clockText(w.plannedStart))}.` : `${base}.`;
  });
}

/**
 * Avance ou retard d'une zone en minutes (+ = en retard). Moins de 3 min d'écart (et -0) : « à l’heure », sans clignoter ;
 * une heure ou plus : « en retard de 7 h 13 ».
 */
export function driftText(min: number): string {
  const m = Math.abs(min);
  if (m < 3) return 'à l’heure';
  const amount = m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
  return min > 0 ? `en retard de ${amount}` : `en avance de ${amount}`;
}

/**
 * Session affichée en haut de l'onglet Zones : la première session lancée (dans l'ordre) qui a encore un passage à jouer ;
 * toutes jouées : la dernière lancée, terminée. Aucune lancée : null.
 */
export function currentWave(pub: PublicCompetition): { id: string | null; name: string; plannedStart: string | null; done: boolean } | null {
  const launched = pub.waves.filter((w) => w.launched);
  if (launched.length === 0) return null;
  const pending = new Set(pub.queues.flatMap((q) => q.items.filter((i) => i.state !== 'played').map((i) => i.waveId ?? null)));
  const now = launched.find((w) => pending.has(w.id));
  const w = now ?? launched[launched.length - 1]!;
  return { id: w.id, name: w.name, plannedStart: w.plannedStart, done: !now };
}

/** « Finales de la session 1 » (session « Session 1 »), « Finales de la session Matin », « Finales de la session unique ». */
export function finalsLabel(waveName: string, at?: string | null): string {
  return `Finales de la session ${waveName.trim().replace(/^session\s+/i, '')}${at ? ` à partir de ${at}` : ''}`;
}

/** Finale « Fin de session » sur la zone des finales de sa session : elle passe sous la ligne « Finales de la session … ». */
const underFinalsLine = (pub: PublicCompetition, item: PublicQueueItem, zoneId: string): boolean =>
  item.finals === 'end' && (pub.finalsZones[waveKey(item.waveId)] ?? null) === zoneId;

/**
 * Lignes « Finales de la session … » de la file d'une zone (passages restants dans l'ordre) : avant la première finale « Fin de
 * session » de chaque session dont c'est la zone des finales. Clé : l'index du passage dans `items`.
 */
export function finalsMarkers(pub: PublicCompetition, items: PublicQueueItem[], zoneId: string, finalsAt?: (waveId: string | null) => string | null): Map<number, string> {
  const out = new Map<number, string>();
  const seen = new Set<string | null>();
  items.forEach((item, i) => {
    if (!underFinalsLine(pub, item, zoneId) || seen.has(item.waveId)) return;
    seen.add(item.waveId);
    const wave = pub.waves.find((w) => w.id === (item.waveId ?? null));
    if (wave) out.set(i, finalsLabel(wave.name, finalsAt?.(item.waveId ?? null)));
  });
  return out;
}

/** Badge « Finale » : un passage de finale qui ne passe pas sous la ligne « Finales de la session … ». */
export function finalBadge(pub: PublicCompetition, item: PublicQueueItem, zoneId: string): boolean {
  return item.finals !== null && !underFinalsLine(pub, item, zoneId);
}
