import { and, eq, inArray, sql } from 'drizzle-orm';
import { categoryLabel, compareKeys, keyString, naturalKey } from '../../domain/categories.js';
import { entryKey } from '../../domain/closed-categories.js';
import { DISCIPLINES } from '../../domain/disciplines.js';
import { undoSet } from '../../domain/history/cascade.js';
import { RESET_KINDS } from '../../domain/history/types.js';
import {
  applyProposal,
  proposalMoves,
  detectCases,
  proposalsFor,
  stateFingerprint,
  isOverweight,
  overweightInCategory,
  recompute,
  type PlanChoice,
  type Member,
  type Presence,
  type Proposal,
  type State,
  categoryWave,
  categoryWaves,
  keyWave,
  memberWave,
  waveMoves,
} from '../../domain/replacement/index.js';
import { manualProposal as domainManualProposal } from '../../domain/replacement/manual.js';
import { atomically, dryRun } from '../db/atomic.js';
import type { AppDb } from '../db/client.js';
import { withoutRowMeta } from '../db/row-versions.js';
import { categories, clubs, competitions, fighters, historyEntries, recasements, refusals, registrations, setAsideCases, waves } from '../db/schema.js';
import { listWaves } from './waves.js';
import { launchedCategoryIds, launchedWaveKeys } from './launch-state.js';
import type { Wave } from '../../domain/waves.js';
import { CategoryLockedError, listCategories, markArranged, syncCategories } from './categories.js';
import { HISTORY_STALE, loadEntries, recorded, undoEntries, type EntrySpec, type Loaded } from './history.js';
import { closedSet } from './closed-categories.js';
import { getManagement } from '../sync/ownership.js';
import { getCompetition, getGrid } from './competitions.js';
import { NotFoundError, RegistrationValidationError } from './registrations.js';
import type { PlanInput, PlanResponse } from '../plan/compute.js';
import { runPlanJob } from '../plan/runner.js';

// Parties pures, déplacées pour le fil de calcul (qui n'importe pas la base) : gardées ici pour les autres modules.
export { displayedProposals, previewTransition, type PlanResponse } from '../plan/compute.js';

export class StaleProposalError extends Error {
  constructor(message = "La situation a changé depuis l'affichage : rechargez les propositions.") {
    super(message);
  }
}

/** État du recasement, après synchronisation des catégories. */
export async function loadState(db: AppDb, competitionId: string, opts: { sync?: boolean } = {}): Promise<State> {
  // `sync: false` : état intermédiaire d'une action en deux temps (une catégorie vidée en attendant son arrivant n'est pas supprimée).
  if (opts.sync !== false) await syncCategories(db, competitionId);
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
    // « Ne combat pas » : hors de la réaffectation.
    .filter((r) => !r.withdrawnReason)
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
  const state: State = {
    grid,
    settings: competition.settings,
    categories: db
      .select()
      .from(categories)
      .where(eq(categories.competitionId, competitionId))
      .all()
      .map((c) => ({ id: c.id, key: JSON.parse(c.keyJson), status: c.status, aliasKeys: JSON.parse(c.aliasKeys), waveOverride: c.waveOverride })),
    members,
    waves: await listWaves(db, competitionId),
    refused: db.select().from(refusals).where(eq(refusals.competitionId, competitionId)).all().map((r) => r.proposalId),
    closedEntries: [...closedSet(db, competitionId)],
    setAside: [],
  };
  // Vague lancée : fermée au recasement (vague implicite '' quand il n'y a pas de vague).
  const launched = launchedWaveKeys(db, competitionId);
  if (launched.size) {
    const waveOf = categoryWaves(state);
    for (const c of state.categories) {
      const key = state.waves.length === 0 ? '' : waveOf.get(c.id);
      c.frozen = key !== null && key !== undefined && launched.has(key);
    }
  }
  // Cartes mises de côté : seulement celles dont le cas existe encore ; les autres sont oubliées (un cas qui revient revient en tête).
  const marks = db.select().from(setAsideCases).where(eq(setAsideCases.competitionId, competitionId)).all();
  if (marks.length) {
    const existing = new Set(detectCases(state).map((c) => c.id));
    const gone = marks.filter((m) => !existing.has(m.caseId)).map((m) => m.caseId);
    // Copie en lecture seule (main ailleurs) : on ne fait que filtrer, sa version doit rester celle reçue.
    if (gone.length && getManagement(db, competitionId).managedHere) db.delete(setAsideCases).where(and(eq(setAsideCases.competitionId, competitionId), inArray(setAsideCases.caseId, gone))).run();
    state.setAside = marks.filter((m) => existing.has(m.caseId)).map((m) => m.caseId);
  }
  return state;
}

/** Cartes mises de côté de la compétition (encore existantes), avec leur note. */
export function setAsideNotes(db: AppDb, competitionId: string, caseIds: string[]): Record<string, { note: string; createdAt: string }> {
  const wanted = new Set(caseIds);
  return Object.fromEntries(
    db.select().from(setAsideCases).where(eq(setAsideCases.competitionId, competitionId)).all()
      .filter((m) => wanted.has(m.caseId))
      .map((m) => [m.caseId, { note: m.note, createdAt: m.createdAt }]),
  );
}

