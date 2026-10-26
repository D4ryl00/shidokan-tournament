import { and, eq, inArray, sql } from 'drizzle-orm';
import { categoryLabel, compareKeys, keyString } from '../../domain/categories.js';
import { entryKey } from '../../domain/closed-categories.js';
import { DISCIPLINES } from '../../domain/disciplines.js';
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
  categoryWaves,
  waveMoves,
} from '../../domain/replacement/index.js';
import { manualProposal as domainManualProposal } from '../../domain/replacement/manual.js';
import type { AppDb } from '../db/client.js';
import { withoutRowMeta } from '../db/row-versions.js';
import { categories, clubs, competitions, fighters, recasements, refusals, registrations, setAsideCases, waves } from '../db/schema.js';
import { listWaves } from './waves.js';
import { launchedWaveKeys } from './launch-state.js';
import type { Wave } from '../../domain/waves.js';
import { CategoryLockedError, listCategories, syncCategories } from './categories.js';
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
  db.insert(setAsideCases).values({ competitionId, caseId, note: note.trim() }).onConflictDoUpdate({ target: [setAsideCases.competitionId, setAsideCases.caseId], set: { note: note.trim() } }).run();
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

/** « Ne combat pas » pour un inscrit d'une catégorie fermée : hors de toute catégorie, inscrit au journal (annulable). */
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
  db.transaction((tx) => {
    const t = tx as unknown as AppDb;
    t.update(registrations).set({ withdrawnReason: 'closed_category', withdrawnEntry, categoryId: null }).where(eq(registrations.id, registrationId)).run();
    t.insert(recasements)
      .values({
        id: crypto.randomUUID(), competitionId, registrationId, proposalId: `W:${registrationId}`, type: 'W',
        fromLabel: from ? categoryLabel(from.key, state.grid) : '—', toLabel: 'Ne combat pas', reason: 'Catégorie non ouverte à cette compétition',
        manual: true, preApproved: false, bulk: false, snapshotJson: JSON.stringify(snapshot),
      })
      .run();
  });
  await syncCategories(db, competitionId);
}

export async function applyProposalById(db: AppDb, competitionId: string, proposalId: string, opts: { bulk?: boolean; fingerprint?: string } = {}): Promise<void> {
  const state = await loadState(db, competitionId);
  if (opts.fingerprint !== undefined && stateFingerprint(state) !== opts.fingerprint) throw new StaleProposalError();
  const p = findProposal(state, proposalId);
  persistAll(db, competitionId, state, p, { bulk: opts.bulk ?? false });
  await syncCategories(db, competitionId);
}

