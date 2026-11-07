import { and, eq } from 'drizzle-orm';
import { freeKey, freeNameError, isFreeKey, keyString, normalizeFreeName, type Category, type CategoryKey } from '../../domain/categories.js';
import { DISCIPLINES } from '../../domain/disciplines.js';
import type { DisciplineId, Ruleset } from '../../domain/types.js';
import { atomically } from '../db/atomic.js';
import type { AppDb } from '../db/client.js';
import { categories, registrations, tieBreaks } from '../db/schema.js';
import { CategoryLockedError, categoryById, syncCategories, wavePerCategory, type Journaled } from './categories.js';
import { entryOfRecasement, recorded, undoHistory } from './history.js';
import { launchedCategoryIds } from './launch-state.js';
import { NotFoundError, RegistrationValidationError } from './registrations.js';
import { lastValidatedRecasement, loadState } from './replacement.js';

type Row = typeof categories.$inferSelect;

/** Noms des tableaux libres de la compétition (sauf `exceptId`). */
function freeNames(db: AppDb, competitionId: string, exceptId?: string): string[] {
  return db
    .select()
    .from(categories)
    .where(eq(categories.competitionId, competitionId))
    .all()
    .filter((c) => c.id !== exceptId)
    .map((c) => (JSON.parse(c.keyJson) as CategoryKey).free)
    .filter((n): n is string => n !== undefined);
}

function checkName(name: string, existing: string[]): string {
  const error = freeNameError(name, existing);
  if (error) throw new RegistrationValidationError([error]);
  return normalizeFreeName(name);
}

/** Règlement exigé pour une discipline de combat, interdit pour le kata (mêmes messages que l'inscription). */
function checkRuleset(discipline: DisciplineId, ruleset: Ruleset | null): void {
  const d = DISCIPLINES[discipline];
  if (!d.hasWeight && ruleset !== null) throw new RegistrationValidationError([`Pas de règlement pour le ${d.label.toLowerCase()}.`]);
  if (d.hasWeight && ruleset === null) throw new RegistrationValidationError(['Le règlement (jiyu ou shobu) est obligatoire.']);
}

function freeRow(db: AppDb, competitionId: string, categoryId: string): Row & { key: CategoryKey } {
  const row = db.select().from(categories).where(and(eq(categories.id, categoryId), eq(categories.competitionId, competitionId))).get();
  if (!row) throw new NotFoundError('Catégorie introuvable');
  const key = JSON.parse(row.keyJson) as CategoryKey;
  if (!isFreeKey(key)) throw new RegistrationValidationError(["Ce n'est pas un tableau libre."]);
  return { ...row, key };
}

/** Refus d'un tableau lancé (commencé, terminé) ou d'une session lancée : il faut d'abord le déverrouiller. */
async function checkUnlocked(db: AppDb, competitionId: string, row: Row, action: string): Promise<void> {
  if (row.status === 'started' || row.status === 'finished') throw new CategoryLockedError();
  const frozen = launchedCategoryIds(db, competitionId).has(row.id) || (await loadState(db, competitionId)).categories.some((c) => c.id === row.id && c.frozen);
  if (frozen) throw new CategoryLockedError(`La session est lancée : rouvrez-la pour ${action} ce tableau libre.`);
}

/** Nouveau tableau libre, vide (sans session tant qu'elle n'est pas choisie). */
export async function createFreeTableau(
  db: AppDb,
  competitionId: string,
  input: { name: string; discipline: DisciplineId; ruleset: Ruleset | null },
): Promise<Category> {
  const name = checkName(input.name, freeNames(db, competitionId));
  checkRuleset(input.discipline, input.ruleset);
  const key = freeKey(name, input.discipline, input.ruleset);
  const id = crypto.randomUUID();
  db.insert(categories)
    .values({
      id, competitionId, keyString: keyString(key), keyJson: JSON.stringify(key), label: name, status: 'provisional',
      seed: crypto.getRandomValues(new Uint32Array(1))[0]!,
    })
    .run();
  return categoryById(db, competitionId, id);
}

/**
 * Renomme un tableau libre ou change sa discipline et son règlement : ses combattants les prennent aussi (vers le kata :
 * règlement et catégorie de poids retirés), sans toucher à leurs instantanés d'annulation ; le tableau est refait.
 */
