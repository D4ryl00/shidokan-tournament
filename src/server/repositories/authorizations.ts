import { isDeepStrictEqual } from 'node:util';
import { and, eq, inArray } from 'drizzle-orm';
import {
  AUTHORIZATION_KIND_LABELS,
  authorizationRequests,
  withStatus,
  type AnswerableKind,
  type AuthorizationClub,
  type AuthorizationRequest,
  type AuthorizationSituation,
  type BlameMove,
  type StoredAnswer,
} from '../../domain/authorizations.js';
import type { HistoryKind } from '../../domain/history/types.js';
import { subjectOf } from '../../domain/journal/fighter-diff.js';
import { memberWave, type State } from '../../domain/replacement/index.js';
import { atomically } from '../db/atomic.js';
import type { AppDb } from '../db/client.js';
import { authorizationAnswers, clubs, recasements, registrations } from '../db/schema.js';
import { markJournalHandled } from '../journal/context.js';
import { fighterSnapshot } from '../journal/fighters.js';
import { recordJournal } from '../journal/write.js';
import { entriesWithBlocks, type Loaded } from './history.js';
import { knownWave, loadState, StaleProposalError } from './replacement.js';

/** « Accordée » sur une demande que le calcul ne trouve plus (situation changée par un autre poste, une pesée…). */
export const AUTHORIZATION_GONE = 'Cette demande n’existe plus : la liste est mise à jour.';
/** « Accordée » sur une situation qui n'est plus celle affichée (pesée, déplacement entre l'affichage et le clic). */
export const AUTHORIZATION_CHANGED = 'La situation a changé : relisez la demande.';
const NO_CLUB = 'Sans club';
/** Actions de l'historique qui déplacent des combattants : elles seules peuvent être « en cause » d'une demande. */
const MOVE_KINDS: HistoryKind[] = ['plan', 'reaffectation', 'manual', 'exchange'];

/** Réponses « Accordée » enregistrées d'une compétition. */
export function listAnswers(db: AppDb, competitionId: string): StoredAnswer[] {
  return db
    .select()
    .from(authorizationAnswers)
    .where(eq(authorizationAnswers.competitionId, competitionId))
    .all()
    .map((r) => ({ registrationId: r.registrationId, kind: r.kind, situation: JSON.parse(r.situationJson) as AuthorizationSituation, answeredAt: r.answeredAt }));
}

/** Enregistre (ou remplace) la réponse « Accordée » avec la situation acceptée. */
export function grantAnswer(db: AppDb, competitionId: string, registrationId: string, kind: AnswerableKind, situation: AuthorizationSituation): void {
  const values = { situationJson: JSON.stringify(situation), answeredAt: new Date().toISOString() };
  db.insert(authorizationAnswers)
    .values({ competitionId, registrationId, kind, ...values })
    .onConflictDoUpdate({ target: [authorizationAnswers.competitionId, authorizationAnswers.registrationId, authorizationAnswers.kind], set: values })
    .run();
}

export function removeAnswer(db: AppDb, competitionId: string, registrationId: string, kind: AnswerableKind): void {
  db.delete(authorizationAnswers)
    .where(and(eq(authorizationAnswers.competitionId, competitionId), eq(authorizationAnswers.registrationId, registrationId), eq(authorizationAnswers.kind, kind)))
    .run();
}

/** Efface toutes les réponses de ces inscriptions (« Repartir de zéro »). */
export function removeAnswersOf(db: AppDb, competitionId: string, registrationIds: string[]): void {
  if (registrationIds.length === 0) return;
  db.delete(authorizationAnswers)
    .where(and(eq(authorizationAnswers.competitionId, competitionId), inArray(authorizationAnswers.registrationId, registrationIds)))
    .run();
}

/** Déplacements encore en place de l'historique, pour retrouver ceux qui créent chaque demande. */
export function blameMoves(entries: Loaded[]): BlameMove[] {
  return entries
    .filter((e) => e.active && MOVE_KINDS.includes(e.kind))
    .map((e) => ({ entryId: e.id, seq: e.seq, registrationIds: e.summary.registrationIds }));
}

/**
 * Par entrée de l'historique : les propositions de ses réaffectations que « Refusée… » refuse après l'annulation, pour que le plan
 * ne les propose plus. Un déplacement à la main (`M:`) ou « Ne combat pas » (`W:`) n'est jamais proposé : rien à refuser.
 */
function refusableProposals(db: AppDb, competitionId: string, entries: Loaded[]): Map<string, string[]> {
  const proposalOf = new Map(
    db.select({ id: recasements.id, proposalId: recasements.proposalId }).from(recasements).where(eq(recasements.competitionId, competitionId)).all()
      .map((r) => [r.id, r.proposalId]),
  );
  const refusable = (p: string | undefined): p is string => p !== undefined && !p.startsWith('M:') && !p.startsWith('W:');
  return new Map(entries.map((e) => [e.id, e.recasementIds.map((id) => proposalOf.get(id)).filter(refusable)]));
}

/**
 * Demandes aux coachs de la session `waveParam` (absente : toutes ; inconnue : 404), d'après la session actuelle du combattant,
 * avec leur réponse, regroupées par club (ordre alphabétique français, « Sans club » en dernier) ; `pending` : demandes en attente.
 */