/** Met une carte de côté (avec une note facultative) : elle ne compte plus dans les cas à traiter. */
export async function setAsideCase(db: AppDb, competitionId: string, caseId: string, note: string): Promise<void> {
  const state = await loadState(db, competitionId);
  if (!detectCases(state).some((c) => c.id === caseId)) throw new StaleProposalError('Cette carte n’existe plus : rechargez.');
  db.insert(setAsideCases).values({ competitionId, caseId, note: note.trim(), waveId: actionWave(state, caseId, caseId) }).onConflictDoUpdate({ target: [setAsideCases.competitionId, setAsideCases.caseId], set: { note: note.trim() } }).run();
}

/** Reprend une carte mise de côté. */
export async function resumeCase(db: AppDb, competitionId: string, caseId: string): Promise<void> {
  db.delete(setAsideCases).where(and(eq(setAsideCases.competitionId, competitionId), eq(setAsideCases.caseId, caseId))).run();
}

export function allProposals(state: State, cases = detectCases(state)): Map<string, Proposal[]> {
  return new Map(cases.map((c) => [c.id, proposalsFor(state, c)]));
}

function findProposal(state: State, proposalId: string): Proposal {
  for (const list of allProposals(state).values()) {
    const p = list.find((x) => x.id === proposalId);
    if (p) return p;
  }
  throw new StaleProposalError('Proposition périmée : rechargez les propositions.');
}

type CategoryRow = typeof categories.$inferSelect;

/**
 * Écrit en base le passage de `before` à `after` pour l'inscription déplacée par `p`, et journalise.
 * Une inscription qui change de vague repasse « non pesé » : elle se pointe dans sa nouvelle vague (le poids reste).
 */
function persist(db: AppDb, competitionId: string, before: State, after: State, p: Proposal, opts: { bulk: boolean; waveId: string | null }): string {
  const m0 = before.members.find((m) => m.registrationId === p.registrationId)!;
  const m1 = after.members.find((m) => m.registrationId === p.registrationId)!;
  const fromCat = before.categories.find((c) => c.id === m0.categoryId);
  const recasementId = crypto.randomUUID();
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
      /** Présence d'avant des inscriptions remises « non pesé » (changement de vague), rétablie par l'annulation. */
      presences: [] as { id: string; presence: Presence }[],
    };
    // Le combattant déplacé, et ceux que sa catégorie emmène, repassent « non pesé » s'ils changent de vague.
    const moved = waveMoves(before, after).map((x) => x.registrationId);
    if (moved.length) {
      snapshot.presences = t.select({ id: registrations.id, presence: registrations.presence }).from(registrations).where(inArray(registrations.id, moved)).all();
      t.update(registrations).set({ presence: 'unknown' }).where(inArray(registrations.id, moved)).run();
    }
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
        id: recasementId,
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
        waveId: opts.waveId,
      })
      .run();
  });
  return recasementId;
}

/** « Ne combat pas » pour un inscrit d'une catégorie fermée : hors de toute catégorie, inscrit au journal et à l'historique (`withdraw`, annulable). */
export async function withdrawRegistration(db: AppDb, competitionId: string, registrationId: string, fingerprint: string): Promise<void> {
  const state = await loadState(db, competitionId);
  if (stateFingerprint(state) !== fingerprint) throw new StaleProposalError();
  if (!detectCases(state).some((c) => c.id === `closed:${registrationId}`)) throw new StaleProposalError('Ce combattant n’est plus dans une catégorie fermée : rechargez.');
  const reg = db.select().from(registrations).where(eq(registrations.id, registrationId)).get()!;
  const m = state.members.find((x) => x.registrationId === registrationId)!;
  const from = state.categories.find((c) => c.id === reg.categoryId);
  // L'annulation ne rétablit que la catégorie et lève le retrait : une modification faite entre-temps (discipline…) est gardée.
  const snapshot = { registration: { categoryId: reg.categoryId, withdrawnReason: null, withdrawnEntry: null }, categories: [] };
  const withdrawnEntry = entryKey({ ageBandCode: m.ageBandCode, sex: m.sex, discipline: m.discipline, ruleset: m.ruleset });
  const recasementId = crypto.randomUUID();
  const waveId = actionWave(state, registrationId, registrationId);
  const fromLabel = from ? categoryLabel(from.key, state.grid) : '—';
  const toLabel = 'Ne combat pas';
  const reason = 'Catégorie non ouverte à cette compétition';
  await recorded(db, competitionId, { kind: 'withdraw', waveId, summary: { registrationIds: [registrationId], fromLabel, toLabel, reason }, recasementIds: [recasementId] }, async () => {
    db.transaction((tx) => {
      const t = tx as unknown as AppDb;
      t.update(registrations).set({ withdrawnReason: 'closed_category', withdrawnEntry, categoryId: null }).where(eq(registrations.id, registrationId)).run();
      t.insert(recasements)
        .values({
          id: recasementId, competitionId, registrationId, proposalId: `W:${registrationId}`, type: 'W', fromLabel, toLabel, reason,
          manual: true, preApproved: false, bulk: false, snapshotJson: JSON.stringify(snapshot), waveId,
        })
        .run();
    });
  });
}

/** Valide une proposition à l'unité : une entrée `reaffectation` de l'historique (tous les déplacements d'un « split »). */
export async function applyProposalById(db: AppDb, competitionId: string, proposalId: string, opts: { bulk?: boolean; fingerprint?: string } = {}): Promise<void> {
  const state = await loadState(db, competitionId);
  if (opts.fingerprint !== undefined && stateFingerprint(state) !== opts.fingerprint) throw new StaleProposalError();
  const p = findProposal(state, proposalId);
  const waveId = actionWave(state, p.caseId, p.registrationId);
  await recorded(
    db,
    competitionId,
    (ids: string[]) => proposalEntry(db, { kind: 'reaffectation', groupId: null, waveId }, p, ids),
    async () => persistAll(db, competitionId, state, p, { bulk: opts.bulk ?? false, waveId }),
  );
}

