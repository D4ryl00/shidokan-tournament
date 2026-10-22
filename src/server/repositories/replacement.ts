import { and, eq, inArray, sql } from 'drizzle-orm';
import { defaultFormat, generateBracket, resolveBracket } from '../../domain/brackets/index.js';
import { categoryLabel, compareKeys, keyString } from '../../domain/categories.js';
import { DISCIPLINES } from '../../domain/disciplines.js';
import {
  activeMembers,
  applyProposal,
  detectCases,
  moveViolations,
  nextBulkStep,
  proposalsFor,
  stateFingerprint,
  isOverweight,
  overweightInCategory,
  recompute,
  type BulkMode,
  type Member,
  type Presence,
  type Proposal,
  type State,
} from '../../domain/replacement/index.js';
import type { AppDb } from '../db/client.js';
import { categories, clubs, competitions, fighters, recasements, refusals, registrations, waves } from '../db/schema.js';
import { listWaves } from './waves.js';
import { CategoryLockedError, listCategories, syncCategories } from './categories.js';
import { getCompetition, getGrid } from './competitions.js';
import { NotFoundError, RegistrationValidationError } from './registrations.js';

export class StaleProposalError extends Error {
  constructor(message = "La situation a changé depuis l'affichage : rechargez les propositions.") {
    super(message);
  }
}

/** État du recasement, après synchronisation des catégories. */
export async function loadState(db: AppDb, competitionId: string): Promise<State> {
  await syncCategories(db, competitionId);
  const competition = await getCompetition(db, competitionId);
  if (!competition) throw new NotFoundError('Compétition introuvable');
  const grid = await getGrid(db, competitionId);
  const fs = new Map(db.select().from(fighters).where(eq(fighters.competitionId, competitionId)).all().map((f) => [f.id, f]));
  const cs = new Map(db.select().from(clubs).where(eq(clubs.competitionId, competitionId)).all().map((c) => [c.id, c]));
  const members: Member[] = db
    .select()
    .from(registrations)
    .where(eq(registrations.competitionId, competitionId))
    .all()
    .map((r) => {
      const f = fs.get(r.fighterId)!;
      const club = f.clubId ? cs.get(f.clubId) : undefined;
      return {
        registrationId: r.id,
        fighterId: f.id,
        clubId: f.clubId,
        clubPreApproval: club?.preApproval ?? false,
        label: `${f.lastName} ${f.firstName}`.trim(),
        sex: f.sex,
        ageBandCode: f.ageBandCode,
        discipline: r.discipline,
        ruleset: r.ruleset,
        weightClassId: r.weightClassId,
        weighInKg: f.weighInKg,
        approxWeightKg: r.approxWeightKg,
        presence: r.presence,
        otherDisciplines: JSON.parse(r.otherDisciplinesJson),
        acceptsJiyuFirst: r.acceptsJiyuFirst,
        categoryId: r.categoryId,
        placementLocked: r.placementLocked,
        original: r.originalJson ? JSON.parse(r.originalJson) : null,
        recasementType: (r.recasementType as Member['recasementType']) ?? null,
      };
    });
  return {
    grid,
    settings: competition.settings,
    categories: db
      .select()
      .from(categories)
      .where(eq(categories.competitionId, competitionId))
      .all()
      .map((c) => ({ id: c.id, key: JSON.parse(c.keyJson), status: c.status, aliasKeys: JSON.parse(c.aliasKeys) })),
    members,
    refused: db.select().from(refusals).where(eq(refusals.competitionId, competitionId)).all().map((r) => r.proposalId),
  };
}

export function allProposals(state: State): Map<string, Proposal[]> {
  return new Map(detectCases(state).map((c) => [c.id, proposalsFor(state, c)]));
}

/** Propositions à afficher : les valides, puis les refusées encore pertinentes (grisées, avec « Rétablir »). */
export function displayedProposals(state: State): Map<string, (Proposal & { refused?: true })[]> {
  const all = { ...state, refused: [] };
  const refused = new Set(state.refused);
  return new Map(
    detectCases(state).map((c) => [
      c.id,
      [...proposalsFor(state, c), ...proposalsFor(all, c).filter((p) => refused.has(p.id)).map((p) => ({ ...p, refused: true as const }))],
    ]),
  );
}

