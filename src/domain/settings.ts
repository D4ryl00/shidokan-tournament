import { z } from 'zod';
import { mailTemplateSchema } from './app-settings.js';

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
/** Ordre de passage des combats d'une zone : tour par tour (défaut) ou catégorie par catégorie. */
export const PASSAGE_ORDER_MODES = ['rounds', 'categories'] as const;
export type PassageOrderMode = (typeof PASSAGE_ORDER_MODES)[number];

/** Règles du plan d'ensemble de la réaffectation, dans l'ordre par défaut (du moins au plus coûteux). */
export const RULE_IDS = [
  'return', 'weight', 'split', 'weightGap', 'ageUp', 'ageDown', 'seniorsVeterans', 'discipline',
  'shobuToJiyu', 'mixSexes', 'minorsAdults',
] as const;
export type RuleId = (typeof RULE_IDS)[number];
/** Règles dont l'interrupteur est dans `replacementRules.off` (les quatre autres ont leur propre réglage). */
export const OWN_SWITCH_RULES = ['weight', 'split', 'weightGap', 'ageUp', 'ageDown', 'discipline'] as const;

/** `order` doit être une permutation de RULE_IDS qui commence par `return`. */
export function isValidRuleOrder(order: readonly string[]): boolean {
  return (
    order.length === RULE_IDS.length &&
    order[0] === 'return' &&
    RULE_IDS.every((r) => order.includes(r))
  );
}
export const ruleOrderSchema = z.array(z.enum(RULE_IDS)).refine(isValidRuleOrder, 'ordre des règles invalide');

const kg = (max: number) => z.number().min(0).max(max);

export const competitionSettingsSchema = z
  .object({
    weightGapMaxKg: z.object({ children: kg(50), adults: kg(50) }).strict(),
    weighInToleranceKg: z.object({ M: kg(5), F: kg(5) }).strict(),
    mixMinorsAdults: z.boolean(),
    mixSeniorsVeterans: z.boolean(),
    mixSexes: z.object({ enabled: z.boolean(), ageBandCodes: z.array(z.string()) }).strict(),
    /** Recaser un combattant shobu en jiyu (type G) : jamais proposé si désactivé. */
    shobuToJiyu: z.boolean(),
    multipleCombatDisciplinesPerDay: z.boolean(),
    formats: z
      .object({ two: z.enum(COMBAT_FORMATS), three: z.enum(COMBAT_FORMATS), fourPlus: z.enum(COMBAT_FORMATS) })
      .strict(),
    repechage: z.boolean(),
    thirdPlaceMatch: z.boolean(),
    kataBronzeCount: z.union([z.literal(1), z.literal(2)]),
    triathlonRounds: z.union([z.literal(3), z.literal(6)]),
    passageOrder: z.enum(PASSAGE_ORDER_MODES),
    /** Zone où passent les combats pour la 1re place (null : aucune). */
    finalsZoneId: z.string().nullable(),
    kataFinalsOnFinalsZone: z.boolean(),
    /** Message envoyé aux clubs pour cette compétition (null : celui des réglages de l'application). */
    invitationMail: mailTemplateSchema.nullable(),
    /** Liste ordonnée des règles du plan d'ensemble, interrupteurs propres et ligne de coupure. */
    replacementRules: z
      .object({
        order: ruleOrderSchema,
        off: z.array(z.enum(OWN_SWITCH_RULES)),
        cutAfter: z.enum(RULE_IDS),
      })
      .strict(),
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
    shobuToJiyu: false,
    multipleCombatDisciplinesPerDay: false,
    formats: { two: 'single_match', three: 'round_robin', fourPlus: 'single_elimination' },
    repechage: false,
    thirdPlaceMatch: false,
    kataBronzeCount: 2,
    triathlonRounds: 3,
    passageOrder: 'rounds',
    finalsZoneId: null,
    kataFinalsOnFinalsZone: false,
    invitationMail: null,
    replacementRules: { order: [...RULE_IDS], off: [], cutAfter: 'discipline' },
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