/**
 * Entrée d'historique d'une proposition écrite par `persistAll` (`ids` : ses recasements) : ses inscriptions, « de ➜ vers »
 * du journal (premier déplacement) et sa raison.
 */
function proposalEntry(db: AppDb, head: Pick<EntrySpec, 'kind' | 'groupId' | 'waveId'>, p: Proposal, ids: string[]): EntrySpec {
  const row = db.select({ fromLabel: recasements.fromLabel, toLabel: recasements.toLabel }).from(recasements).where(eq(recasements.id, ids[0]!)).get();
  return {
    ...head,
    summary: { registrationIds: proposalMoves(p).map((m) => m.registrationId), fromLabel: row?.fromLabel, toLabel: row?.toLabel, reason: p.reason },
    recasementIds: ids,
  };
}

/**
 * Session d'où une action est décidée : celle du combattant de la carte (pour un split, le combattant seul, pas celui qui
 * vient), dans l'état d'avant l'action ; `null` sans sessions (ou combattant en attente de session).
 */
export function actionWave(before: State, caseId: string, registrationId: string): string | null {
  if (before.waves.length === 0) return null;
  const at = caseId.indexOf(':');
  const subject = at < 0 ? registrationId : caseId.slice(at + 1);
  const m = before.members.find((x) => x.registrationId === subject);
  return m ? memberWave(before, m) : null;
}

/** Écrit chaque déplacement d'une proposition (plusieurs pour un « split »), un recasement par inscription ; rend leurs ids. */
function persistAll(db: AppDb, competitionId: string, state: State, p: Proposal, opts: { bulk: boolean; waveId: string | null }): string[] {
  let current = state;
  const ids: string[] = [];
  for (const step of proposalMoves(p)) {
    const next = applyProposal(current, step);
    ids.push(persist(db, competitionId, current, next, step, opts));
    current = next;
  }
  return ids;
}

/** Vague demandée par l'écran (`null` : toutes) ; 404 si elle n'existe pas. */
export function knownWave(waves: Pick<Wave, 'id'>[], waveId: string | undefined): string | null {
  if (waveId && !waves.some((w) => w.id === waveId)) throw new NotFoundError('Session introuvable');
  return waveId ?? null;
}

/**
 * Vague du plan d'ensemble : avec des vagues, il se fait toujours dans une vague (400 sinon, 404 si inconnue) ;
 * sans vague, `null` (tous les cas).
 */
export async function planWave(db: AppDb, competitionId: string, waveId: string | undefined): Promise<string | null> {
  const all = await listWaves(db, competitionId);
  if (waveId) return knownWave(all, waveId);
  if (all.length > 0) throw new RegistrationValidationError(['Choisissez la session de la réaffectation (rechargez la page si les sessions viennent d’être créées).']);
  return null;
}

/** Demande de plan vérifiée (vague connue) et l'état sur lequel le calculer ; les erreurs (400, 404) partent d'ici, avant tout calcul. */
export async function planInput(
  db: AppDb,
  competitionId: string,
  body: { waveId?: string; choices: PlanChoice[]; forApply?: boolean; cardDecisions?: boolean },
): Promise<{ state: State; input: PlanInput }> {
  const waveId = await planWave(db, competitionId, body.waveId);
  const state = await loadState(db, competitionId);
  return { state, input: { waveId, choices: body.choices, forApply: body.forApply === true, cardDecisions: body.cardDecisions !== false } };
}

/** Plan d'ensemble de la session (voir `planPayload`), calculé dans un fil à part. */
export async function planResponse(
  db: AppDb,
  competitionId: string,
  body: { waveId?: string; choices: PlanChoice[]; forApply?: boolean; cardDecisions?: boolean },
  opts: { signal?: AbortSignal } = {},
): Promise<PlanResponse> {
  const { state, input } = await planInput(db, competitionId, body);
  return runPlanJob(state, input, opts);
}

/**
 * Applique le plan à appliquer (sans validation, plus les choix) : l'empreinte et le hash doivent être ceux de l'affichage.
 * Chaque déplacement part de l'état rechargé ; une catégorie créée par un déplacement précédent (`new:…`) se retrouve par son ancre.
 */