export async function authorizationList(db: AppDb, competitionId: string, waveParam: string | undefined): Promise<{ clubs: AuthorizationClub[]; pending: number }> {
  const state = await loadState(db, competitionId);
  const waveId = knownWave(state.waves, waveParam);
  const { entries, blocked } = await entriesWithBlocks(db, competitionId, state);
  const members = new Map(state.members.map((m) => [m.registrationId, m]));
  const inScope = (r: AuthorizationRequest) => waveId === null || memberWave(state, members.get(r.registrationId)!) === waveId;
  const rows = withStatus(authorizationRequests(state, blameMoves(entries)).filter(inScope), listAnswers(db, competitionId), state.grid);
  const clubRows = new Map(db.select().from(clubs).where(eq(clubs.competitionId, competitionId)).all().map((c) => [c.id, c]));
  const proposalsOf = refusableProposals(db, competitionId, entries);
  const groups = new Map<string | null, AuthorizationClub>();
  // Les demandes arrivent triées par combattant dans chaque club : l'ordre est gardé.
  for (const r of rows) {
    const club = r.clubId ? clubRows.get(r.clubId) : undefined;
    const group = groups.get(r.clubId) ?? { clubId: r.clubId, name: r.clubId ? (club?.name ?? '—') : NO_CLUB, preApproval: club?.preApproval ?? false, requests: [] };
    groups.set(r.clubId, group);
    const member = members.get(r.registrationId)!;
    group.requests.push({
      ...r, label: member.label, fighterId: member.fighterId, blocked: r.blame.map(blocked).find((b) => b !== null) ?? null,
      blameProposalIds: [...new Set(r.blame.flatMap((id) => proposalsOf.get(id) ?? []))],
    });
  }
  const sorted = [...groups.values()].sort((a, b) => (a.clubId === null ? 1 : 0) - (b.clubId === null ? 1 : 0) || a.name.localeCompare(b.name, 'fr'));
  return { clubs: sorted, pending: rows.filter((r) => r.status === 'pending').length };
}

/** Demande actuelle de ce type pour cette inscription, recalculée depuis l'état (sans les déplacements en cause). */
function currentRequest(state: State, registrationId: string, kind: AnswerableKind): AuthorizationRequest | undefined {
  return authorizationRequests(state, []).find((r) => r.registrationId === registrationId && r.situation.kind === kind);
}

/** « Poids · Écart de poids estimé… » : le type et le texte de la demande, pour le journal. */
const journalDetail = (kind: AnswerableKind, request: AuthorizationRequest | undefined) =>
  request ? `${AUTHORIZATION_KIND_LABELS[kind]} · ${request.bullet}` : AUTHORIZATION_KIND_LABELS[kind];

/** « NOM Prénom (Club) » du combattant de l'inscription, recopié dans le journal. */
function journalSubject(db: AppDb, competitionId: string, registrationId: string): string {
  const fighterId = db.select({ fighterId: registrations.fighterId }).from(registrations).where(eq(registrations.id, registrationId)).get()?.fighterId;
  const snapshot = fighterId ? fighterSnapshot(db, competitionId, fighterId) : null;
  return snapshot ? subjectOf(snapshot) : registrationId;
}

/**
 * « Accordée » : enregistre la situation de la demande actuelle, recalculée ici (jamais celle d'un client) ; demande introuvable,
 * ou situation différente de `shown` (celle que l'organisateur a lue au coach) : 409, rien d'enregistré.
 */
export async function grantAuthorization(
  db: AppDb, competitionId: string, registrationId: string, kind: AnswerableKind, shown: AuthorizationSituation,
): Promise<void> {
  await atomically(db, async () => {
    const state = await loadState(db, competitionId);
    const request = currentRequest(state, registrationId, kind);
    if (!request) throw new StaleProposalError(AUTHORIZATION_GONE);
    if (!isDeepStrictEqual(request.situation, shown)) throw new StaleProposalError(AUTHORIZATION_CHANGED);
    grantAnswer(db, competitionId, registrationId, kind, request.situation);
    recordJournal(db, competitionId, {
      type: 'autorisation', action: 'accordee',
      data: { subject: journalSubject(db, competitionId, registrationId), detail: journalDetail(kind, request) },
    });
  });
}

/** Retire la réponse « Accordée » ; déjà retirée (autre poste) : rien ne change. */
export async function ungrantAuthorization(db: AppDb, competitionId: string, registrationId: string, kind: AnswerableKind): Promise<void> {
  await atomically(db, async () => {
    if (!listAnswers(db, competitionId).some((a) => a.registrationId === registrationId && a.kind === kind)) {
      markJournalHandled();
      return;
    }
    const state = await loadState(db, competitionId);
    removeAnswer(db, competitionId, registrationId, kind);
    recordJournal(db, competitionId, {
      type: 'autorisation', action: 'retiree',
      data: { subject: journalSubject(db, competitionId, registrationId), detail: journalDetail(kind, currentRequest(state, registrationId, kind)) },
    });
  });
}
