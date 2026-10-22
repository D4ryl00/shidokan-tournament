import { and, eq, inArray } from 'drizzle-orm';
import { activeEntrantCount, type Category } from '../../domain/categories.js';
import { DISCIPLINES } from '../../domain/disciplines.js';
import { appendPassages, finalMatchIds, planPassages, reshuffleZone, segmentOf, waveKey, type FrozenPassage, type PlanInput } from '../../domain/passages/index.js';
import type { AppDb } from '../db/client.js';
import { categories, frozenPassages, waveLaunches } from '../db/schema.js';
import { CategoryLockedError, listCategories, syncCategories } from './categories.js';
import { launchRows, launchedCategoryIds } from './launch-state.js';
import { planInput } from './passages.js';
import { NotFoundError, RegistrationValidationError } from './registrations.js';
import { listWaves } from './waves.js';
import { listZones } from './zones.js';

export type WaveState = 'preparation' | 'launched' | 'reopened' | 'finished';
/** « À la suite » (défaut) ou « mélangés ». */
export type RenumberMode = 'append' | 'shuffle';

const playable = (c: Category) => !!c.bracket && activeEntrantCount(c) >= 2;
const now = () => new Date().toISOString();

/** Vague demandée : une vague connue, ou la vague implicite (null) d'une compétition sans vague. */
async function checkWave(db: AppDb, competitionId: string, waveId: string | null) {
  const waves = await listWaves(db, competitionId);
  if (waveId === null && waves.length > 0) throw new RegistrationValidationError(['Choisissez la session.']);
  if (waveId !== null && !waves.some((w) => w.id === waveId)) throw new NotFoundError('Session introuvable');
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
  const launched = launchRows(db, competitionId);
  const row = launched.get(key);
  const finished = mine.length > 0 && mine.every((c) => c.status === 'finished');
  const state: WaveState = row?.launched ? (finished ? 'finished' : 'launched') : row ? 'reopened' : 'preparation';

  const blocking: string[] = [];
  if (row) blocking.push(row.launched ? 'La session a déjà été lancée.' : 'La session a déjà été lancée : « Numéroter à la suite » la refige.');
  const order = waves.find((w) => w.id === waveId)?.order ?? 0;
  for (const w of [...waves].sort((a, b) => a.order - b.order)) if (w.order < order && !launched.has(w.id)) blocking.push(`Lancez d’abord la session « ${w.name} ».`);
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
  const row = launchRows(db, competitionId).get(waveKey(waveId));
  if (!row?.launched) throw new RegistrationValidationError(['La session n’est pas lancée.']);
  db.update(waveLaunches).set({ launched: false }).where(and(eq(waveLaunches.competitionId, competitionId), eq(waveLaunches.waveKey, row.waveKey))).run();
}

/**
 * « Numéroter à la suite » : les catégories à numéroter de la vague (toutes, ou `categoryIds`) reçoivent des numéros après
 * le dernier numéro figé de leur zone ; la vague (re)passe lancée. `dryRun` : aperçu, rien n'est écrit.
 */
export async function numberPending(db: AppDb, competitionId: string, waveId: string | null, categoryIds?: string[], dryRun = false, mode: RenumberMode = 'append') {
  await checkWave(db, competitionId, waveId);
  const key = waveKey(waveId);
  const row = launchRows(db, competitionId).get(key);
  if (!row) throw new RegistrationValidationError(['La session n’a pas encore été lancée.']);
  const cats = await listCategories(db, competitionId);
  const input = await planInput(db, competitionId, cats);
  const plan = planPassages(input);
  const ids = plan.pending.filter((p) => p.waveId === waveId && (!categoryIds || categoryIds.includes(p.categoryId))).map((p) => p.categoryId);
  const appended = appendPassages(input, waveId, ids);
  // Mélangés : chaque zone qui reçoit une catégorie à numéroter est refaite (ses autres catégories comprises).
  const zonesRedone = mode === 'append' ? [] : [...new Set(appended.map((r) => r.zoneId))];
  const rows = mode === 'append' ? appended : zonesRedone.flatMap((zoneId) => reshuffleZone(input, zoneId, waveId, ids));
  const changed = renumbered(input, rows, ids);
  const label = new Map(cats.map((c) => [c.id, c.label]));
  const changes = changed.map((id) => ({ categoryId: id, label: label.get(id) ?? '', numbers: rows.filter((r) => r.categoryId === id).map((r) => r.number).sort((a, b) => a - b) }));
  // Comme au lancement : chaque catégorie numérotée est prête et a une zone.
  const blocking: string[] = [];
  const notReady = cats.filter((c) => ids.includes(c.id) && c.status === 'provisional');
  if (notReady.length) {
    blocking.push(`${notReady.length} ${plural(notReady.length, 'catégorie n’est pas prête', 'catégories ne sont pas prêtes')} : ${notReady.map((c) => c.label).join(', ')}.`);
  }
  const zoneless = ids.filter((id) => !plan.categories[id]?.zoneId);
  if (zoneless.length) blocking.push(`Sans zone possible : ${zoneless.map((id) => label.get(id)).join(', ')}.`);
  if (dryRun) return { changes, blocking };
  if (blocking.length) throw new RegistrationValidationError(blocking);
  // Catégories qui ne sont plus dans la vague (changées de vague, supprimées) : leurs anciens numéros deviennent des trous.
  const members = new Set(cats.filter((c) => c.waveId === waveId).map((c) => c.id));
  const gone = [...new Set(input.frozen!.filter((f) => f.waveKey === key && !members.has(f.categoryId)).map((f) => f.categoryId))];
  db.transaction((tx) => {
    const t = tx as unknown as AppDb;
    if (gone.length) t.delete(frozenPassages).where(and(eq(frozenPassages.competitionId, competitionId), eq(frozenPassages.waveKey, key), inArray(frozenPassages.categoryId, gone))).run();
    replaceRows(t, competitionId, input, rows, ids, undefined, zonesRedone.map((zoneId) => ({ zoneId, waves: segmentOf(input, waveId) })));
    if (changed.length) t.update(categories).set({ numbersUpdatedAt: now() }).where(inArray(categories.id, changed)).run();
    fixCategories(t, cats.filter((c) => c.waveId === waveId), waveId, (id) => plan.categories[id]?.zoneId ?? null);
    t.update(waveLaunches).set({ launched: true }).where(and(eq(waveLaunches.competitionId, competitionId), eq(waveLaunches.waveKey, key))).run();
  });
  return { changes, blocking };
}