function findProposal(state: State, proposalId: string): Proposal {
  for (const list of allProposals(state).values()) {
    const p = list.find((x) => x.id === proposalId);
    if (p) return p;
  }
  throw new StaleProposalError('Proposition périmée : rechargez les propositions.');
}

type CategoryRow = typeof categories.$inferSelect;

/** Écrit en base le passage de `before` à `after` pour l'inscription déplacée par `p`, et journalise. */
function persist(db: AppDb, competitionId: string, before: State, after: State, p: Proposal, opts: { bulk: boolean }): void {
  const m0 = before.members.find((m) => m.registrationId === p.registrationId)!;
  const m1 = after.members.find((m) => m.registrationId === p.registrationId)!;
  const fromCat = before.categories.find((c) => c.id === m0.categoryId);
  db.transaction((tx) => {
    const t = tx as unknown as AppDb;
    const rows = new Map(t.select().from(categories).where(eq(categories.competitionId, competitionId)).all().map((c) => [c.id, c]));
    const snapshotCategories: Pick<CategoryRow, 'id' | 'keyString' | 'keyJson' | 'aliasKeys' | 'label'>[] = [];
    const idMap = new Map<string, string>();
    for (const c of after.categories) {
      const ks = keyString(c.key);
      const label = categoryLabel(c.key, after.grid);
      const values = { keyString: ks, keyJson: JSON.stringify(c.key), aliasKeys: JSON.stringify(c.aliasKeys), label };
      const row = rows.get(c.id);
      if (!row) {
        const id = crypto.randomUUID();
        idMap.set(c.id, id);
        t.insert(categories).values({ id, competitionId, status: 'provisional', seed: crypto.getRandomValues(new Uint32Array(1))[0]!, ...values }).run();
      } else if (row.keyString !== ks || row.aliasKeys !== values.aliasKeys) {
        snapshotCategories.push({ id: row.id, keyString: row.keyString, keyJson: row.keyJson, aliasKeys: row.aliasKeys, label: row.label });
        t.update(categories).set(values).where(eq(categories.id, c.id)).run();
      }
    }
    const regRow = t.select().from(registrations).where(eq(registrations.id, p.registrationId)).get()!;
    const snapshot = {
      registration: {
        categoryId: regRow.categoryId,
        placementLocked: regRow.placementLocked,
        originalJson: regRow.originalJson,
        recasementType: regRow.recasementType,
        discipline: regRow.discipline,
        ruleset: regRow.ruleset,
        weightClassId: regRow.weightClassId,
      },
      categories: snapshotCategories,
    };
    t.update(registrations)
      .set({
        categoryId: idMap.get(m1.categoryId!) ?? m1.categoryId,
        placementLocked: m1.placementLocked,
        originalJson: m1.original ? JSON.stringify(m1.original) : null,
        recasementType: m1.recasementType,
        discipline: m1.discipline,
        ruleset: m1.ruleset,
        weightClassId: m1.weightClassId,
      })
      .where(eq(registrations.id, p.registrationId))
      .run();
    const toCat = after.categories.find((c) => c.id === m1.categoryId)!;
    t.insert(recasements)
      .values({
        id: crypto.randomUUID(),
        competitionId,
        registrationId: p.registrationId,
        proposalId: p.id,
        type: p.type,
        fromLabel: fromCat ? categoryLabel(fromCat.key, before.grid) : '—',
        toLabel: categoryLabel(toCat.key, after.grid),
        reason: p.reason,
        manual: p.manual,
        preApproved: p.preApproved,
        bulk: opts.bulk,
        snapshotJson: JSON.stringify(snapshot),
      })
      .run();
  });
}

export async function applyProposalById(db: AppDb, competitionId: string, proposalId: string, opts: { bulk?: boolean; fingerprint?: string } = {}): Promise<void> {
  const state = await loadState(db, competitionId);
  if (opts.fingerprint !== undefined && stateFingerprint(state) !== opts.fingerprint) throw new StaleProposalError();
  const p = findProposal(state, proposalId);
  persist(db, competitionId, state, applyProposal(state, p), p, { bulk: opts.bulk ?? false });
  await syncCategories(db, competitionId);
}

