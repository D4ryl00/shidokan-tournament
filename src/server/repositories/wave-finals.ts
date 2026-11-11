import { and, eq, inArray } from 'drizzle-orm';
import type { FinalsWhen, FinalsWhere, WaveFinals } from '../../domain/passages/finals-choice.js';
import { waveKey } from '../../domain/passages/index.js';
import type { AppDb } from '../db/client.js';
import { categories, waveFinals } from '../db/schema.js';
import { readCategories } from './categories.js';
import { launchRows } from './launch-state.js';
import { RegistrationValidationError } from './registrations.js';
import { listWaves } from './waves.js';
import { listZones } from './zones.js';

/**
 * Reprise des anciens réglages d'une compétition (paramètre : son id), même règle que la migration 0036 : chaque session
 * (ou la session unique '') prend `finalsZoneId` comme zone des finales s'il désigne une de ses zones ; ses katas restent
 * alors en bloc unique sur leur zone (« Sa zone », « Dès que finie ») si `kataFinalsOnFinalsZone` n'était pas coché.
 * Deux requêtes, à exécuter dans l'ordre.
 */
export const WAVE_FINALS_FROM_SETTINGS = [
  `INSERT OR IGNORE INTO wave_finals (competition_id, wave_key, finals_zone_id)
   SELECT c.id, coalesce(w.id, ''), z.id
   FROM competitions c
   JOIN zones z ON z.competition_id = c.id
     AND z.id = (CASE WHEN json_valid(c.settings_json) THEN json_extract(c.settings_json, '$.finalsZoneId') END)
   LEFT JOIN waves w ON w.competition_id = c.id
   WHERE c.id = ?`,
  `UPDATE categories SET finals_where = 'own', finals_when = 'ready'
   WHERE competition_id = ?
     AND (CASE WHEN json_valid(key_json) THEN json_extract(key_json, '$.discipline') END) = 'kata'
     AND competition_id IN (SELECT competition_id FROM wave_finals)
     AND competition_id IN (
       SELECT id FROM competitions
       WHERE (CASE WHEN json_valid(settings_json) THEN json_extract(settings_json, '$.kataFinalsOnFinalsZone') END) IS NOT 1
     )`,
] as const;

/** Finales des sessions d'une compétition (celles qui ont une ligne : zone des finales choisie ou « Tout… » utilisé). */
export function listWaveFinals(db: AppDb, competitionId: string): WaveFinals[] {
  return db
    .select()
    .from(waveFinals)
    .where(eq(waveFinals.competitionId, competitionId))
    .all()
    .map((r) => ({ waveKey: r.waveKey, finalsZoneId: r.finalsZoneId, whereDefault: r.whereDefault, whenDefault: r.whenDefault }));
}

/** Les finales d'une session lancée ne changent pas : ses numéros sont imprimés. */
export function assertFinalsEditable(db: AppDb, competitionId: string, waveId: string | null): void {
  if (launchRows(db, competitionId).get(waveKey(waveId))?.launched) {
    throw new RegistrationValidationError(['Session figée : rouvrez-la dans Combats pour changer les finales.']);
  }
}

/** Session demandée (null : session unique d'une compétition sans session), modifiable. */
async function checkSession(db: AppDb, competitionId: string, waveId: string | null): Promise<void> {
  const sessions = await listWaves(db, competitionId);
  if (waveId === null ? sessions.length > 0 : !sessions.some((w) => w.id === waveId)) {
    throw new RegistrationValidationError([waveId === null ? 'Cette compétition a des sessions : choisissez-en une.' : 'Session inconnue pour cette compétition.']);
  }
  assertFinalsEditable(db, competitionId, waveId);
}

type WaveFinalsRow = Partial<Pick<typeof waveFinals.$inferInsert, 'finalsZoneId' | 'whereDefault' | 'whenDefault'>>;

function upsertWave(t: AppDb, competitionId: string, waveId: string | null, values: WaveFinalsRow): void {
  if (Object.keys(values).length === 0) return;
  t.insert(waveFinals)
    .values({ competitionId, waveKey: waveKey(waveId), ...values })
    .onConflictDoUpdate({ target: [waveFinals.competitionId, waveFinals.waveKey], set: values })
    .run();
}

/** Catégories de la session (selon leur session actuelle). */
async function sessionCategoryIds(db: AppDb, competitionId: string, waveId: string | null): Promise<string[]> {
  return (await readCategories(db, competitionId)).filter((c) => c.waveId === waveId).map((c) => c.id);
}

/**
 * Zone des finales d'une session (null : « Aucune »). Une zone choisie y met toutes les catégories de la session : « Où »
 * de la session passe à la zone des finales et celui de chaque catégorie revient à la valeur de la session.
 */
export async function setFinalsZone(db: AppDb, competitionId: string, waveId: string | null, finalsZoneId: string | null): Promise<void> {
  await checkSession(db, competitionId, waveId);
  if (finalsZoneId !== null && !(await listZones(db, competitionId)).some((z) => z.id === finalsZoneId)) {
    throw new RegistrationValidationError(['Zone inconnue pour cette compétition.']);
  }
  const ids = finalsZoneId === null ? [] : await sessionCategoryIds(db, competitionId, waveId);
  db.transaction((tx) => {
    const t = tx as unknown as AppDb;
    upsertWave(t, competitionId, waveId, finalsZoneId === null ? { finalsZoneId } : { finalsZoneId, whereDefault: 'finals' });
    if (ids.length) t.update(categories).set({ finalsWhere: null }).where(and(eq(categories.competitionId, competitionId), inArray(categories.id, ids))).run();
  });
}

/**
 * « Où » et « Quand » des finales de catégories de la session : celles de `categoryIds`, ou sans `categoryIds` (« Tout… »)
 * toutes les catégories de la session, et la valeur de la session (prise par une catégorie qui y arrive ensuite).
 */
export async function setCategoryFinals(
  db: AppDb,
  competitionId: string,
  waveId: string | null,
  patch: { categoryIds?: string[]; where?: FinalsWhere; when?: FinalsWhen },
): Promise<void> {
  await checkSession(db, competitionId, waveId);
  const members = await sessionCategoryIds(db, competitionId, waveId);
  if (patch.categoryIds?.some((id) => !members.includes(id))) throw new RegistrationValidationError(['Catégorie hors de cette session.']);
  const ids = patch.categoryIds ?? members;
  const values = { ...(patch.where ? { finalsWhere: patch.where } : {}), ...(patch.when ? { finalsWhen: patch.when } : {}) };
  if (Object.keys(values).length === 0) return;
  db.transaction((tx) => {
    const t = tx as unknown as AppDb;
    if (!patch.categoryIds) upsertWave(t, competitionId, waveId, { ...(patch.where ? { whereDefault: patch.where } : {}), ...(patch.when ? { whenDefault: patch.when } : {}) });
    if (ids.length) t.update(categories).set(values).where(and(eq(categories.competitionId, competitionId), inArray(categories.id, ids))).run();
  });
}
