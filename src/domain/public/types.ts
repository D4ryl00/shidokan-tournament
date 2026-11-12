import type { Bracket, KataScores, MatchResult, Podium } from '../brackets/index.js';
import type { FinalsWhen } from '../passages/finals-choice.js';
import type { MedalRow } from '../results.js';
import type { CombatTiming } from '../schedule/durations.js';
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
  /** Sessions et leur heure prévue (seule heure montrée d'une session non lancée). */
  waves: { name: string; plannedStart: string | null }[];
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

/**
 * Côté d'un combat pas encore connu : « vainqueur du n° 12 » (numéro null : combat d'origine sans numéro). Les numéros
 * sont propres à chaque zone : `zoneId` est la zone du combat d'origine (null : sans numéro).
 */
export type SideSource = { kind: 'winner' | 'loser'; number: number | null; zoneId: string | null };

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
  /**
   * Passage de finale (combat pour la 1re place, bloc de finale d'un kata) : quand se joue la finale de sa catégorie, « Dès que
   * finie » ou « Fin de session » ; null : pas une finale. La ligne « Finales de la session … » se place avant la première
   * « Fin de session » de la zone des finales de sa session.
   */
  finals: FinalsWhen | null;
  /** Durée du passage, sans le temps de changement. */
  durationSec: number;
  /** Durée retenue du combat ; null : bloc de kata. */
  timing: CombatTiming | null;
  /** Bloc de kata : nombre de passages ; null : combat. */
  kataPassages: number | null;
  /** Heure de fin (ISO), seulement pour un passage joué. */
  endedAt: string | null;
}

/** Clé d'un passage, commune à la vue et à la ligne de temps. */
export function passageKey(item: { categoryId: string; matchId: string | null; kataPart: 'tour1' | 'finale' | null }): string {
  return `${item.categoryId}:${item.matchId ?? (item.kataPart ? `kata:${item.kataPart}` : 'kata')}`;
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
  /** Durée du tableau (null pour un kata). */
  timing: CombatTiming | null;
  /** Kata : durée d'un passage. */
  kataPassageSec: number | null;
}

export interface PublicCompetition {
  id: string;
  name: string;
  date: string;
  location: string | null;
  phase: PublicPhase;
  waves: {
    id: string | null;
    name: string;
    launched: boolean;
    /** HH:MM. Seule l'heure prévue est montrée d'une session non lancée : les deux autres y sont null. */
    plannedStart: string | null;
    actualStart: string | null;
    finalsStart: string | null;
  }[];
  /** Temps de changement entre deux passages, en secondes. */
  changeoverSec: number;
  /** Zone des finales de chaque session (clé `waveKey`) ; null : aucune. */
  finalsZones: Record<string, string | null>;
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
    /** `passageKey` du passage. */
    key: string;
    durationSec: number;
    timing: CombatTiming | null;
    kataPassages: number | null;
    number: number;
    zoneId: string;
    /** Passages non joués avant lui sur sa zone. */
    before: number;
    opponent: { name: string; club: string } | { from: SideSource } | null;
  } | null;
  played: { number: number | null; opponent: string; won: boolean }[];
  /** Kata seulement : note et place au tour 1 (null : pas encore noté, ou pas de tour 1 à deux katakas), note de la finale. */
  kata?: { round1: number | null; place: number | null; final: number | null };
  state: 'upcoming' | 'waiting' | 'eliminated' | 'finished' | { medal: 1 | 2 | 3 };
}