export async function bulkApply(db: AppDb, competitionId: string, mode: BulkMode, fingerprint: string): Promise<{ applied: number }> {
  let state = await loadState(db, competitionId);
  if (stateFingerprint(state) !== fingerprint) throw new StaleProposalError();
  const moved = new Set<string>();
  let applied = 0;
  for (let guard = 0; guard <= state.members.length; guard++) {
    const p = nextBulkStep(state, mode, moved);
    if (!p) break;
    persist(db, competitionId, state, applyProposal(state, p), p, { bulk: true });
    moved.add(p.registrationId);
    applied++;
    state = await loadState(db, competitionId);
  }
  return { applied };
}

export async function refuseProposal(db: AppDb, competitionId: string, proposalId: string): Promise<void> {
  db.insert(refusals).values({ competitionId, proposalId }).onConflictDoNothing().run();
}

export async function unrefuseProposal(db: AppDb, competitionId: string, proposalId: string): Promise<void> {
  db.delete(refusals).where(and(eq(refusals.competitionId, competitionId), eq(refusals.proposalId, proposalId))).run();
}

/** Proposition « déplacement manuel » (type M) et ses avertissements ; refusée si l'une des deux catégories est lancée. */
export function manualProposal(state: State, registrationId: string, categoryId: string): { p: Proposal; warnings: string[] } {
  const m = state.members.find((x) => x.registrationId === registrationId);
  const t = state.categories.find((c) => c.id === categoryId);
  if (!m || !t) throw new NotFoundError('Inscription ou catégorie introuvable');
  const source = state.categories.find((c) => c.id === m.categoryId);
  const locked = (c: { status: string } | undefined) => c?.status === 'started' || c?.status === 'finished';
  if (locked(t) || locked(source)) throw new CategoryLockedError();
  const warnings = moveViolations(state, m, t);
  const toKata = !DISCIPLINES[t.key.discipline].hasWeight && DISCIPLINES[m.discipline].hasWeight;
  if (toKata) warnings.push(`Passage en ${DISCIPLINES[t.key.discipline].label.toLowerCase()} : règlement et catégorie de poids retirés.`);
  const p: Proposal = {
    id: `M:${registrationId}>${categoryId}`,
    caseId: 'manual',
    type: 'M',
    registrationId,
    target: { categoryId },
    changes: {
      ...(t.key.discipline !== m.discipline ? { discipline: t.key.discipline } : {}),
      ...(t.key.ruleset && t.key.ruleset !== m.ruleset ? { ruleset: t.key.ruleset } : {}),
      ...(toKata ? { ruleset: null, weightClassId: null } : {}),
    },
    checks: { weightGapKg: 0, threshold: 0, ageMove: 'same', crossesMinorAdult: false, mixedSex: t.key.sex !== m.sex },
    manual: true,
    preApproved: false,
    reason: 'Déplacement manuel',
    rank: 0,
  };
  return { p, warnings };
}

export async function manualMove(db: AppDb, competitionId: string, registrationId: string, categoryId: string): Promise<{ warnings: string[] }> {
  const state = await loadState(db, competitionId);
  const { p, warnings } = manualProposal(state, registrationId, categoryId);
  persist(db, competitionId, state, applyProposal(state, p), p, { bulk: false });
  await syncCategories(db, competitionId);
  return { warnings };
}

