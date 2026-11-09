import { searchPublic } from '../../../domain/public/follow.js';
import type { FighterLine, PublicCategory, PublicCompetition } from '../../../domain/public/types.js';
import type { DisciplineId } from '../../../domain/types.js';
import { DISCIPLINES } from '../../../domain/disciplines.js';
import type { EntrantInfo } from '../BracketView.js';

/**
 * Libellé d'une catégorie avec sa discipline, sans la répéter : un libellé de la grille commence déjà par elle
 * (« Kata · Minimes M »), un tableau libre peut ne pas la contenir (« Coupe des petits » → « Coupe des petits · Kata »).
 */
export function categoryText(label: string, discipline: DisciplineId): string {
  const d = DISCIPLINES[discipline].label;
  return label.toLocaleLowerCase('fr').startsWith(d.toLocaleLowerCase('fr')) ? label : `${label} · ${d}`;
}

const placeText = (n: number) => (n === 1 ? '1er' : `${n}e`);
const scoreText = (n: number) => n.toLocaleString('fr-FR');

/** Ligne de kata d'un combattant suivi : « Tour 1 : 7,85 · 3e · Finale : 8,1 » ; null tant que rien n'est noté. */
export function kataText(k: NonNullable<FighterLine['kata']>): string | null {
  const parts: string[] = [];
  if (k.round1 !== null) parts.push(`Tour 1 : ${scoreText(k.round1)}${k.place !== null ? ` · ${placeText(k.place)}` : ''}`);
  if (k.final !== null) parts.push(`Finale : ${scoreText(k.final)}`);
  return parts.length ? parts.join(' · ') : null;
}

export interface CategoryFilters {
  discipline: DisciplineId | 'all';
  waveId: string | 'all';
  zoneId: string | 'all';
  status: PublicCategory['status'] | 'all';
}

export const NO_FILTERS: CategoryFilters = { discipline: 'all', waveId: 'all', zoneId: 'all', status: 'all' };

export const CATEGORY_STATUS_LABELS: Record<PublicCategory['status'], string> = { upcoming: 'À venir', started: 'En cours', finished: 'Terminée' };

/** Catégories qui passent les filtres (l'ordre de la vue publique est gardé). */
export function filterCategories(cats: PublicCategory[], f: CategoryFilters): PublicCategory[] {
  return cats.filter(
    (c) =>
      (f.discipline === 'all' || c.discipline === f.discipline) &&
      (f.waveId === 'all' || (c.waveId ?? '') === f.waveId) &&
      (f.zoneId === 'all' || c.zoneId === f.zoneId) &&
      (f.status === 'all' || c.status === f.status),
  );
}

/** Inscriptions des combattants (et des clubs) qui correspondent à la recherche ; vide si la recherche est trop courte. */
export function highlightedRegistrations(pub: PublicCompetition, q: string): Set<string> {
  const { clubs, fighters } = searchPublic(pub, q);
  const out = new Set<string>(fighters.flatMap((f) => f.registrationIds));
  const clubIds = new Set(clubs.map((c) => c.clubId));
  if (clubIds.size > 0) for (const e of Object.values(pub.entrants)) if (!e.hidden && e.clubId !== null && clubIds.has(e.clubId)) out.add(e.registrationId);
  return out;
}

/** Inscriptions des combattants suivis (étoiles) : surlignées d'office. */
export function followedRegistrations(pub: PublicCompetition, followed: Set<string>): Set<string> {
  return new Set(Object.values(pub.entrants).filter((e) => e.fighterId !== null && followed.has(e.fighterId)).map((e) => e.registrationId));
}

export function entrantInfos(pub: PublicCompetition): Map<string, EntrantInfo> {
  return new Map(Object.entries(pub.entrants).map(([id, e]) => [id, { name: e.name, club: e.club }]));
}

export const toMap = <V,>(r: Record<string, V>): Map<string, V> => new Map(Object.entries(r));

export interface PassageRow {
  key: string;
  number: number;
  zone: string;
  kata: boolean;
  /** Noms des deux côtés ; null : pas encore connu. */
  a: string | null;
  b: string | null;
  /** « A bat B » / texte du résultat, vide tant que le combat n'est pas joué. */
  result: string;
  played: boolean;
}

const METHODS: Record<string, string> = { points: 'points', decision: 'décision', ko: 'KO', abandon: 'abandon', disqualification: 'disq.', forfeit: 'forfait' };

/** Passages d'une catégorie dans l'ordre des files (zone par zone) : numéro, zone, noms, résultat. */
export function categoryPassages(pub: PublicCompetition, c: PublicCategory): PassageRow[] {
  const name = (r: string | null) => (r === null ? null : (pub.entrants[r]?.name ?? null));
  return pub.queues.flatMap((q) =>
    q.items
      .filter((i) => i.categoryId === c.id)
      .map((i): PassageRow => {
        const zone = pub.zones.find((z) => z.id === q.zoneId)?.name ?? 'Zone';
        const key = `${q.zoneId}:${i.number}:${i.kataPart ?? ''}`;
        if (i.matchId === null) {
          return { key, number: i.number, zone, kata: true, a: null, b: null, result: i.kataPart === 'finale' ? 'Finale' : 'Tour 1', played: i.state === 'played' };
        }
        const r = c.results[i.matchId];
        const w = r ? (r.winner === 'a' ? name(i.a) : name(i.b)) : null;
        const result = r ? `${w ? `${w} gagne` : 'Terminé'} · ${METHODS[r.method] ?? r.method}${r.score ? ` ${r.score}` : ''}` : '';
        return { key, number: i.number, zone, kata: false, a: name(i.a), b: name(i.b), result, played: i.state === 'played' };
      }),
  );
}

export interface PodiumLine {
  place: 1 | 2 | 3;
  registrationId: string;
}

/** Podiums des catégories terminées, du `finishedAt` le plus récent au plus ancien (sans date : en dernier). */
export function finishedPodiums(cats: PublicCategory[], discipline: DisciplineId | 'all'): { category: PublicCategory; lines: PodiumLine[] }[] {
  return cats
    .filter((c) => c.status === 'finished' && (discipline === 'all' || c.discipline === discipline))
    .map((c) => {
      const p = c.podium;
      const lines: PodiumLine[] = [
        ...(p.first ? [{ place: 1 as const, registrationId: p.first }] : []),
        ...(p.second ? [{ place: 2 as const, registrationId: p.second }] : []),
        ...p.thirds.map((registrationId) => ({ place: 3 as const, registrationId })),
      ];
      return { category: c, lines };
    })
    .filter((x) => x.lines.length > 0)
    .sort((a, b) => {
      const ta = a.category.finishedAt ?? '';
      const tb = b.category.finishedAt ?? '';
      return ta === tb ? 0 : ta === '' ? 1 : tb === '' ? -1 : tb.localeCompare(ta);
    });
}
