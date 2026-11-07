import { eq } from 'drizzle-orm';
import type { Bracket } from '../../domain/brackets/index.js';
import { replaceEntrant } from '../../domain/brackets/replace-entrant.js';
import { newSameClubPairs, sameClubSentence } from '../../domain/brackets/same-club.js';
import type { Entrant } from '../../domain/brackets/types.js';
import { waveMoves } from '../../domain/replacement/waves.js';
import { atomically, dryRun } from '../db/atomic.js';
import type { AppDb } from '../db/client.js';
import { categories, clubs, fighters, registrations } from '../db/schema.js';
import { recorded } from './history.js';
import { actionWave, loadState, persistManualMove } from './replacement.js';
import { NotFoundError, RegistrationValidationError } from './registrations.js';

const bracketsOf = (db: AppDb, competitionId: string): Map<string, Bracket | null> =>
  new Map(
    db.select({ id: categories.id, bracketJson: categories.bracketJson }).from(categories).where(eq(categories.competitionId, competitionId)).all()
      .map((r) => [r.id, r.bracketJson ? (JSON.parse(r.bracketJson) as Bracket) : null]),
  );

/** Nom « NOM Prénom » et club d'une inscription (pour les phrases d'avertissement). */
function infoOf(db: AppDb, registrationId: string): { name: string; club: string } {
  const row = db
    .select({ lastName: fighters.lastName, firstName: fighters.firstName, club: clubs.name })
    .from(registrations)
    .innerJoin(fighters, eq(fighters.id, registrations.fighterId))
    .leftJoin(clubs, eq(clubs.id, fighters.clubId))
    .where(eq(registrations.id, registrationId))
    .get();
  return { name: row ? `${row.lastName} ${row.firstName}`.trim() : '', club: row?.club ?? '' };
}

/**
 * Exécute `run`, puis rend, avec sa valeur, les phrases des nouvelles paires du même club au 1er tour (absentes avant,
 * présentes après) dans les tableaux qu'il a changés (spec §2.7).
 */
export async function withSameClub<T>(db: AppDb, competitionId: string, run: () => Promise<T>): Promise<{ value: T; sameClub: string[] }> {
  const before = bracketsOf(db, competitionId);
  const value = await run();
  const sameClub: string[] = [];
  for (const [id, after] of bracketsOf(db, competitionId)) {
    for (const pair of newSameClubPairs(before.get(id) ?? null, after)) sameClub.push(sameClubSentence(pair, (rid) => infoOf(db, rid)));
  }
  return { value, sameClub };
}

/** Le même déplacement, essayé à blanc (rien n'est écrit) : avertissements « même club » qu'il provoquerait. */
export async function sameClubPreview(db: AppDb, competitionId: string, run: () => Promise<unknown>): Promise<string[]> {
  return dryRun(db, async () => (await withSameClub(db, competitionId, run)).sameClub);
}

type Written = { warnings: string[]; recasementIds: string[]; labels: [string, string]; waveId: string | null };