/** Écrit chaque déplacement d'une proposition (plusieurs pour un « split »), un recasement par inscription. */
function persistAll(db: AppDb, competitionId: string, state: State, p: Proposal, opts: { bulk: boolean }): void {
  let current = state;
  for (const step of proposalMoves(p)) {
    const next = applyProposal(current, step);
    persist(db, competitionId, current, next, step, opts);
    current = next;
  }
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
export async function planInput(db: AppDb, competitionId: string, body: { waveId?: string; choices: PlanChoice[]; forApply?: boolean }): Promise<{ state: State; input: PlanInput }> {
  const waveId = await planWave(db, competitionId, body.waveId);
  const state = await loadState(db, competitionId);
  return { state, input: { waveId, choices: body.choices, forApply: body.forApply === true } };
}

/** Plan d'ensemble de la session (voir `planPayload`), calculé dans un fil à part. */
export async function planResponse(
  db: AppDb,
  competitionId: string,
  body: { waveId?: string; choices: PlanChoice[]; forApply?: boolean },
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
  body: { waveId?: string; choices: PlanChoice[]; fingerprint: string; hash: string },
): Promise<{ applied: number }> {
  const waveId = await planWave(db, competitionId, body.waveId);
  let state = await loadState(db, competitionId);
  if (stateFingerprint(state) !== body.fingerprint) throw new StaleProposalError();
  // Recalcul dans le fil, comme pour l'affichage : rien n'est écrit avant son résultat. Sans signal d'abandon : une écriture,
  // une fois demandée, va jusqu'au bout (même si le client part), sauf si l'état a changé entre-temps.
  const { plan } = await runPlanJob(state, { waveId, choices: body.choices, forApply: true });
  if (plan.hash !== body.hash) throw new StaleProposalError('Le plan a changé depuis l’affichage : relisez-le avant de l’appliquer.');
  // Pendant le calcul, un autre poste a pu écrire (pesée, déplacement, même plan appliqué) : on revérifie l'empreinte,
  // puis on écrit sans plus rendre la main (base synchrone, aucune attente d'entrée-sortie dans la boucle).
  if (stateFingerprint(await loadState(db, competitionId)) !== body.fingerprint) throw new StaleProposalError();
  // Tout ou rien : une seule transaction pour tous les déplacements (les `await` ci-dessous ne rendent jamais la main à une
  // autre requête, la base est synchrone). Un déplacement refusé annule ceux déjà écrits ; `persist` s'y emboîte en point de sauvegarde.
  const raw = db.$client;
  let applied = 0;
  let begun = false;
  try {
    // Dans le `try` : un échec du BEGIN suit le même chemin d'erreur, sans ROLLBACK (aucune transaction ouverte ici, et une
    // transaction ouverte ailleurs n'est pas la nôtre).
    raw.exec('BEGIN IMMEDIATE');
    begun = true;
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
      persistAll(db, competitionId, state, p, { bulk: true });
      applied++;
    }
    raw.exec('COMMIT');
  } catch (e) {
    if (begun && raw.inTransaction) raw.exec('ROLLBACK');
    throw e;
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
  const r = domainManualProposal(state, registrationId, categoryId);
  if ('p' in r) return r;
  switch (r.error) {
    case 'not-found': throw new NotFoundError('Inscription ou catégorie introuvable');
    case 'frozen': throw new CategoryLockedError('La session est lancée : rouvrez-la pour y déplacer quelqu’un.');
    case 'locked': throw new CategoryLockedError();
    case 'closed': throw new RegistrationValidationError(['Catégorie non ouverte à cette compétition : choisissez-en une autre.']);
  }
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
  if (!entry || entry.status !== 'validated') throw new NotFoundError('Réaffectation introuvable');
  const snapshot = JSON.parse(entry.snapshotJson) as {
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
  const reg = db.select().from(registrations).where(eq(registrations.id, entry.registrationId)).get();
  if (!reg) throw new NotFoundError('Inscription introuvable');
  const locked = (id: string | null) => {
    const c = id ? db.select().from(categories).where(eq(categories.id, id)).get() : undefined;
    return c !== undefined && (c.status === 'started' || c.status === 'finished');
  };
  if (locked(reg.categoryId) || locked(snapshot.registration.categoryId)) throw new CategoryLockedError();
  const frozen = new Set((await loadState(db, competitionId)).categories.filter((c) => c.frozen).map((c) => c.id));
  if ((reg.categoryId && frozen.has(reg.categoryId)) || (snapshot.registration.categoryId && frozen.has(snapshot.registration.categoryId))) {
    throw new CategoryLockedError('La session est lancée : rouvrez-la pour annuler cette réaffectation.');
  }
  // Ordre d'insertion (rowid) : fiable même pour deux recasements de la même milliseconde.
  const mine = db.select({ n: sql<number>`rowid` }).from(recasements).where(eq(recasements.id, entry.id)).get()!.n;
  const newer = db
    .select({ id: recasements.id, n: sql<number>`rowid` })
    .from(recasements)
    .where(and(eq(recasements.registrationId, entry.registrationId), eq(recasements.status, 'validated')))
    .all()
    .some((r) => r.id !== entry.id && r.n > mine);
  if (newer) throw new StaleProposalError("Annulez d'abord la réaffectation plus récente de ce combattant.");
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
    for (const r of snapshot.presences ?? []) t.update(registrations).set({ presence: r.presence }).where(eq(registrations.id, r.id)).run();
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
