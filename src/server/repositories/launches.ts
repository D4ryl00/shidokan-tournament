import { and, eq, inArray } from 'drizzle-orm';
import { activeEntrantCount, type Category } from '../../domain/categories.js';
import { DISCIPLINES } from '../../domain/disciplines.js';
import { appendPassages, planPassages, waveKey, type FrozenPassage } from '../../domain/passages/index.js';
import type { AppDb } from '../db/client.js';
import { categories, frozenPassages, waveLaunches } from '../db/schema.js';
import { listCategories } from './categories.js';
import { planInput } from './passages.js';
import { NotFoundError, RegistrationValidationError } from './registrations.js';
import { listWaves } from './waves.js';

export type WaveState = 'preparation' | 'launched' | 'reopened' | 'finished';

const playable = (c: Category) => !!c.bracket && activeEntrantCount(c) >= 2;
const now = () => new Date().toISOString();

function launches(db: AppDb, competitionId: string) {
  return new Map(db.select().from(waveLaunches).where(eq(waveLaunches.competitionId, competitionId)).all().map((r) => [r.waveKey, r]));
}

/** Catégories portant des numéros figés d'une vague actuellement lancée (sans synchronisation : utilisable par elle). */
export function launchedCategoryIds(db: AppDb, competitionId: string): Set<string> {
  const launched = [...launches(db, competitionId).values()].filter((r) => r.launched).map((r) => r.waveKey);
  if (launched.length === 0) return new Set();
  return new Set(
    db.select({ id: frozenPassages.categoryId }).from(frozenPassages)
      .where(and(eq(frozenPassages.competitionId, competitionId), inArray(frozenPassages.waveKey, launched)))
      .all()
      .map((r) => r.id),
  );
}

/** Clés des vagues actuellement lancées. */
export function launchedWaveKeys(db: AppDb, competitionId: string): Set<string> {
  return new Set([...launches(db, competitionId).values()].filter((r) => r.launched).map((r) => r.waveKey));
}