export async function undoRecasement(db: AppDb, competitionId: string, recasementId: string): Promise<void> {
  const entry = db.select().from(recasements).where(and(eq(recasements.id, recasementId), eq(recasements.competitionId, competitionId))).get();
  if (!entry || entry.status !== 'validated') throw new NotFoundError('Recasement introuvable');
  const snapshot = JSON.parse(entry.snapshotJson) as {
    registration: { categoryId: string | null; placementLocked: boolean; originalJson: string | null; recasementType: string | null; discipline: Member['discipline']; ruleset: Member['ruleset']; weightClassId: string | null };
    categories: { id: string; keyString: string; keyJson: string; aliasKeys: string; label: string }[];
  };
  const reg = db.select().from(registrations).where(eq(registrations.id, entry.registrationId)).get();
  if (!reg) throw new NotFoundError('Inscription introuvable');
  const locked = (id: string | null) => {
    const c = id ? db.select().from(categories).where(eq(categories.id, id)).get() : undefined;
    return c !== undefined && (c.status === 'started' || c.status === 'finished');
  };
  if (locked(reg.categoryId) || locked(snapshot.registration.categoryId)) throw new CategoryLockedError();
  // Ordre d'insertion (rowid) : fiable même pour deux recasements de la même milliseconde.
  const mine = db.select({ n: sql<number>`rowid` }).from(recasements).where(eq(recasements.id, entry.id)).get()!.n;
  const newer = db
    .select({ id: recasements.id, n: sql<number>`rowid` })
    .from(recasements)
    .where(and(eq(recasements.registrationId, entry.registrationId), eq(recasements.status, 'validated')))
    .all()
    .some((r) => r.id !== entry.id && r.n > mine);
  if (newer) throw new StaleProposalError("Annulez d'abord le recasement plus récent de ce combattant.");
  const touched = new Set([reg.categoryId, snapshot.registration.categoryId, ...snapshot.categories.map((c) => c.id)].filter((x): x is string => !!x));
  db.transaction((tx) => {
    const t = tx as unknown as AppDb;
    for (const c of snapshot.categories) {
      const { id, ...values } = c;
      t.update(categories).set(values).where(eq(categories.id, id)).run();
    }
    const previous = snapshot.registration;
    const exists = previous.categoryId && t.select().from(categories).where(eq(categories.id, previous.categoryId)).get();
    t.update(registrations)
      .set({ ...previous, categoryId: exists ? previous.categoryId : null })
      .where(eq(registrations.id, entry.registrationId))
      .run();
    t.update(recasements).set({ status: 'undone' }).where(eq(recasements.id, recasementId)).run();
  });
  // Les clés des catégories touchées sont recalculées d'après leurs membres actuels.
  await recomputeKeys(db, competitionId, () => [...touched]);
}

/** Recalcule et enregistre la clé des catégories choisies d'après leurs membres, puis resynchronise. */
async function recomputeKeys(db: AppDb, competitionId: string, pick: (state: State) => string[]): Promise<void> {
  const state = await loadState(db, competitionId);
  for (const id of pick(state)) {
    const cat = state.categories.find((c) => c.id === id);
    if (!cat || cat.status === 'started' || cat.status === 'finished') continue;
    const before = keyString(cat.key) + JSON.stringify(cat.aliasKeys);
    const previous = { key: cat.key, aliasKeys: cat.aliasKeys };
    recompute(state, cat);
    // Une clé déjà portée par une autre catégorie (clé ou alias) ferait fusionner les deux à la synchronisation :
    // la catégorie garde alors sa clé élargie.
    const ks = keyString(cat.key);
    if (state.categories.some((o) => o.id !== cat.id && (keyString(o.key) === ks || o.aliasKeys.includes(ks)))) Object.assign(cat, previous);
    if (keyString(cat.key) + JSON.stringify(cat.aliasKeys) === before) continue;
    db.update(categories)
      .set({ keyString: keyString(cat.key), keyJson: JSON.stringify(cat.key), aliasKeys: JSON.stringify(cat.aliasKeys), label: categoryLabel(cat.key, state.grid) })
      .where(eq(categories.id, id))
      .run();
  }
  await syncCategories(db, competitionId);
}

/** Catégories fusionnées par un recasement (elles seules ont une clé tirée de leurs membres). */
const mergedCategoryIds = (state: State) => [...new Set(state.members.filter((m) => m.placementLocked && m.categoryId).map((m) => m.categoryId!))];

export async function listRecasements(db: AppDb, competitionId: string) {
  return db
    .select({ row: recasements, n: sql<number>`rowid` })
    .from(recasements)
    .where(eq(recasements.competitionId, competitionId))
    .all()
    .sort((a, b) => b.n - a.n)
    .map(({ row: { snapshotJson: _s, ...r } }) => r);
}

// --- Pesée ---

/** Inscriptions des catégories d'une vague (vague inconnue : erreur 404). */
async function registrationsOfWave(db: AppDb, competitionId: string, waveId: string): Promise<Set<string>> {
  if (!(await listWaves(db, competitionId)).some((w) => w.id === waveId)) throw new NotFoundError('Vague introuvable');
  // Même calcul que l'écran (vague des catégories d'après leurs combattants d'origine).
  return new Set((await listCategories(db, competitionId)).filter((c) => c.waveId === waveId).flatMap((c) => c.registrationIds));
}

