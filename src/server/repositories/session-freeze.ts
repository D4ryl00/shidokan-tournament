import { and, eq, isNotNull } from 'drizzle-orm';
import type { AppDb } from '../db/client.js';
import { categories, competitions } from '../db/schema.js';
import { recordJournal } from '../journal/write.js';
import { CategoryLockedError, syncCategories, wavesToFreeze } from './categories.js';
import { getCompetition } from './competitions.js';
import { NotFoundError } from './registrations.js';
import { listWaves } from './waves.js';

/** Heure du gel lue dans la transaction (un autre onglet a pu figer ou défiger entre-temps). */
const frozenAtNow = (t: AppDb, competitionId: string) =>
  t.select({ at: competitions.sessionsFrozenAt }).from(competitions).where(eq(competitions.id, competitionId)).get()?.at ?? null;

/**
 * « Figer les sessions » : après une synchronisation, chaque catégorie non libre garde la session calculée maintenant
 * (`none` si elle est en attente), sans tenir compte des choix manuels, qui restent prioritaires. Refus sans session ou
 * si c'est déjà figé.
 */
export async function freezeSessions(db: AppDb, competitionId: string): Promise<{ frozenAt: string; count: number }> {
  const competition = await getCompetition(db, competitionId);
  if (!competition) throw new NotFoundError('Compétition introuvable');
  if ((await listWaves(db, competitionId)).length === 0) throw new CategoryLockedError('Aucune session à figer : créez d’abord les sessions.');
  if (competition.sessionsFrozenAt !== null) throw new CategoryLockedError('Les sessions sont déjà figées.');
  await syncCategories(db, competitionId);
  const waves = await wavesToFreeze(db, competitionId);
  const frozenAt = new Date().toISOString();
  let count = 0;
  db.transaction((tx) => {
    const t = tx as unknown as AppDb;
    if (frozenAtNow(t, competitionId) !== null) throw new CategoryLockedError('Les sessions sont déjà figées.');
    for (const [id, frozenWave] of waves) {
      count += t.update(categories).set({ frozenWave }).where(and(eq(categories.id, id), eq(categories.competitionId, competitionId))).run().changes;
    }
    t.update(competitions).set({ sessionsFrozenAt: frozenAt }).where(eq(competitions.id, competitionId)).run();
    recordJournal(t, competitionId, { type: 'session', action: 'sessions-frozen', via: 'sessions', data: { count } });
  });
  return { frozenAt, count };
}

/** « Ne plus figer » : plus aucune session figée ; les choix manuels (`waveOverride`) restent. Refus si ce n'est pas figé. */
export async function unfreezeSessions(db: AppDb, competitionId: string): Promise<void> {
  const competition = await getCompetition(db, competitionId);
  if (!competition) throw new NotFoundError('Compétition introuvable');
  db.transaction((tx) => {
    const t = tx as unknown as AppDb;
    if (frozenAtNow(t, competitionId) === null) throw new CategoryLockedError('Les sessions ne sont pas figées.');
    t.update(categories).set({ frozenWave: null }).where(and(eq(categories.competitionId, competitionId), isNotNull(categories.frozenWave))).run();
    t.update(competitions).set({ sessionsFrozenAt: null }).where(eq(competitions.id, competitionId)).run();
    recordJournal(t, competitionId, { type: 'session', action: 'sessions-unfrozen', via: 'sessions', data: {} });
  });
}
