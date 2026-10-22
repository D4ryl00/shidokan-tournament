import { z } from 'zod';

export const COMBAT_FORMATS = [
  'single_match',
  'best_of_three',
  'round_robin',
  'three_with_repechage',
  'single_elimination',
  'double_elimination',
  'pools_then_bracket',
] as const;
export type CombatFormat = (typeof COMBAT_FORMATS)[number];

const kg = (max: number) => z.number().min(0).max(max);

export const competitionSettingsSchema = z
  .object({
    weightGapMaxKg: z.object({ children: kg(50), adults: kg(50) }).strict(),
    weighInToleranceKg: z.object({ M: kg(5), F: kg(5) }).strict(),
    mixMinorsAdults: z.boolean(),
    mixSeniorsVeterans: z.boolean(),
    mixSexes: z.object({ enabled: z.boolean(), ageBandCodes: z.array(z.string()) }).strict(),
    multipleCombatDisciplinesPerDay: z.boolean(),
    formats: z
      .object({ two: z.enum(COMBAT_FORMATS), three: z.enum(COMBAT_FORMATS), fourPlus: z.enum(COMBAT_FORMATS) })
      .strict(),
    repechage: z.boolean(),
    thirdPlaceMatch: z.boolean(),
    kataBronzeCount: z.union([z.literal(1), z.literal(2)]),
    triathlonRounds: z.union([z.literal(3), z.literal(6)]),
  })
  .strict();

export type CompetitionSettings = z.infer<typeof competitionSettingsSchema>;

export function defaultSettings(): CompetitionSettings {
  return {
    weightGapMaxKg: { children: 5, adults: 5 },
    weighInToleranceKg: { M: 0.3, F: 0.5 },
    mixMinorsAdults: false,
    mixSeniorsVeterans: true,
    mixSexes: { enabled: false, ageBandCodes: [] },
    multipleCombatDisciplinesPerDay: false,
    formats: { two: 'single_match', three: 'round_robin', fourPlus: 'single_elimination' },
    repechage: false,
    thirdPlaceMatch: false,
    kataBronzeCount: 2,
    triathlonRounds: 3,
  };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function deepMerge(base: unknown, patch: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch === undefined ? base : patch;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) out[k] = deepMerge(base[k], v);
  return out;
}

/**
 * Lecture tolérante de réglages stockés : clés inconnues ignorées, et chaque réglage
 * invalide ou absent retombe sur sa valeur par défaut (la lecture ne doit jamais casser l'app).
 */
export function readStoredSettings(raw: unknown): CompetitionSettings {
  const defaults = defaultSettings();
  const stored = isPlainObject(raw) ? raw : {};
  const shape = competitionSettingsSchema.shape;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(defaults) as (keyof CompetitionSettings)[]) {
    const parsed = shape[key].safeParse(deepMerge(defaults[key], stored[key]));
    out[key] = parsed.success ? parsed.data : defaults[key];
  }
  return out as CompetitionSettings;
}

/** Fusionne un objet partiel avec `base` (les défauts sinon) puis valide ; lève ZodError si invalide. */
export function mergeSettings(partial: unknown, base: CompetitionSettings = defaultSettings()): CompetitionSettings {
  return competitionSettingsSchema.parse(deepMerge(base, partial ?? {}));
}
