import { eq, sql } from 'drizzle-orm';
import { isClock, type WaveSchedule } from '../../domain/schedule/types.js';
import type { AppDb } from '../db/client.js';
import { waveSchedules } from '../db/schema.js';
import { listWaves } from './waves.js';
import { RegistrationValidationError } from './registrations.js';

const FIELDS = ['plannedStart', 'actualStart', 'finalsStart'] as const;

/** Heures des sessions d'une compétition (celles qui en ont au moins une renseignée ou effacée). */
export function listWaveSchedules(db: AppDb, competitionId: string): WaveSchedule[] {
  return db
    .select()
    .from(waveSchedules)
    .where(eq(waveSchedules.competitionId, competitionId))
    .all()
    .map((r) => ({ waveId: r.waveKey === '' ? null : r.waveKey, plannedStart: r.plannedStart, actualStart: r.actualStart, finalsStart: r.finalsStart }));
}

/** Enregistre les heures données (les autres sont gardées) ; `null` efface une heure. */
export async function setWaveSchedule(
  db: AppDb,
  competitionId: string,
  waveId: string | null,
  patch: Partial<Omit<WaveSchedule, 'waveId'>>,
): Promise<WaveSchedule> {
  const sessions = await listWaves(db, competitionId);
  if (waveId === null ? sessions.length > 0 : !sessions.some((w) => w.id === waveId)) {
    throw new RegistrationValidationError([waveId === null ? 'Cette compétition a des sessions : choisissez-en une.' : 'Session inconnue pour cette compétition.']);
  }
  const values: Partial<Record<(typeof FIELDS)[number], string | null>> = {};
  for (const f of FIELDS) {
    const v = patch[f];
    if (v === undefined) continue;
    if (v !== null && !isClock(v)) throw new RegistrationValidationError(['Heure invalide : utilisez le format HH:MM (24 h).']);
    values[f] = v;
  }
  const waveKey = waveId ?? '';
  db.insert(waveSchedules)
    .values({ competitionId, waveKey, ...values })
    .onConflictDoUpdate({ target: [waveSchedules.competitionId, waveSchedules.waveKey], set: Object.keys(values).length ? values : { waveKey: sql`excluded.wave_key` } })
    .run();
  return listWaveSchedules(db, competitionId).find((s) => s.waveId === waveId)!;
}