/** Vague demandée : une vague connue, ou la vague implicite (null) d'une compétition sans vague. */
async function checkWave(db: AppDb, competitionId: string, waveId: string | null) {
  const waves = await listWaves(db, competitionId);
  if (waveId === null && waves.length > 0) throw new RegistrationValidationError(['Choisissez la vague.']);
  if (waveId !== null && !waves.some((w) => w.id === waveId)) throw new NotFoundError('Vague introuvable');
  return waves;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** État d'une vague, ce qui empêche de la lancer, catégories à numéroter et numéros de chaque zone (avec `restart` : aperçu). */
export async function launchStatus(db: AppDb, competitionId: string, waveId: string | null, restart = false) {
  const waves = await checkWave(db, competitionId, waveId);
  const key = waveKey(waveId);
  const cats = await listCategories(db, competitionId);
  const input = await planInput(db, competitionId, cats, restart ? [key] : []);
  const plan = planPassages(input);
  const mine = cats.filter((c) => c.waveId === waveId && playable(c));
  const row = launches(db, competitionId).get(key);
  const finished = mine.length > 0 && mine.every((c) => c.status === 'finished');
  const state: WaveState = row?.launched ? (finished ? 'finished' : 'launched') : row ? 'reopened' : 'preparation';

  const blocking: string[] = [];
  if (row) blocking.push(row.launched ? 'La vague a déjà été lancée.' : 'La vague a déjà été lancée : « Numéroter à la suite » la refige.');
  const launched = launches(db, competitionId);
  const order = waves.find((w) => w.id === waveId)?.order ?? 0;
  for (const w of [...waves].sort((a, b) => a.order - b.order)) if (w.order < order && !launched.has(w.id)) blocking.push(`Lancez d’abord la vague « ${w.name} ».`);
  const impossible = plan.impossible.filter((x) => mine.some((c) => c.id === x.categoryId));
  if (impossible.length) {
    const counts = new Map<string, number>();
    for (const x of impossible) counts.set(x.discipline, (counts.get(x.discipline) ?? 0) + 1);
    blocking.push(`Aucune zone n’accepte : ${[...counts].map(([d, n]) => `${DISCIPLINES[d as keyof typeof DISCIPLINES].label} (${n} ${plural(n, 'catégorie', 'catégories')})`).join(', ')}.`);
  }
  const notReady = mine.filter((c) => c.status === 'provisional');
  if (notReady.length) {
    blocking.push(`${notReady.length} ${plural(notReady.length, 'catégorie n’est pas prête', 'catégories ne sont pas prêtes')} : ${notReady.map((c) => c.label).join(', ')}.`);
  }
  const label = new Map(cats.map((c) => [c.id, c.label]));
  return {
    state,
    blocking,
    pending: plan.pending.filter((p) => p.waveId === waveId).map((p) => ({ categoryId: p.categoryId, label: label.get(p.categoryId) ?? '' })),
    zones: plan.zones.map((z) => {
      const numbers = z.passages.filter((p) => p.waveId === waveId).map((p) => p.number);
      return { zoneId: z.zoneId, first: numbers.length ? Math.min(...numbers) : null, last: numbers.length ? Math.max(...numbers) : null };
    }),
  };
}

const rowOf = (competitionId: string, f: FrozenPassage) => ({ competitionId, waveKey: f.waveKey, zoneId: f.zoneId, number: f.number, categoryId: f.categoryId, matchId: f.matchId ?? 'kata', noRest: f.noRest });

/** Fixe l'appartenance (choix de vague) et la zone (épinglage) des catégories d'une vague lancée. */
function fixCategories(t: AppDb, cats: Category[], waveId: string | null, zoneOf: (id: string) => string | null) {
  for (const c of cats) {
    const set: { waveOverride?: string; zoneId?: string } = {};
    if (waveId !== null && c.waveOverride !== waveId) set.waveOverride = waveId;
    const zoneId = zoneOf(c.id);
    if (!c.zoneId && zoneId) set.zoneId = zoneId;
    if (Object.keys(set).length) t.update(categories).set(set).where(eq(categories.id, c.id)).run();
  }
}

/** « Figer et imprimer la vague » : numéros enregistrés, catégories fixées (vague, zone), vague lancée. */
export async function launchWave(db: AppDb, competitionId: string, waveId: string | null, opts: { restart: boolean }): Promise<void> {
  const status = await launchStatus(db, competitionId, waveId, opts.restart);
  if (status.blocking.length) throw new RegistrationValidationError(status.blocking);
  const key = waveKey(waveId);
  const cats = await listCategories(db, competitionId);
  const plan = planPassages(await planInput(db, competitionId, cats, opts.restart ? [key] : []));
  const rows = plan.zones.flatMap((z) => z.passages.filter((p) => p.waveId === waveId).map((p) => rowOf(competitionId, { ...p, waveKey: key, zoneId: z.zoneId })));
  db.transaction((tx) => {
    const t = tx as unknown as AppDb;
    if (rows.length) t.insert(frozenPassages).values(rows).run();
    fixCategories(t, cats.filter((c) => c.waveId === waveId), waveId, (id) => plan.categories[id]?.zoneId ?? null);
    t.insert(waveLaunches).values({ competitionId, waveKey: key, launched: true, restartNumbering: opts.restart, launchedAt: now() }).run();
  });
}

/** « Rouvrir la vague » : ses catégories sans résultat redeviennent modifiables ; ses numéros figés restent. */
export async function reopenWave(db: AppDb, competitionId: string, waveId: string | null): Promise<void> {
  await checkWave(db, competitionId, waveId);
  const row = launches(db, competitionId).get(waveKey(waveId));
  if (!row?.launched) throw new RegistrationValidationError(['La vague n’est pas lancée.']);
  db.update(waveLaunches).set({ launched: false }).where(and(eq(waveLaunches.competitionId, competitionId), eq(waveLaunches.waveKey, row.waveKey))).run();
}

/**
 * « Numéroter à la suite » : les catégories à numéroter de la vague (toutes, ou `categoryIds`) reçoivent des numéros après
 * le dernier numéro figé de leur zone ; la vague (re)passe lancée. `dryRun` : aperçu, rien n'est écrit.
 */
export async function numberPending(db: AppDb, competitionId: string, waveId: string | null, categoryIds?: string[], dryRun = false) {
  await checkWave(db, competitionId, waveId);
  const key = waveKey(waveId);
  const row = launches(db, competitionId).get(key);
  if (!row) throw new RegistrationValidationError(['La vague n’a pas encore été lancée.']);
  const cats = await listCategories(db, competitionId);
  const input = await planInput(db, competitionId, cats);
  const plan = planPassages(input);
  const ids = plan.pending.filter((p) => p.waveId === waveId && (!categoryIds || categoryIds.includes(p.categoryId))).map((p) => p.categoryId);
  const rows = appendPassages(input, waveId, ids);
  const label = new Map(cats.map((c) => [c.id, c.label]));
  const changes = ids.map((id) => ({ categoryId: id, label: label.get(id) ?? '', numbers: rows.filter((r) => r.categoryId === id).map((r) => r.number).sort((a, b) => a - b) }));
  if (dryRun) return { changes };
  db.transaction((tx) => {
    const t = tx as unknown as AppDb;
    if (ids.length) {
      t.delete(frozenPassages).where(and(eq(frozenPassages.competitionId, competitionId), eq(frozenPassages.waveKey, key), inArray(frozenPassages.categoryId, ids))).run();
      if (rows.length) t.insert(frozenPassages).values(rows.map((r) => rowOf(competitionId, r))).run();
      t.update(categories).set({ numbersUpdatedAt: now() }).where(inArray(categories.id, ids)).run();
    }
    fixCategories(t, cats.filter((c) => c.waveId === waveId), waveId, (id) => plan.categories[id]?.zoneId ?? null);
    t.update(waveLaunches).set({ launched: true }).where(and(eq(waveLaunches.competitionId, competitionId), eq(waveLaunches.waveKey, key))).run();
  });
  return { changes };
}
