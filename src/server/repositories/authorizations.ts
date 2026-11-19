import { and, eq } from 'drizzle-orm';
import type { AnswerableKind, AuthorizationSituation, StoredAnswer } from '../../domain/authorizations.js';
import type { AppDb } from '../db/client.js';
import { authorizationAnswers } from '../db/schema.js';

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