export async function applyPlan(
  db: AppDb,
  competitionId: string,
  body: { waveId?: string; choices: PlanChoice[]; cardDecisions?: boolean; fingerprint: string; hash: string },
): Promise<{ applied: number }> {
  const waveId = await planWave(db, competitionId, body.waveId);
  let state = await loadState(db, competitionId);
  if (stateFingerprint(state) !== body.fingerprint) throw new StaleProposalError();
  // Recalcul dans le fil, comme pour l'affichage : rien n'est écrit avant son résultat. Sans signal d'abandon : une écriture,
  // une fois demandée, va jusqu'au bout (même si le client part), sauf si l'état a changé entre-temps.
  const { plan } = await runPlanJob(state, { waveId, choices: body.choices, forApply: true, cardDecisions: body.cardDecisions !== false });
  if (plan.hash !== body.hash) throw new StaleProposalError('Le plan a changé depuis l’affichage : relisez-le avant de l’appliquer.');
  // Pendant le calcul, un autre poste a pu écrire (pesée, déplacement, même plan appliqué) : on revérifie l'empreinte,
  // puis on écrit sans plus rendre la main (base synchrone, aucune attente d'entrée-sortie dans la boucle).
  if (stateFingerprint(await loadState(db, competitionId)) !== body.fingerprint) throw new StaleProposalError();
  // Tout ou rien : une seule transaction pour tous les déplacements (les `await` ci-dessous ne rendent jamais la main à une
  // autre requête, la base est synchrone). Un déplacement refusé annule ceux déjà écrits ; `persist` s'y emboîte en point de sauvegarde.
  // Historique : une entrée `plan` par déplacement, toutes du même groupe (« Annuler tout le plan »). Chacune synchronise après
  // son déplacement (comme le faisait déjà `loadState` au déplacement suivant) : une catégorie vidée par ce déplacement et
  // supprimée est gardée dans son état d'avant, et revient avec le même id si on annule ce seul déplacement.
  const groupId = crypto.randomUUID();
  let applied = 0;
  await atomically(db, async () => {
    for (const move of plan.moves) {
      state = await loadState(db, competitionId);
      // Le combattant doit encore être là où le plan l'a pris (une catégorie créée en route, `new:…`, n'existe pas encore en base).
      if (move.fromCategoryId !== null && !move.fromCategoryId.startsWith('new:')) {
        if (state.members.find((m) => m.registrationId === move.registrationId)?.categoryId !== move.fromCategoryId) throw new StaleProposalError();
      }
      let p: Proposal = move;
      if ('categoryId' in move.target && move.target.categoryId.startsWith('new:')) {
        // Sans ancre, la catégorie créée en route ne se retrouve pas : le plan est à relire, rien n'est écrit.
        const categoryId = move.anchor === null ? undefined : state.members.find((m) => m.registrationId === move.anchor)?.categoryId;
        if (!categoryId) throw new StaleProposalError('Le plan a changé depuis l’affichage : relisez-le avant de l’appliquer.');
        p = { ...move, target: { categoryId } };
      }
      const before = state;
      await recorded(
        db,
        competitionId,
        (ids: string[]) => proposalEntry(db, { kind: 'plan', groupId, waveId }, p, ids),
        async () => persistAll(db, competitionId, before, p, { bulk: true, waveId }),
      );
      applied++;
    }
  });
  return { applied };
}

export async function refuseProposal(db: AppDb, competitionId: string, proposalId: string): Promise<void> {
  // Session de la carte où la proposition s'affiche (refus d'une proposition qui n'existe plus : sans session).
  const state = await loadState(db, competitionId);
  const p = [...allProposals({ ...state, refused: [] }).values()].flat().find((x) => x.id === proposalId);
  const waveId = p ? actionWave(state, p.caseId, p.registrationId) : null;
  db.insert(refusals).values({ competitionId, proposalId, waveId }).onConflictDoNothing().run();
}

export async function unrefuseProposal(db: AppDb, competitionId: string, proposalId: string): Promise<void> {
  db.delete(refusals).where(and(eq(refusals.competitionId, competitionId), eq(refusals.proposalId, proposalId))).run();
}

/** Proposition « déplacement manuel » (type M) et ses avertissements ; refusée si l'une des deux catégories est lancée. */
export function manualProposal(state: State, registrationId: string, categoryId: string): { p: Proposal; warnings: string[] } {
  const r = domainManualProposal(state, registrationId, categoryId);
  if ('p' in r) return r;
  switch (r.error) {
    case 'not-found': throw new NotFoundError('Inscription ou catégorie introuvable');
    case 'frozen': throw new CategoryLockedError('La session est lancée : rouvrez-la pour y déplacer quelqu’un.');
    case 'locked': throw new CategoryLockedError();
    case 'closed': throw new RegistrationValidationError(['Catégorie non ouverte à cette compétition : choisissez-en une autre.']);
  }
}

/**
 * Écrit un déplacement manuel (type M) sans synchroniser, et garde les places des deux tableaux (spec §2.6) : départ et
 * arrivée deviennent « arrangés », la synchronisation qui suit les refait avec `keepPlaces` au lieu d'un nouveau tirage.
 */
export function persistManualMove(
  db: AppDb,
  competitionId: string,
  state: State,
  registrationId: string,
  categoryId: string,
): { recasementId: string; warnings: string[]; fromCategoryId: string | null } {
  const { p, warnings } = manualProposal(state, registrationId, categoryId);
  const fromCategoryId = state.members.find((m) => m.registrationId === registrationId)?.categoryId ?? null;
  let recasementId = '';
  db.transaction((tx) => {
    const t = tx as unknown as AppDb;
    recasementId = persist(t, competitionId, state, applyProposal(state, p), p, { bulk: false, waveId: actionWave(state, p.caseId, p.registrationId) });
    markArranged(t, [fromCategoryId, categoryId].filter((id): id is string => id !== null));
  });
  return { recasementId, warnings, fromCategoryId };
}