/** Avec des vagues, la pesée se fait toujours dans une vague : refus d'un pointage ou d'une clôture « toutes vagues ». */
async function requireWave(db: AppDb, competitionId: string, waveId: string | undefined): Promise<void> {
  if (!waveId && (await listWaves(db, competitionId)).length > 0) {
    throw new RegistrationValidationError(['Choisissez la vague de la pesée (rechargez la page si les vagues viennent d’être créées).']);
  }
}

/** Pesée d'un combattant ; avec une vague, la présence ne porte que sur ses inscriptions de cette vague. */
export async function setWeighIn(db: AppDb, competitionId: string, fighterId: string, data: { presence?: Presence; weighInKg?: number | null; waveId?: string }): Promise<void> {
  const f = db.select().from(fighters).where(and(eq(fighters.id, fighterId), eq(fighters.competitionId, competitionId))).get();
  if (!f) throw new NotFoundError('Combattant introuvable');
  await requireWave(db, competitionId, data.waveId);
  // Vague vérifiée avant toute écriture (une vague inconnue n'enregistre pas le poids).
  const scope = data.waveId ? [...(await registrationsOfWave(db, competitionId, data.waveId))] : null;
  if (data.weighInKg !== undefined) db.update(fighters).set({ weighInKg: data.weighInKg }).where(eq(fighters.id, fighterId)).run();
  // Un poids relevé vaut présence ; la présence se note sur les inscriptions du combattant.
  const presence = data.presence ?? (data.weighInKg !== undefined && data.weighInKg !== null ? 'present' : undefined);
  if (presence) {
    db.update(registrations)
      .set({ presence })
      .where(and(eq(registrations.fighterId, fighterId), scope ? inArray(registrations.id, scope) : undefined))
      .run();
  }
  await recomputeKeys(db, competitionId, mergedCategoryIds);
}

/**
 * Clôture de la pesée (avec une vague : seulement celle-ci). Un combattant déjà présent (inscription ajoutée après sa pesée,
 * sur place par exemple) le reste pour toutes ses inscriptions de la vague ; les autres non pesés deviennent absents.
 */
export async function closeWeighIn(db: AppDb, competitionId: string, waveId?: string): Promise<{ markedAbsent: number }> {
  await requireWave(db, competitionId, waveId);
  const scope = waveId ? await registrationsOfWave(db, competitionId, waveId) : null;
  const regs = db.select().from(registrations).where(eq(registrations.competitionId, competitionId)).all().filter((r) => !scope || scope.has(r.id));
  const present = new Set(regs.filter((r) => r.presence === 'present').map((r) => r.fighterId));
  const unknown = regs.filter((r) => r.presence === 'unknown');
  const promote = unknown.filter((r) => present.has(r.fighterId)).map((r) => r.id);
  const absent = unknown.filter((r) => !present.has(r.fighterId));
  if (promote.length) db.update(registrations).set({ presence: 'present' }).where(inArray(registrations.id, promote)).run();
  if (absent.length) db.update(registrations).set({ presence: 'absent' }).where(inArray(registrations.id, absent.map((r) => r.id))).run();
  const markedAbsent = new Set(absent.map((r) => r.fighterId));
  if (waveId) db.update(waves).set({ weighInClosed: true }).where(eq(waves.id, waveId)).run();
  else db.update(competitions).set({ weighInClosed: true }).where(eq(competitions.id, competitionId)).run();
  await recomputeKeys(db, competitionId, mergedCategoryIds);
  return { markedAbsent: markedAbsent.size };
}

/** Présence d'un combattant d'après ses inscriptions : présent si l'une l'est, absent si toutes le sont, sinon non pesé. */
export function fighterPresence(members: Pick<Member, 'presence'>[]): Presence {
  if (members.some((m) => m.presence === 'present')) return 'present';
  if (members.length > 0 && members.every((m) => m.presence === 'absent')) return 'absent';
  return 'unknown';
}

