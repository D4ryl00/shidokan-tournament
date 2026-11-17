import { and, eq, sql } from 'drizzle-orm';
import { kgText } from '../../domain/club-form.js';
import { DISCIPLINES, RULESETS } from '../../domain/disciplines.js';
import { diffFighter, subjectOf, type FighterSnapshot } from '../../domain/journal/fighter-diff.js';
import { JOURNAL_VIA_LABELS, type JournalVia } from '../../domain/journal/types.js';
import type { RegistrationSource } from '../../domain/registration.js';
import type { DisciplineId } from '../../domain/types.js';
import type { AppDb } from '../db/client.js';
import { ageBands, clubs, fighters, registrations, weightClasses } from '../db/schema.js';
import { markJournalHandled } from './context.js';
import { recordJournal } from './write.js';

/** Manière d'une inscription d'après son origine. */
export const viaOfSource = (source: RegistrationSource): JournalVia =>
  ({ onsite: 'sur-place', online: 'en-ligne', club_form: 'fiche-club', ffk: 'import-ffk', manual: 'saisie' } as const)[source];

/** « Karaté Jiyu », « Kata ». */
const registrationLabel = (r: { discipline: DisciplineId; ruleset: 'jiyu' | 'shobu' | null }): string =>
  r.ruleset ? `${DISCIPLINES[r.discipline].label} ${RULESETS[r.ruleset].label.split(' ')[0]}` : DISCIPLINES[r.discipline].label;

/**
 * Photo d'un combattant pour le journal, avec les libellés lus maintenant (ils sont recopiés dans l'entrée) ; null s'il n'existe pas.
 * Ni le poids de pesée ni la présence (notés à part).
 */
export function fighterSnapshot(t: AppDb, competitionId: string, fighterId: string): FighterSnapshot | null {
  const f = t.select().from(fighters).where(and(eq(fighters.id, fighterId), eq(fighters.competitionId, competitionId))).get();
  if (!f) return null;
  const club = f.clubId ? t.select({ name: clubs.name }).from(clubs).where(eq(clubs.id, f.clubId)).get()?.name ?? null : null;
  const band = t.select({ label: ageBands.label }).from(ageBands).where(and(eq(ageBands.competitionId, competitionId), eq(ageBands.code, f.ageBandCode))).get();
  const wcLabels = new Map(
    t.select({ id: weightClasses.id, label: weightClasses.label }).from(weightClasses).where(eq(weightClasses.competitionId, competitionId)).all().map((w) => [w.id, w.label]),
  );
  const regs: FighterSnapshot['registrations'] = {};
  for (const r of t.select().from(registrations).where(eq(registrations.fighterId, f.id)).orderBy(sql`rowid`).all()) {
    let key = registrationLabel(r);
    // Deux inscriptions au même libellé (rare : recasement) restent distinctes.
    for (let n = 2; regs[key]; n++) key = `${registrationLabel(r)} (${n})`;
    const others = JSON.parse(r.otherDisciplinesJson) as DisciplineId[];
    regs[key] = {
      // Pas de poids pour le kata : la ligne d'un club y recopie le poids des combats, sans intérêt ici.
      ...(DISCIPLINES[r.discipline].hasWeight
        ? {
            'Catégorie de poids': r.weightClassId ? `${wcLabels.get(r.weightClassId) ?? r.weightClassId} kg` : null,
            'Poids annoncé': r.approxWeightKg === null ? null : `${kgText(r.approxWeightKg)} kg`,
          }
        : {}),
      Origine: JOURNAL_VIA_LABELS[viaOfSource(r.source)],
      Reclassement: others.length ? others.map((d) => DISCIPLINES[d].label).join(', ') : null,
      'Proposer d’abord': r.acceptsJiyuFirst === null ? null : r.acceptsJiyuFirst ? 'passer en jiyu' : 'changer de discipline',
    };
  }
  return {
    name: `${f.lastName} ${f.firstName}`.trim(),
    club,
    fields: {
      Sexe: f.sex,
      "Catégorie d'âge": band?.label ?? f.ageBandCode,
      Grade: f.grade,
      Licence: f.licence,
      'Nom public': f.publicNameHidden ? 'masqué' : 'affiché',
    },
    registrations: regs,
  };
}

/**
 * Note le passage de `before` à `after` (dans la transaction de la modification) : ajout, suppression, ou modification champ par champ.
 * Rien d'écrit si rien n'a changé, et la requête est marquée comme traitée : le filet de sécurité n'écrit pas d'entrée brute.
 */
export function recordFighterChange(t: AppDb, competitionId: string, before: FighterSnapshot | null, after: FighterSnapshot | null, via?: JournalVia): void {
  markJournalHandled();
  const subject = after ?? before;
  if (!subject) return;
  const data = { subject: subjectOf(subject) };
  if (!before) {
    recordJournal(t, competitionId, { type: 'inscription', action: 'fighter-added', via, data: { ...data, detail: Object.keys(after!.registrations).join(' · ') || undefined } });
  } else if (!after) {
    recordJournal(t, competitionId, { type: 'inscription', action: 'fighter-removed', via, data });
  } else {
    const changes = diffFighter(before, after);
    if (changes.length) recordJournal(t, competitionId, { type: 'inscription', action: 'fighter-changed', via, data: { ...data, changes } });
  }
}