/**
 * « Régénérer (renuméroté à la suite) » : une catégorie non commencée d'une vague lancée retrouve un tableau à jour
 * de ses inscrits, puis des numéros à la suite sur sa zone (confirmation demandée par l'écran).
 */
export async function regenerateCategory(db: AppDb, competitionId: string, categoryId: string) {
  const cat = (await listCategories(db, competitionId)).find((c) => c.id === categoryId);
  if (!cat) throw new NotFoundError('Catégorie introuvable');
  if (cat.status === 'started' || cat.status === 'finished') throw new CategoryLockedError();
  if (!launchedCategoryIds(db, competitionId).has(categoryId)) throw new RegistrationValidationError(['La session de cette catégorie n’est pas lancée : son tableau se met à jour tout seul.']);
  await syncCategories(db, competitionId, { regenerate: categoryId });
  const result = await numberPending(db, competitionId, cat.waveId, [categoryId]);
  // Tableau refait (mêmes numéros ou non) : à réimprimer.
  db.update(categories).set({ numbersUpdatedAt: now() }).where(eq(categories.id, categoryId)).run();
  return result;
}

const keyOf = (r: { waveKey: string; categoryId: string; matchId: string | null }) => `${r.waveKey}|${r.categoryId}|${r.matchId ?? 'kata'}`;
const playedKey = (r: { categoryId: string; matchId: string | null }) => `${r.categoryId}:${r.matchId ?? 'kata'}`;

/** Catégories dont un numéro change : `whole` (renumérotées entièrement) et celles dont une ligne prend un autre numéro ou une autre zone. */
function renumbered(input: PlanInput, rows: FrozenPassage[], whole: string[]): string[] {
  const old = new Map((input.frozen ?? []).map((f) => [keyOf(f), f]));
  const out = new Set(whole);
  for (const r of rows) {
    const f = old.get(keyOf(r));
    if (!f || f.number !== r.number || f.zoneId !== r.zoneId) out.add(r.categoryId);
  }
  return [...out];
}

/**
 * Remplace des numéros figés : les lignes réécrites (`rows`) et les anciennes lignes non gardées des catégories `whole`
 * (à numéroter, déplacée) disparaissent, puis `rows` sont enregistrées. Les passages gardés (`keep` : joués, finale restée
 * sur la zone des finales) ne bougent pas. `shuffled` : zones refaites en « mélangés » — toute autre ligne non gardée de ces
 * zones (catégorie devenue non jouable ou à numéroter) disparaît aussi, pour qu'aucun ancien numéro n'en double un nouveau.
 */
function replaceRows(
  t: AppDb,
  competitionId: string,
  input: PlanInput,
  rows: FrozenPassage[],
  whole: string[],
  keep: Set<string> = input.played ?? new Set(),
  shuffled: { zoneId: string; waves: string[] }[] = [],
) {
  const rewritten = new Set(rows.map(keyOf));
  for (const f of input.frozen ?? []) {
    const kept = keep.has(playedKey(f));
    const stale = !kept && shuffled.some((z) => z.zoneId === f.zoneId && z.waves.includes(f.waveKey));
    const gone = rewritten.has(keyOf(f)) || (whole.includes(f.categoryId) && !kept) || stale;
    if (!gone) continue;
    t.delete(frozenPassages)
      .where(and(eq(frozenPassages.competitionId, competitionId), eq(frozenPassages.waveKey, f.waveKey), eq(frozenPassages.categoryId, f.categoryId), eq(frozenPassages.matchId, f.matchId ?? 'kata')))
      .run();
  }
  if (rows.length) t.insert(frozenPassages).values(rows.map((r) => rowOf(competitionId, r))).run();
}

