import { z, type ZodError } from 'zod';

export const competitionCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'La date doit être au format AAAA-MM-JJ')
      .refine((d) => {
        const [y, m, day] = d.split('-').map(Number) as [number, number, number];
        const dt = new Date(Date.UTC(y, m - 1, day));
        return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === day;
      }, 'La date n’existe pas'),
    location: z.string().trim().max(120).nullable().optional(),
    zoneCount: z.number().int().min(1).max(20).optional(),
  })
  .strict();

export const competitionPatchSchema = competitionCreateSchema.omit({ zoneCount: true }).partial().extend({ settings: z.unknown().optional() }).strict();

const sex = z.enum(['M', 'F']);
export const categoryGridSchema = z
  .object({
    ageBands: z.array(
      z.object({
        code: z.string().min(1),
        label: z.string(),
        minAge: z.number().int().min(0),
        maxAge: z.number().int().min(0).nullable(),
        isMinor: z.boolean(),
        sortOrder: z.number().int(),
        onClubForm: z.boolean().default(true),
      }).strict(),
    ),
    weightClasses: z.array(
      z.object({
        id: z.string().min(1),
        ageBandCode: z.string().min(1),
        sex,
        label: z.string().min(1),
        maxKg: z.number().positive().nullable(),
        sortOrder: z.number().int(),
      }).strict(),
    ),
    ageLinks: z.array(z.object({ from: z.string(), to: z.string(), kind: z.enum(['C', 'D']) }).strict()),
  })
  .strict();

const FIELD_LABELS: Record<string, string> = {
  name: 'nom',
  date: 'date',
  location: 'lieu',
  zoneCount: 'nombre de zones de combat',
  children: 'enfants',
  adults: 'adultes',
  weightGapMaxKg: 'écart de poids max',
  weighInToleranceKg: 'tolérance de pesée',
  kataBronzeCount: 'nombre de bronzes en kata',
  triathlonRounds: 'rounds de triathlon',
  settings: 'réglages',
  mixSexes: 'mixité',
  ageBandCodes: "tranches d'âge",
};

/** Messages d'erreur Zod en français, préfixés par le champ concerné. */
export function zodIssuesFr(error: ZodError): string[] {
  return error.issues.map((issue) => {
    const where = issue.path.map((p) => FIELD_LABELS[String(p)] ?? String(p)).join(' › ');
    let msg: string;
    switch (issue.code) {
      case 'too_small':
        msg = issue.type === 'string' ? 'ne doit pas être vide' : `doit être supérieur ou égal à ${issue.minimum}`;
        break;
      case 'too_big':
        msg = issue.type === 'string' ? `est trop long (${issue.maximum} caractères max.)` : `doit être inférieur ou égal à ${issue.maximum}`;
        break;
      case 'invalid_type':
        msg = issue.received === 'undefined' ? 'est obligatoire' : 'a un type invalide';
        break;
      case 'invalid_enum_value':
        msg = `valeur inconnue (valeurs permises : ${issue.options.join(', ')})`;
        break;
      case 'invalid_union':
      case 'invalid_literal':
        msg = 'valeur non permise';
        break;
      case 'unrecognized_keys':
        msg = `champ(s) inconnu(s) : ${issue.keys.join(', ')}`;
        break;
      case 'invalid_string':
        msg = issue.message.startsWith('La ') ? issue.message : 'format invalide';
        break;
      case 'custom':
        msg = issue.message;
        break;
      default:
        msg = 'valeur invalide';
    }
    return where ? `${where} : ${msg}` : msg;
  });
}