/** Déplacement manuel depuis « Déplacer vers… » ou la planche : places gardées, journalisé dans l'historique (`manual`). */
export async function manualMove(db: AppDb, competitionId: string, registrationId: string, categoryId: string): Promise<{ warnings: string[]; historyId: string | null }> {
  const state = await loadState(db, competitionId);
  const { result, historyId } = await recorded(
    db,
    competitionId,
    (r: ReturnType<typeof persistManualMove>) => {
      const row = db.select({ fromLabel: recasements.fromLabel, toLabel: recasements.toLabel }).from(recasements).where(eq(recasements.id, r.recasementId)).get()!;
      return {
        kind: 'manual',
        waveId: actionWave(state, 'manual', registrationId),
        summary: { registrationIds: [registrationId], fromLabel: row.fromLabel, toLabel: row.toLabel, reason: 'Placé à la main' },
        recasementIds: [r.recasementId],
      };
    },
    async () => persistManualMove(db, competitionId, state, registrationId, categoryId),
  );
  return { warnings: result.warnings, historyId };
}

/** Instantané d'une réaffectation : ce qu'il faut réécrire pour l'annuler. */
export type RecasementSnapshot = {
  /** Instantané d'un « Ne combat pas » : la catégorie et le retrait seulement. */
  registration: {
    categoryId: string | null; placementLocked?: boolean; originalJson?: string | null; recasementType?: string | null;
    discipline?: Member['discipline']; ruleset?: Member['ruleset']; weightClassId?: string | null;
    withdrawnReason?: null; withdrawnEntry?: null;
  };
  categories: { id: string; keyString: string; keyJson: string; aliasKeys: string; label: string }[];
  /** Absente des instantanés d'avant les vagues. */
  presences?: { id: string; presence: Presence }[];
};

/** Catégories qu'une annulation touche : la catégorie actuelle, celle d'avant et celles dont la clé avait changé. */
export const snapshotTouches = (currentCategoryId: string | null, snapshot: RecasementSnapshot): string[] =>
  // Instantané incomplet (ligne écrite à la main, ancienne) : seulement ce qu'il contient.
  [...new Set([currentCategoryId, snapshot.registration?.categoryId, ...(snapshot.categories ?? []).map((c) => c.id)].filter((x): x is string => !!x))];

/**
 * Réécrit l'état d'avant une réaffectation (dans une transaction de l'appelant). Les valeurs d'origine corrigées depuis
 * (export FFK, fiche club : elles ne changent que `originalJson` d'une inscription réaffectée) sont gardées.
 */
export function restoreSnapshot(t: AppDb, registrationId: string, snapshot: RecasementSnapshot): void {
  // Instantané incomplet (ligne écrite à la main, ancienne) : seulement ce qu'il contient.
  for (const c of snapshot.categories ?? []) {
    const { id, ...values } = c;
    t.update(categories).set(values).where(eq(categories.id, id)).run();
  }
  if (!snapshot.registration) return;
  const previous = { ...snapshot.registration };
  const current = t
    .select({ originalJson: registrations.originalJson, discipline: registrations.discipline, ruleset: registrations.ruleset, weightClassId: registrations.weightClassId })
    .from(registrations)
    .where(eq(registrations.id, registrationId))
    .get();
  if (previous.originalJson !== undefined && current?.originalJson) {
    if (previous.originalJson === null) {
      // Cette réaffectation avait créé les valeurs d'origine : on revient à leur état actuel.
      const original = JSON.parse(current.originalJson) as Pick<Member, 'discipline' | 'ruleset' | 'weightClassId'>;
      Object.assign(previous, { discipline: original.discipline, ruleset: original.ruleset, weightClassId: original.weightClassId });
    } else previous.originalJson = current.originalJson;
  } else if (previous.originalJson && current) {
    // Annulation d'un retour : depuis, l'inscription porte ses valeurs d'origine elles-mêmes, corrections comprises.
    const { discipline, ruleset, weightClassId } = current;
    previous.originalJson = JSON.stringify({ ...JSON.parse(previous.originalJson), discipline, ruleset, weightClassId });
  }
  const exists = previous.categoryId && t.select().from(categories).where(eq(categories.id, previous.categoryId)).get();
  t.update(registrations)
    .set({ ...previous, categoryId: exists ? previous.categoryId : null })
    .where(eq(registrations.id, registrationId))
    .run();
  for (const r of snapshot.presences ?? []) t.update(registrations).set({ presence: r.presence }).where(eq(registrations.id, r.id)).run();
}

/** Dernière réaffectation validée d'une inscription (ordre d'insertion), ou `undefined`. */
export function lastValidatedRecasement(db: AppDb, competitionId: string, registrationId: string): { id: string; type: string } | undefined {
  return db
    .select({ id: recasements.id, type: recasements.type, n: sql<number>`rowid` })
    .from(recasements)
    .where(and(eq(recasements.competitionId, competitionId), eq(recasements.registrationId, registrationId), eq(recasements.status, 'validated')))
    .all()
    .sort((a, b) => b.n - a.n)
    .map(({ id, type }) => ({ id, type }))[0];
}