export interface MoveResult {
  changes: { categoryId: string; label: string; matchId: string | null; from: { zoneId: string; number: number } | null; to: { zoneId: string; number: number } }[];
  reprint: { categoryId: string; label: string }[];
}

/**
 * Déplace une catégorie d'une vague lancée vers une autre zone : ses passages non joués (une finale restée sur la zone
 * des finales ne bouge pas) prennent des numéros « à la suite » sur la zone d'arrivée, ou toute la zone d'arrivée est
 * « mélangée ». Les passages joués gardent numéro et zone. `dryRun` : aperçu.
 */
export async function moveCategory(db: AppDb, competitionId: string, categoryId: string, zoneId: string, mode: RenumberMode, dryRun = false): Promise<MoveResult> {
  const cats = await listCategories(db, competitionId);
  const cat = cats.find((c) => c.id === categoryId);
  if (!cat) throw new NotFoundError('Catégorie introuvable');
  const zone = (await listZones(db, competitionId)).find((z) => z.id === zoneId);
  if (!zone) throw new NotFoundError('Zone introuvable');
  if (!cat.launchLocked) {
    throw new RegistrationValidationError(['La session n’est pas lancée : choisissez simplement la zone de la catégorie (puis « Refiger » si la session a été rouverte).']);
  }
  const input = await planInput(db, competitionId, cats);
  const plan = planPassages(input);
  const current = plan.categories[categoryId]?.zoneId ?? null;
  if (current === zoneId) throw new RegistrationValidationError(['La catégorie est déjà sur cette zone.']);
  if (zone.disciplines && !zone.disciplines.includes(cat.key.discipline)) {
    throw new RegistrationValidationError([`La zone « ${zone.name} » n’accueille pas le ${DISCIPLINES[cat.key.discipline].label.toLowerCase()}.`]);
  }
  // La finale restée sur la zone des finales y reste (sauf si la catégorie y arrive : elle y est renumérotée après ses demies).
  const finalsZone = input.finals?.zoneId ?? null;
  const finals = cat.bracket?.kind === 'combat' ? finalMatchIds(cat.bracket) : [];
  const pinned = new Set(
    (input.frozen ?? [])
      .filter((f) => f.categoryId === categoryId && f.zoneId === finalsZone && zoneId !== finalsZone && (f.matchId === 'kata:finale' || finals.includes(f.matchId ?? '')))
      .map(playedKey),
  );
  const opts = { pinned, zoneOf: { [categoryId]: zoneId } };
  const rows = mode === 'append' ? appendPassages(input, cat.waveId, [categoryId], opts) : reshuffleZone(input, zoneId, cat.waveId, [categoryId], opts);
  if (!rows.some((r) => r.categoryId === categoryId)) throw new RegistrationValidationError(['Tous ses combats sont joués : rien à déplacer.']);
  const keep = new Set([...(input.played ?? []), ...pinned]);
  const old = new Map((input.frozen ?? []).map((f) => [keyOf(f), f]));
  const label = new Map(cats.map((c) => [c.id, c.label]));
  const changes = rows
    .map((r) => {
      const f = old.get(keyOf(r));
      return { categoryId: r.categoryId, label: label.get(r.categoryId) ?? '', matchId: r.matchId, from: f ? { zoneId: f.zoneId, number: f.number } : null, to: { zoneId: r.zoneId, number: r.number } };
    })
    .filter((c) => !c.from || c.from.number !== c.to.number || c.from.zoneId !== c.to.zoneId)
    .sort((a, b) => a.to.number - b.to.number);
  const changed = [...new Set([categoryId, ...changes.map((c) => c.categoryId)])];
  const reprint = changed.map((id) => ({ categoryId: id, label: label.get(id) ?? '' }));
  if (dryRun) return { changes, reprint };
  db.transaction((tx) => {
    const t = tx as unknown as AppDb;
    // Seules les lignes non gardées de la catégorie déplacée disparaissent (pas sa finale sur la zone des finales).
    replaceRows(t, competitionId, input, rows, [categoryId], keep, mode === 'shuffle' ? [{ zoneId, waves: segmentOf(input, cat.waveId) }] : []);
    t.update(categories).set({ zoneId }).where(eq(categories.id, categoryId)).run();
    t.update(categories).set({ numbersUpdatedAt: now() }).where(inArray(categories.id, changed)).run();
  });
  return { changes, reprint };
}