/** Liste de pesée ; avec une vague : ses combattants et leurs inscriptions de la vague seulement. */
export async function weighInList(db: AppDb, competitionId: string, waveId?: string) {
  const state = await loadState(db, competitionId);
  const competition = db.select().from(competitions).where(eq(competitions.id, competitionId)).get()!;
  const scope = waveId ? await registrationsOfWave(db, competitionId, waveId) : null;
  const inScope = (m: Member) => !scope || scope.has(m.registrationId);
  const closed = waveId ? (await listWaves(db, competitionId)).find((w) => w.id === waveId)!.weighInClosed : competition.weighInClosed;
  const fs = db.select().from(fighters).where(eq(fighters.competitionId, competitionId)).all();
  const cs = new Map(db.select().from(clubs).where(eq(clubs.competitionId, competitionId)).all().map((c) => [c.id, c.name]));
  const label = (id: string | null) => (id ? (state.grid.weightClasses.find((w) => w.id === id)?.label ?? '?') : null);
  // Rang de chaque catégorie dans l'ordre de la grille (feuilles de pesée par catégorie).
  const categoryOrder = new Map([...state.categories].sort((a, b) => compareKeys(a.key, b.key, state.grid)).map((c, i) => [c.id, i]));
  return {
    closed,
    fighters: fs
      .filter((f) => !scope || state.members.some((m) => m.fighterId === f.id && inScope(m)))
      .map((f) => ({
        fighterId: f.id,
        label: `${f.lastName} ${f.firstName}`.trim(),
        club: f.clubId ? (cs.get(f.clubId) ?? '') : '',
        sex: f.sex,
        ageBandCode: f.ageBandCode,
        presence: fighterPresence(state.members.filter((m) => m.fighterId === f.id && inScope(m))),
        weighInKg: f.weighInKg,
        registrations: state.members
          .filter((m) => m.fighterId === f.id && inScope(m))
          .map((m) => {
            // Un recasé est jugé sur la catégorie où il a été placé (sa catégorie de poids d'inscription ne compte plus).
            const wic = m.placementLocked ? overweightInCategory(m, state) : isOverweight(m, state);
            const cat = state.categories.find((c) => c.id === m.categoryId);
            return {
              id: m.registrationId,
              discipline: m.discipline,
              hasWeight: DISCIPLINES[m.discipline].hasWeight,
              weightClassLabel: label(m.weightClassId),
              weighInClassLabel: wic?.label ?? (m.weighInKg !== null && m.weightClassId ? label(m.weightClassId) : null),
              outOfClass: wic !== null,
              recased: m.placementLocked,
              categoryLabel: cat ? categoryLabel(cat.key, state.grid) : null,
              categoryOrder: cat ? (categoryOrder.get(cat.id) ?? null) : null,
            };
          }),
      }))
      .sort((a, b) => a.club.localeCompare(b.club) || a.label.localeCompare(b.label)),
  };
}

// --- Aperçu ---

/** Paires du 1er tour (élimination) ou liste des membres (poule, kata) d'une catégorie de l'état. */
function lineup(state: State, categoryId: string): string[][] {
  const members = activeMembers(state, categoryId);
  const cat = state.categories.find((c) => c.id === categoryId);
  if (!cat || members.length === 0) return [];
  if (members.length < 2) return [members.map((m) => m.label)];
  const labels = new Map(members.map((m) => [m.registrationId, m.label]));
  const format = defaultFormat(cat.key.discipline, members.length, state.settings);
  if (format !== 'single_elimination' && format !== 'double_elimination') return [members.map((m) => m.label)];
  const bracket = generateBracket(
    format,
    members.map((m) => ({ registrationId: m.registrationId, clubId: m.clubId, label: m.label })),
    { repechage: false, thirdPlace: false, kataBronzeCount: state.settings.kataBronzeCount },
    1,
  );
  if (bracket.kind !== 'combat') return [members.map((m) => m.label)];
  return resolveBracket(bracket, {}).matches
    .filter((m) => m.round === 1 && m.phase === 'main')
    .map((m) => [m.entrantA, m.entrantB].filter((x): x is string => x !== null).map((id) => labels.get(id)!));
}

export function previewTransition(before: State, after: State) {
  const ids = new Set([...before.categories, ...after.categories].map((c) => c.id));
  const out: { label: string; before: string[][]; after: string[][] }[] = [];
  for (const id of ids) {
    const b = activeMembers(before, id).map((m) => m.registrationId).sort().join();
    const a = activeMembers(after, id).map((m) => m.registrationId).sort().join();
    if (a === b) continue;
    const cat = after.categories.find((c) => c.id === id) ?? before.categories.find((c) => c.id === id)!;
    out.push({ label: categoryLabel(cat.key, after.grid), before: lineup(before, id), after: lineup(after, id) });
  }
  return out;
}

export { findProposal };