export async function updateFreeTableau(
  db: AppDb,
  competitionId: string,
  categoryId: string,
  patch: { name?: string; discipline?: DisciplineId; ruleset?: Ruleset | null },
): Promise<Journaled> {
  const row = freeRow(db, competitionId, categoryId);
  await checkUnlocked(db, competitionId, row, 'modifier');
  const name = patch.name !== undefined ? checkName(patch.name, freeNames(db, competitionId, row.id)) : row.key.free!;
  const discipline = patch.discipline ?? row.key.discipline;
  // Discipline changée sans règlement : vers le kata, plus de règlement ; sinon celui d'avant (refusé s'il n'y en avait pas).
  const ruleset = patch.ruleset !== undefined ? patch.ruleset : DISCIPLINES[discipline].hasWeight ? row.key.ruleset : null;
  checkRuleset(discipline, ruleset);
  const key = freeKey(name, discipline, ruleset);
  const regrouped = discipline !== row.key.discipline || ruleset !== row.key.ruleset;
  const write = async () => {
    db.transaction((tx) => {
      const t = tx as unknown as AppDb;
      t.update(categories).set({ keyString: keyString(key), keyJson: JSON.stringify(key), label: name }).where(eq(categories.id, row.id)).run();
      if (regrouped) {
        t.update(registrations)
          .set({ discipline, ruleset, ...(DISCIPLINES[discipline].hasWeight ? {} : { weightClassId: null }) })
          .where(and(eq(registrations.competitionId, competitionId), eq(registrations.categoryId, row.id)))
          .run();
      }
    });
  };
  if (!regrouped) {
    await write();
    await syncCategories(db, competitionId);
    return { ...(await categoryById(db, competitionId, categoryId)), historyId: null };
  }
  // Discipline ou règlement changés : journalisé (état d'avant des membres et de la clé rétabli par l'annulation).
  const members = db.select({ id: registrations.id }).from(registrations).where(and(eq(registrations.competitionId, competitionId), eq(registrations.categoryId, row.id))).all().map((r) => r.id);
  const describe = (d: DisciplineId, r: Ruleset | null) => `${DISCIPLINES[d].label}${r ? ` · ${r === 'jiyu' ? 'Jiyu' : 'Shobu'}` : ''}`;
  const waveId = await wavePerCategory(db, competitionId, categoryId);
  const { historyId } = await recorded(
    db,
    competitionId,
    { kind: 'free', waveId, summary: { registrationIds: members, detail: `${row.key.free} : ${describe(row.key.discipline, row.key.ruleset)} ➜ ${describe(discipline, ruleset)}` }, registrations: members },
    write,
  );
  return { ...(await categoryById(db, competitionId, categoryId)), historyId };
}

/** Entrée de la dernière réaffectation manuelle (`M`) de chaque membre du tableau libre ; erreur si l'un n'y a pas été placé ainsi. */
export async function freeTableauDeleteTargets(db: AppDb, competitionId: string, categoryId: string): Promise<string[]> {
  const row = freeRow(db, competitionId, categoryId);
  const members = db
    .select({ id: registrations.id })
    .from(registrations)
    .where(and(eq(registrations.competitionId, competitionId), eq(registrations.categoryId, row.id)))
    .all()
    .map((r) => r.id);
  const targets = new Set<string>();
  for (const id of members) {
    const last = lastValidatedRecasement(db, competitionId, id);
    const entry = last && last.type === 'M' ? entryOfRecasement(db, competitionId, last.id) : undefined;
    if (!entry) throw new RegistrationValidationError(['Un combattant de ce tableau n’y a pas été placé par un déplacement manuel annulable : suppression refusée.']);
    targets.add(entry);
  }
  return [...targets];
}

/**
 * Supprime un tableau libre : chacun de ses combattants retourne là où il était juste avant d'y être placé (annulation de
 * son déplacement manuel, avec sa cascade, par l'historique). Tout ou rien : refusé si le tableau ou sa session est lancé, ou
 * si l'un d'eux ne peut pas revenir. `expect` : le lot affiché (null : pas de contrôle) ; périmé, rien n'est supprimé (409).
 */
export async function deleteFreeTableau(db: AppDb, competitionId: string, categoryId: string, expect: string[] | null): Promise<{ returned: number }> {
  const row = freeRow(db, competitionId, categoryId);
  await checkUnlocked(db, competitionId, row, 'supprimer');
  const targets = await freeTableauDeleteTargets(db, competitionId, categoryId);
  const returned = db.select({ id: registrations.id }).from(registrations).where(and(eq(registrations.competitionId, competitionId), eq(registrations.categoryId, row.id))).all().length;
  await atomically(db, async () => {
    if (targets.length) await undoHistory(db, competitionId, targets, expect);
    db.delete(tieBreaks).where(eq(tieBreaks.categoryId, row.id)).run();
    db.delete(categories).where(eq(categories.id, row.id)).run();
  });
  return { returned };
}
