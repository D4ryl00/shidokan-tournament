import { normalizeName } from './names.js';
import type { DisciplineId, Ruleset } from './types.js';

const text = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());

export const DISCIPLINES: Record<
  DisciplineId,
  { label: string; clubFormCode: 1 | 2 | 3 | null; hasWeight: boolean; inPreferences: boolean }
> = {
  karate: { label: 'Karaté', clubFormCode: 1, hasWeight: true, inPreferences: true },
  'shido-boxing': { label: 'Shido-boxing', clubFormCode: 2, hasWeight: true, inPreferences: true },
  'shido-mix': { label: 'Shido-mix-martial', clubFormCode: 3, hasWeight: true, inPreferences: true },
  triathlon: { label: 'Triathlon', clubFormCode: null, hasWeight: true, inPreferences: false },
  kata: { label: 'Kata', clubFormCode: null, hasWeight: false, inPreferences: false },
};

export const RULESETS: Record<Ruleset, { label: string; ko: boolean; adultsOnly: boolean }> = {
  jiyu: { label: 'Jiyu ippon kumite', ko: false, adultsOnly: false },
  shobu: { label: 'Shobu ippon kumite', ko: true, adultsOnly: true },
};

export function disciplineFromLabel(v: unknown): DisciplineId | null {
  const s = normalizeName(text(v));
  const table: Record<string, DisciplineId> = {
    KARATE: 'karate', '1': 'karate',
    'SHIDO BOXING': 'shido-boxing', BOXE: 'shido-boxing', BOXING: 'shido-boxing', 'SHIDO BOXE': 'shido-boxing', '2': 'shido-boxing',
    'SHIDO MIX MARTIAL': 'shido-mix', 'SHIDO MIX': 'shido-mix', MIX: 'shido-mix', 'MIX MARTIAL': 'shido-mix', KMIX: 'shido-mix', '3': 'shido-mix',
    TRIATHLON: 'triathlon',
    KATA: 'kata',
  };
  return table[s] ?? null;
}