/** Ce que « Repartir de zéro » ferait dans une session (fenêtre de confirmation). */
export interface ResetPreview {
  /** Réaffectations annulées (inscriptions encore là). */
  undo: number;
  /** Dont déplacements manuels (type M). */
  manual: number;
  /** Réaffectations laissées en place : vers une session lancée (`frozen`) ou une catégorie commencée (`started`). */
  kept: { name: string; toLabel: string; why: 'frozen' | 'started' }[];
  /** Combattant réaffecté ensuite depuis une autre session : la remise à zéro est refusée en entier. */
  blockedBy: string | null;
  /** Refus et cartes mises de côté effacés. */
  clears: number;
  /** Lignes d'historique effacées (annulées maintenant, ou déjà annulées une à une). */
  history: number;
  /** Refus prévu (un combattant retournerait dans une catégorie commencée ou d'une session lancée) ; `null` : aucun. */
  refusal: string | null;
  /** La session choisie (ou, sans sessions, la compétition) est lancée. */
  locked: boolean;
  /** Lignes Places / Tirage / Format / Tableau libre annulées (et effacées) avec, en cascade ; plus récente d'abord. */
  cascade: string[];
  /** Lot affiché : toutes les lignes d'historique annulées (cibles et cascade), plus récente d'abord ; renvoyé en `expect`. */
  lot: string[];
}

const RESET_LOCKED = 'Une catégorie concernée a déjà commencé ou sa session est lancée : rouvrez-la pour repartir de zéro.';
const isResetKind = (e: Loaded) => RESET_KINDS.includes(e.kind);

/**
 * Tri de « Repartir de zéro » dans la session `waveId` (`null` : toutes, ou compétition sans sessions), sur l'historique
 * (spec §3.7). Cibles : les actions encore en place de `RESET_KINDS` décidées depuis cette session (colonne `wave_id` ; reprise
 * de l'ancien journal sans session : la session de sa catégorie de départ). Une cible dont le lot (`undoSet` : elle et les
 * actions plus récentes qui touchent, de proche en proche, les mêmes catégories) touche une catégorie d'une session lancée ou
 * commencée reste (avec ce qui en dépend : une cible plus ancienne dont le lot la contient) ; un lot qui contient une action de
 * `RESET_KINDS` d'une autre session bloque tout. Le reste est annulé en un seul lot, Places / Tirage / Format compris.
 * `trial` : essai à blanc pour l'aperçu (`refusal`).
 */
async function resetSorting(db: AppDb, competitionId: string, waveId: string | null, opts: { state?: State; trial: boolean }) {
  // D'abord la synchronisation (faite par `loadState`) : les catégories lues ensuite sont à jour.
  const state = opts.state ?? (await loadState(db, competitionId));
  const launched = launchedWaveKeys(db, competitionId);
  const locked = state.waves.length === 0 ? launched.has('') : waveId !== null && launched.has(waveId);
  const byId = new Map(state.categories.map((c) => [c.id, c]));
  const waveOfCategory = (id: string | null | undefined) => {
    const c = id ? byId.get(id) : undefined;
    return c ? categoryWave(state, c) : undefined;
  };
  const current = new Map(
    db.select({ id: registrations.id, categoryId: registrations.categoryId }).from(registrations).where(eq(registrations.competitionId, competitionId)).all().map((r) => [r.id, r.categoryId]),
  );
  const names = new Map(
    db.select({ id: registrations.id, last: fighters.lastName, first: fighters.firstName }).from(registrations)
      .innerJoin(fighters, eq(fighters.id, registrations.fighterId)).where(eq(registrations.competitionId, competitionId)).all()
      .map((r) => [r.id, `${r.last} ${r.first}`]),
  );
  const departureWave = (registrationId: string, snapshot: RecasementSnapshot) => {
    const m = state.members.find((x) => x.registrationId === registrationId);
    if (!m) return waveOfCategory(current.get(registrationId));
    const r = snapshot.registration ?? {};
    const before = {
      discipline: r.discipline ?? m.discipline,
      ruleset: r.ruleset !== undefined ? r.ruleset : m.ruleset,
      weightClassId: r.weightClassId !== undefined ? r.weightClassId : m.weightClassId,
    };
    return keyWave(state, naturalKey(before, m));
  };
  const recs = new Map(db.select().from(recasements).where(eq(recasements.competitionId, competitionId)).all().map((r) => [r.id, r]));
  const recasementsOf = (e: Loaded) => e.recasementIds.map((id) => recs.get(id)).filter((r) => r !== undefined);
  const all = loadEntries(db, competitionId);
  const entryWave = (e: Loaded): string | null => {
    if (e.row.waveId) return e.row.waveId;
    // Sans session : celle de son recasement ; ligne d'avant la migration 0025 : la session de sa catégorie de départ ;
    // disparue, celle de la clé qu'avait le combattant avant le déplacement ; inscription supprimée : celle de sa catégorie actuelle.
    const rec = recasementsOf(e)[0];
    if (!rec) return null;
    const snapshot = JSON.parse(rec.snapshotJson) as RecasementSnapshot;
    return rec.waveId ?? waveOfCategory(snapshot.registration?.categoryId) ?? departureWave(rec.registrationId, snapshot) ?? null;
  };
  const inScope = (e: Loaded) => state.waves.length === 0 || waveId === null || entryWave(e) === waveId;
  // Catégories fermées, même règle que l'historique : session lancée (numéros figés ou non), commencée ou terminée.
  const launchedCategories = launchedCategoryIds(db, competitionId);
  const isFrozen = (id: string) => byId.get(id)?.frozen === true || launchedCategories.has(id);
  const isStarted = (id: string) => ['started', 'finished'].includes(byId.get(id)?.status ?? '');
  const kept: ResetPreview['kept'] = [];
  const keptRegs = new Set<string>();
  const remaining: string[] = [];
  let blockedBy: string | null = null;
  const targets = all.filter((e) => e.active && isResetKind(e) && inScope(e)).sort((a, b) => b.seq - a.seq);
  for (const t of targets) {
    const set = undoSet(all, [t.id]);
    const locks = set.flatMap((e) => e.lockCategories);
    const why = locks.some(isFrozen) ? 'frozen' : locks.some(isStarted) ? 'started' : null;
    if (why) {
      // Un combattant laissé en place n'est cité qu'une fois (sa réaffectation la plus récente).
      for (const rec of recasementsOf(t)) {
        if (!current.has(rec.registrationId) || keptRegs.has(rec.registrationId)) continue;
        keptRegs.add(rec.registrationId);
        kept.push({ name: names.get(rec.registrationId) ?? rec.registrationId, toLabel: rec.toLabel, why });
      }
      continue;
    }
    const foreign = set.find((e) => isResetKind(e) && !inScope(e));
    if (foreign) {
      const reg = foreign.summary.registrationIds[0] ?? recasementsOf(foreign)[0]?.registrationId ?? '';
      blockedBy ??= names.get(reg) ?? reg;
      continue;
    }
    remaining.push(t.id);
  }
  // Lot final : les cibles annulées et leur cascade (union des lots de chaque cible), de la plus récente à la plus ancienne.
  const lot = undoSet(all, remaining);
  // Historique effacé : les lignes annulées maintenant, et celles de la session déjà annulées une à une.
  const erase = [...lot, ...all.filter((e) => !e.active && isResetKind(e) && inScope(e))];
  const sessionOf = (registrationId: string) => {
    const m = state.members.find((x) => x.registrationId === registrationId);
    return m ? memberWave(state, m) : null;
  };
  const scoped = <T extends { waveId: string | null }>(xs: T[], reg: (x: T) => string) =>
    xs.filter((x) => state.waves.length === 0 || waveId === null || (x.waveId ?? sessionOf(reg(x))) === waveId);
  const proposalReg = (id: string) => id.slice(id.indexOf(':') + 1).split(/[>+]/)[0]!;
  const refusalRows = scoped(db.select().from(refusals).where(eq(refusals.competitionId, competitionId)).all(), (x) => proposalReg(x.proposalId));
  const asideRows = scoped(db.select().from(setAsideCases).where(eq(setAsideCases.competitionId, competitionId)).all(), (x) => x.caseId.slice(x.caseId.indexOf(':') + 1));
  // Réaffectations annulées : celles du lot encore validées dont l'inscription existe encore.
  const undone = lot.flatMap(recasementsOf).filter((r) => r.status === 'validated' && current.has(r.registrationId));
  const preview: ResetPreview = {
    undo: undone.length, manual: undone.filter((r) => r.type === 'M').length, kept, blockedBy, clears: refusalRows.length + asideRows.length,
    history: erase.length, refusal: null, locked, cascade: lot.filter((e) => !isResetKind(e)).map((e) => e.id), lot: lot.map((e) => e.id),
  };
  const sorting = { preview, lot, erase, refusalRows, asideRows, restored: [...new Set(undone.map((r) => r.registrationId))], isFrozen };
  // Essai à blanc (écritures annulées) : un combattant qui retournerait dans une catégorie commencée ou d'une session lancée.
  if (opts.trial && !locked && !blockedBy && lot.length > 0) {
    try {
      await dryRun(db, () => applyReset(db, competitionId, sorting));
    } catch (e) {
      if (e instanceof CategoryLockedError) preview.refusal = e.message;
      else throw e;
    }
  }
  return sorting;
}

