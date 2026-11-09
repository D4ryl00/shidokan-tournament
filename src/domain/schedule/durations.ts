import { z } from 'zod';
import type { CategoryKey } from '../categories.js';
import type { CategoryGrid } from '../types.js';

/** Durée d'un combat : rounds, durée d'un round, repos entre rounds, prolongation. */
export interface CombatTiming {
  rounds: number;
  roundSec: number;
  restSec: number;
  overtimeSec: number;
}

export const combatTimingSchema = z
  .object({
    rounds: z.number().int().min(1).max(12),
    roundSec: z.number().int().min(10).max(900),
    restSec: z.number().int().min(0).max(600),
    overtimeSec: z.number().int().min(0).max(900),
  })
  .strict();

export const AGE_GROUPS = ['under14', 'youth', 'adults', 'triathlon'] as const;
export type AgeGroup = (typeof AGE_GROUPS)[number];

export interface ScheduleSettings {
  groups: Record<AgeGroup, CombatTiming>;
  /** Temps de changement, ajouté après chaque passage. */
  changeoverSec: number;
  kataPassageSec: number;
}

export const scheduleSettingsSchema = z
  .object({
    groups: z
      .object({
        under14: combatTimingSchema,
        youth: combatTimingSchema,
        adults: combatTimingSchema,
        triathlon: combatTimingSchema,
      })
      .strict(),
    changeoverSec: z.number().int().min(0).max(900),
    kataPassageSec: z.number().int().min(10).max(900),
  })
  .strict();

/** Durées propres à un tableau : pour tout le tableau, et/ou combat par combat. */
export interface CategoryDurations {
  bracket: CombatTiming | null;
  matches: Record<string, CombatTiming>;
}

export const categoryDurationsSchema = z
  .object({
    bracket: combatTimingSchema.nullable(),
    matches: z.record(z.string(), combatTimingSchema).refine((m) => Object.keys(m).length <= 200, 'trop de combats'),
  })
  .strict();

/** Durées par défaut, selon le règlement. */
export function defaultSchedule(): ScheduleSettings {
  return {
    groups: {
      under14: { rounds: 2, roundSec: 90, restSec: 30, overtimeSec: 60 },
      youth: { rounds: 2, roundSec: 120, restSec: 60, overtimeSec: 60 },
      adults: { rounds: 2, roundSec: 120, restSec: 60, overtimeSec: 120 },
      triathlon: { rounds: 3, roundSec: 120, restSec: 60, overtimeSec: 120 },
    },
    changeoverSec: 60,
    kataPassageSec: 90,
  };
}

/**
 * Groupe d'âge d'un tableau : triathlon à part, sinon selon la plus haute tranche de la clé
 * (tranche sans borne haute, tableau libre ou tranche inconnue : adultes).
 */
export function ageGroupOf(key: CategoryKey, grid: CategoryGrid): AgeGroup {
  if (key.discipline === 'triathlon') return 'triathlon';
  const bands = key.ageBandCodes.map((c) => grid.ageBands.find((b) => b.code === c));
  if (bands.length === 0 || bands.some((b) => !b || b.maxAge === null)) return 'adults';
  const max = Math.max(...bands.map((b) => b!.maxAge as number));
  if (max <= 13) return 'under14';
  if (max <= 17) return 'youth';
  return 'adults';
}

/** Durée retenue pour un combat : combat, puis tableau, puis compétition. */
export function combatTiming(
  s: { schedule: ScheduleSettings; triathlonRounds: 3 | 6 },
  group: AgeGroup,
  durations: CategoryDurations | null,
  matchId: string | null,
): CombatTiming {
  const own = matchId !== null ? durations?.matches[matchId] : undefined;
  if (own) return own;
  if (durations?.bracket) return durations.bracket;
  const base = s.schedule.groups[group];
  return group === 'triathlon' ? { ...base, rounds: s.triathlonRounds } : base;
}

/** Rounds et repos entre rounds ; les prolongations ne comptent pas. */
export function fightSeconds(t: CombatTiming): number {
  return t.rounds * t.roundSec + (t.rounds - 1) * t.restSec;
}

/** Nombre de passages de kata : tour 1 puis finale à deux ; à deux katakas ou moins, la finale seule. */
export function kataPassages(activeEntrants: number, block: 'whole' | 'tour1' | 'finale'): number {
  if (block === 'tour1') return activeEntrants;
  if (block === 'finale') return Math.min(activeEntrants, 2);
  return activeEntrants <= 2 ? activeEntrants : activeEntrants + 2;
}

/** 30 → « 30 s », 65 → « 1 min 05 », 120 → « 2 min ». */
export function minSecText(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m === 0) return `${s} s`;
  return s === 0 ? `${m} min` : `${m} min ${String(s).padStart(2, '0')}`;
}

/** « 2 × 1 min 30 ». */
export function timingText(t: CombatTiming): string {
  return `${t.rounds} × ${minSecText(t.roundSec)}`;
}

/** « m » ou « m:ss » (ss < 60) en secondes ; null si illisible. */
export function parseMinSec(text: string): number | null {
  const m = /^\s*(\d{1,3})(?:\s*:\s*(\d{1,2}))?\s*$/.exec(text);
  if (!m) return null;
  const sec = m[2] === undefined ? 0 : Number(m[2]);
  if (sec >= 60) return null;
  return Number(m[1]) * 60 + sec;
}
