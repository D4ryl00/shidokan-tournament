import { zoneQueue } from '../../../domain/public/follow.js';
import type { PublicCompetition, PublicQueueItem } from '../../../domain/public/types.js';
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

/** Sessions non lancées : leurs numéros ne sont pas publics. */
export function waitingWaves(pub: PublicCompetition): string[] {
  return pub.waves.filter((w) => !w.launched).map((w) => `${w.name} : numéros au lancement de la session.`);
}

/**
 * Session affichée en haut de l'onglet Zones : la première session lancée (dans l'ordre) qui a encore un passage à jouer ;
 * toutes jouées : la dernière lancée, terminée. Aucune lancée : null.
 */
export function currentWave(pub: PublicCompetition): { name: string; done: boolean } | null {
  const launched = pub.waves.filter((w) => w.launched);
  if (launched.length === 0) return null;
  const pending = new Set(pub.queues.flatMap((q) => q.items.filter((i) => i.state !== 'played').map((i) => i.waveId ?? null)));
  const now = launched.find((w) => pending.has(w.id));
  return now ? { name: now.name, done: false } : { name: launched[launched.length - 1]!.name, done: true };
}

/** « Finales de la session 1 » (session « Session 1 »), « Finales de la session Matin », « Finales de la session unique ». */
export function finalsLabel(waveName: string): string {
  return `Finales de la session ${waveName.trim().replace(/^session\s+/i, '')}`;
}

/**
 * Lignes « Finales de la session … » d'une file (passages restants dans l'ordre) : avant la première finale de chaque
 * session sur la zone des finales. Clé : l'index du passage dans `items`.
 */
export function finalsMarkers(pub: PublicCompetition, items: PublicQueueItem[]): Map<number, string> {
  const out = new Map<number, string>();
  const seen = new Set<string | null>();
  items.forEach((item, i) => {
    if (!item.finals || seen.has(item.waveId)) return;
    seen.add(item.waveId);
    const wave = pub.waves.find((w) => w.id === (item.waveId ?? null));
    if (wave) out.set(i, finalsLabel(wave.name));
  });
  return out;
}