type ResetSorting = Awaited<ReturnType<typeof resetSorting>>;

/**
 * Les écritures de « Repartir de zéro » (dans une transaction de l'appelant) : le lot annulé comme `undoHistory`, puis ses lignes
 * effacées avec leurs recasements, et les refus et cartes mises de côté de la session ; lève `CategoryLockedError` si un
 * combattant retournerait dans une catégorie fermée.
 */
async function applyReset(db: AppDb, competitionId: string, sorting: Pick<ResetSorting, 'lot' | 'erase' | 'refusalRows' | 'asideRows' | 'restored' | 'isFrozen'>): Promise<void> {
  const { lot, erase, refusalRows, asideRows, restored, isFrozen } = sorting;
  const existing = new Set(db.select({ id: categories.id }).from(categories).where(eq(categories.competitionId, competitionId)).all().map((c) => c.id));
  await undoEntries(db, competitionId, lot);
  // Un combattant dont la catégorie d'avant a disparu (ou a été recréée par l'annulation) va d'après sa clé (même choix que
  // `syncCategories` : clé exacte avant alias, catégorie non commencée avant commencée) : refus si une catégorie qui existait
  // déjà porte cette clé et est commencée ou d'une session lancée.
  const isLocked = (c: { id: string; status: string }) => c.status === 'started' || c.status === 'finished' || isFrozen(c.id);
  const cats = db.select().from(categories).where(eq(categories.competitionId, competitionId)).all().filter((c) => existing.has(c.id));
  const fs = new Map(db.select().from(fighters).where(eq(fighters.competitionId, competitionId)).all().map((f) => [f.id, f]));
  const regs = restored.length ? db.select().from(registrations).where(inArray(registrations.id, restored)).all() : [];
  for (const r of regs) {
    if (r.withdrawnReason || (r.placementLocked && r.categoryId)) continue;
    const ks = keyString(naturalKey(r, fs.get(r.fighterId)!));
    const rank = (c: (typeof cats)[number]) => (c.keyString === ks ? 0 : 2) + (c.status === 'started' || c.status === 'finished' ? 1 : 0);
    const target = cats
      .filter((c) => c.keyString === ks || (JSON.parse(c.aliasKeys) as string[]).includes(ks))
      .sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id))[0];
    if (target && isLocked(target)) throw new CategoryLockedError(RESET_LOCKED);
  }
  const entryIds = erase.map((e) => e.id);
  const recIds = erase.flatMap((e) => e.recasementIds);
  if (entryIds.length) db.delete(historyEntries).where(inArray(historyEntries.id, entryIds)).run();
  if (recIds.length) db.delete(recasements).where(inArray(recasements.id, recIds)).run();
  for (const r of refusalRows) db.delete(refusals).where(and(eq(refusals.competitionId, competitionId), eq(refusals.proposalId, r.proposalId))).run();
  for (const r of asideRows) db.delete(setAsideCases).where(and(eq(setAsideCases.competitionId, competitionId), eq(setAsideCases.caseId, r.caseId))).run();
}

