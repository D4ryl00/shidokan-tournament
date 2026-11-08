import type { Bracket, KataScores, MatchResult, Podium } from '../brackets/index.js';
import type { MedalRow } from '../results.js';
import type { DisciplineId } from '../types.js';

/**
 * Vue publique d'une compétition (mode spectateur) : liste blanche des champs montrés sans compte. Rien d'une vague non
 * lancée, aucun champ d'organisation (poids, grade, licence, coordonnées, pesée, présence, notes…).
 */

export type PublicPhase = 'upcoming' | 'today' | 'past';

export interface PublicCompetitionSummary {
  id: string;
  name: string;
  date: string;
  location: string | null;
  phase: PublicPhase;
  launched: boolean;
}

export interface PublicEntrant {
  registrationId: string;
  /** null si masqué (non épinglable). */
  fighterId: string | null;
  /** « MARTIN Léa » ou « Combattant masqué ». */
  name: string;
  /** « MARTIN L. » ou « Combattant masqué ». */
  shortName: string;
  club: string;
  clubId: string | null;
  hidden: boolean;
}

/** Côté d'un combat pas encore connu : « vainqueur du n° 12 » (numéro null : combat d'origine sans numéro). */
export type SideSource = { kind: 'winner' | 'loser'; number: number | null };

export interface PublicQueueItem {
  number: number;
  categoryId: string;
  /** null : bloc de kata. */
  matchId: string | null;
  kataPart: 'tour1' | 'finale' | null;
  /** Inscriptions connues. */
  a: string | null;
  b: string | null;
  /** « vainqueur du n° 12 » (côté encore inconnu). */
  aFrom: SideSource | null;
  bFrom: SideSource | null;
  state: 'played' | 'ready' | 'waiting';
  waveId: string | null;
}

export interface PublicCategory {
  id: string;
  label: string;
  discipline: DisciplineId;
  waveId: string | null;
  zoneId: string | null;
  status: 'upcoming' | 'started' | 'finished';
  /** Heure du dernier résultat quand elle est terminée (tri des podiums). */
  finishedAt: string | null;
  /** Libellés des inscrits remplacés par PublicEntrant.name. */
  bracket: Bracket;
  registrationIds: string[];
  absentIds: string[];
  results: Record<string, MatchResult>;
  kataScores: KataScores | null;
  tieBreaks: { pools: Record<number, string[]>; kata: string[]; kataFinal: string[] };
  /** matchId (ou 'kata', 'kata:tour1', 'kata:finale') → numéro. */
  numbers: Record<string, number>;
  /** Combat joué sur une autre zone → « Zone des finales : Ring ». */
  matchZones: Record<string, string>;
  podium: Podium;
}

export interface PublicCompetition {
  id: string;
  name: string;
  date: string;
  location: string | null;
  phase: PublicPhase;
  waves: { id: string | null; name: string; launched: boolean }[];
  zones: { id: string; name: string }[];
  entrants: Record<string, PublicEntrant>;
  /** Seulement celles d'une vague lancée. */
  categories: PublicCategory[];
  queues: { zoneId: string; items: PublicQueueItem[] }[];
  medals: MedalRow[];
}

/** Résultat de recherche : un combattant (non masqué) et ses inscriptions publiques. */
export interface PublicFighter {
  fighterId: string;
  name: string;
  club: string;
  clubId: string | null;
  registrationIds: string[];
}

/** Une catégorie d'un combattant suivi. */
export interface FighterLine {
  categoryId: string;
  label: string;
  discipline: DisciplineId;
  next: {
    number: number;
    zoneId: string;
    /** Passages non joués avant lui sur sa zone. */
    before: number;
    opponent: { name: string; club: string } | { from: SideSource } | null;
  } | null;
  played: { number: number | null; opponent: string; won: boolean }[];
  state: 'upcoming' | 'waiting' | 'eliminated' | 'finished' | { medal: 1 | 2 | 3 };
}