/** Les écritures de l'échange (dans une transaction de l'appelant) : chacun à la place exacte de l'autre. */
async function writeExchange(db: AppDb, competitionId: string, a: string, b: string): Promise<Written> {
  const state = await loadState(db, competitionId);
  const [ma, mb] = [a, b].map((id) => state.members.find((m) => m.registrationId === id));
  if (!ma || !mb) throw new NotFoundError('Inscription introuvable');
  if (ma.categoryId === null || mb.categoryId === null) throw new RegistrationValidationError(['Échange impossible : un combattant n’a pas de catégorie.']);
  if (ma.categoryId === mb.categoryId) throw new RegistrationValidationError(['Échange impossible : ces deux combattants sont dans la même catégorie.']);
  if (ma.presence === 'absent' || mb.presence === 'absent') throw new RegistrationValidationError(['Échange impossible : un des combattants est absent.']);
  const [catA, catB] = [ma.categoryId, mb.categoryId];
  const label = (id: string) => db.select({ l: categories.label }).from(categories).where(eq(categories.id, id)).get()?.l ?? '';
  const labels: [string, string] = [label(catA), label(catB)];
  const waveId = actionWave(state, 'manual', a);
  const before = bracketsOf(db, competitionId);
  const entrant = (id: string): Entrant => {
    const row = db.select({ clubId: fighters.clubId, lastName: fighters.lastName, firstName: fighters.firstName }).from(registrations).innerJoin(fighters, eq(fighters.id, registrations.fighterId)).where(eq(registrations.id, id)).get()!;
    return { registrationId: id, clubId: row.clubId, label: `${row.lastName} ${row.firstName}`.trim() };
  };
  const [eA, eB] = [entrant(a), entrant(b)];
  const keyOf = (id: string) => db.select({ keyString: categories.keyString, keyJson: categories.keyJson, aliasKeys: categories.aliasKeys, label: categories.label })
    .from(categories).where(eq(categories.id, id)).get()!;
  const keys = new Map([catA, catB].map((id) => [id, keyOf(id)]));
  const r1 = persistManualMove(db, competitionId, state, a, catB);
  // Sans resynchroniser : la catégorie que A vient de quitter (vide s'il y était seul) attend B.
  const r2 = persistManualMove(db, competitionId, await loadState(db, competitionId, { sync: false }), b, catA);
  const rewrite = (categoryId: string, from: string, to: Entrant) => {
    const bracket = before.get(categoryId);
    if (!bracket) return;
    db.update(categories).set({ bracketJson: JSON.stringify(replaceEntrant(bracket, from, to)), arranged: true, stale: false }).where(eq(categories.id, categoryId)).run();
  };
  rewrite(catA, a, eB);
  rewrite(catB, b, eA);
  // Une catégorie qui ne garde aucun de ses présents d'origine (un combattant seul, du bac « Sans adversaire ») garde sa clé :
  // sinon elle prendrait celle de l'arrivant et attirerait, à la synchronisation, les anciens voisins de celui-ci.
  const after = await loadState(db, competitionId, { sync: false });
  for (const id of [catA, catB]) {
    if (!after.members.some((m) => m.categoryId === id && !m.placementLocked && m.presence !== 'absent')) {
      db.update(categories).set(keys.get(id)!).where(eq(categories.id, id)).run();
    }
  }
  const prefix = (id: string, ws: string[]) => ws.map((w) => `${infoOf(db, id).name} : ${w}`);
  return { warnings: [...prefix(a, r1.warnings), ...prefix(b, r2.warnings)], recasementIds: [r1.recasementId, r2.recasementId], labels, waveId };
}

export interface ExchangeWaveMove { registrationId: string; label: string; from: string | null; to: string | null }

/** Ce que l'échange avertirait (règles enfreintes, même club au 1er tour, changements de session), sans rien écrire. */
export async function exchangePreview(db: AppDb, competitionId: string, a: string, b: string): Promise<{ warnings: string[]; sameClub: string[]; waveMoves: ExchangeWaveMove[] }> {
  return dryRun(db, async () => {
    const before = await loadState(db, competitionId);
    const { value, sameClub } = await withSameClub(db, competitionId, () => writeExchange(db, competitionId, a, b));
    const label = new Map(before.members.map((m) => [m.registrationId, m.label]));
    const moves = waveMoves(before, await loadState(db, competitionId)).map((x) => ({ ...x, label: label.get(x.registrationId) ?? '' }));
    return { warnings: value.warnings, sameClub, waveMoves: moves };
  });
}

/** Échange deux combattants de deux catégories : chacun prend la place exacte de l'autre, une seule entrée d'historique. */
export async function exchangeEntrants(db: AppDb, competitionId: string, a: string, b: string): Promise<{ warnings: string[]; sameClub: string[]; historyId: string | null }> {
  return atomically(db, async () => {
    const before = bracketsOf(db, competitionId);
    const { result, historyId } = await recorded(
      db,
      competitionId,
      (w: Written) => ({
        kind: 'exchange',
        waveId: w.waveId,
        summary: { registrationIds: [a, b], fromLabel: w.labels[0], toLabel: w.labels[1], reason: 'Échangés à la main' },
        recasementIds: w.recasementIds,
      }),
      () => writeExchange(db, competitionId, a, b),
    );
    const sameClub: string[] = [];
    for (const [id, after] of bracketsOf(db, competitionId)) {
      for (const pair of newSameClubPairs(before.get(id) ?? null, after)) sameClub.push(sameClubSentence(pair, (rid) => infoOf(db, rid)));
    }
    return { warnings: result.warnings, sameClub, historyId };
  });
}