/** Ce que « Repartir de zéro » ferait dans la session `waveId` (`null` : toutes). */
export async function resetPreview(db: AppDb, competitionId: string, waveId: string | null, state?: State): Promise<ResetPreview> {
  return (await resetSorting(db, competitionId, waveId, { state, trial: true })).preview;
}

/**
 * « Repartir de zéro » dans la session `waveId` (`null` : toutes, ou compétition sans sessions) : annule en cascade les actions
 * de `RESET_KINDS` décidées depuis cette session, sauf celles laissées en place (session lancée, catégorie commencée, et ce
 * qui en dépend), avec les Places / Tirage / Format plus récents qui touchent les mêmes catégories ; puis efface leurs lignes
 * d'historique, les refus et les cartes mises de côté de la session. Tout ou rien : refusé si la session est lancée, si un
 * combattant a été réaffecté ensuite depuis une autre session, ou si un combattant retournerait dans une catégorie commencée
 * ou d'une session lancée. `expect` : le lot affiché (`ResetPreview.lot`) ; s'il diffère (un autre poste a agi entre-temps),
 * rien n'est fait.
 */
export async function resetReplacement(
  db: AppDb,
  competitionId: string,
  waveId: string | null,
  expect: string[],
): Promise<{ undone: number; kept: ResetPreview['kept'] }> {
  return atomically(db, async () => {
    const sorting = await resetSorting(db, competitionId, waveId, { trial: false });
    const { preview } = sorting;
    if ([...expect].sort().join('\n') !== [...preview.lot].sort().join('\n')) throw new StaleProposalError(HISTORY_STALE);
    if (preview.locked) throw new CategoryLockedError(RESET_LOCKED);
    if (preview.blockedBy) {
      throw new StaleProposalError(`${preview.blockedBy} a été réaffecté ensuite depuis une autre session : annulez d’abord ce déplacement-là (historique), puis recommencez.`);
    }
    // Une inscription supprimée depuis : sa ligne est rejouée quand même (clés des catégories, présences emmenées) ; l'inscription
    // elle-même n'existe plus et n'est pas comptée.
    await applyReset(db, competitionId, sorting);
    return { undone: preview.undo, kept: preview.kept };
  });
}

/** Recalcule et enregistre la clé des catégories choisies d'après leurs membres, puis resynchronise. */
export async function recomputeKeys(db: AppDb, competitionId: string, pick: (state: State) => string[]): Promise<void> {
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
    .map(({ row: { snapshotJson: _s, ...r } }) => withoutRowMeta(r));
}

// --- Pesée ---

/** Inscriptions des catégories d'une vague (vague inconnue : erreur 404). */
async function registrationsOfWave(db: AppDb, competitionId: string, waveId: string): Promise<Set<string>> {
  if (!(await listWaves(db, competitionId)).some((w) => w.id === waveId)) throw new NotFoundError('Session introuvable');
  // Même calcul que l'écran (vague des catégories d'après leurs combattants d'origine).
  return new Set((await listCategories(db, competitionId)).filter((c) => c.waveId === waveId).flatMap((c) => c.registrationIds));
}

/** Avec des vagues, la pesée se fait toujours dans une vague : refus d'un pointage ou d'une clôture « toutes vagues ». */
async function requireWave(db: AppDb, competitionId: string, waveId: string | undefined): Promise<void> {
  if (!waveId && (await listWaves(db, competitionId)).length > 0) {
    throw new RegistrationValidationError(['Choisissez la session de la pesée (rechargez la page si les sessions viennent d’être créées).']);
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
  // « Ne combat pas » : pas concerné par la pesée.
  const regs = db.select().from(registrations).where(eq(registrations.competitionId, competitionId)).all().filter((r) => !r.withdrawnReason && (!scope || scope.has(r.id)));
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
  // Un combattant dont toutes les inscriptions sont « ne combat pas » n'a rien à peser.
  const active = new Set(state.members.map((m) => m.fighterId));
  const withdrawnOnly = new Set(
    db.select({ fighterId: registrations.fighterId, withdrawn: registrations.withdrawnReason }).from(registrations).where(eq(registrations.competitionId, competitionId)).all()
      .filter((r) => r.withdrawn && !active.has(r.fighterId)).map((r) => r.fighterId),
  );
  return {
    closed,
    fighters: fs
      .filter((f) => !withdrawnOnly.has(f.id) && (!scope || state.members.some((m) => m.fighterId === f.id && inScope(m))))
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

export { findProposal };
