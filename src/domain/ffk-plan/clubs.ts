import { normalizeName } from '../names.js';

/** Club de la compétition tel que le rapprochement le voit. */
export interface ExistingClub {
  id: string;
  name: string;
  ffkEntity: string | null;
  /** N° d’affiliation du club, ou à défaut de sa fiche d’annuaire ; `null` = aucun connu. */
  affiliationNumber: string | null;
}

export type ClubCertainty = 'sure' | 'doubtful' | 'new';

export interface ClubLink {
  clubEntity: string;
  clubName: string;
  /** Chiffres en tête de l’entité FFK. */
  affiliationNumber: string | null;
  proposal: { clubId: string; name: string; certainty: 'sure' | 'doubtful' } | null;
  /** Club relié (choix ou proposition sûre) ; `null` = pas relié. */
  target: string | null;
  /** Décidé par l’organisateur (un choix est présent dans `clubLinks`). */
  chosen: boolean;
  /** Lignes de l’export pour ce club. */
  rows: number;
  /** Remarque (ex. deux entités FFK portent le même nom de club). */
  warning?: string;
}

/** N° d’affiliation : les chiffres en tête de l’entité (« 0060690 ETOILE… » → « 0060690 »). */
export const entityAffiliation = (clubEntity: string): string | null => /^(\d+)\s/.exec(clubEntity)?.[1] ?? null;

/**
 * Rapproche les entités FFK de l’export des clubs de la compétition.
 * Sûr : même entité, alias, même nom ou même N° d’affiliation (chaînes comparées telles quelles, zéros compris) ;
 * à vérifier : nom contenu dans l’autre. `choices` : id de club pour relier, `'none'` pour ne pas relier.
 */
export function linkClubs(
  entities: { clubEntity: string; clubName: string; rows: number }[],
  clubs: ExistingClub[],
  aliases: Record<string, string>,
  choices: Record<string, string | 'none'> | undefined,
): ClubLink[] {
  const sameName = (name: string) => entities.filter((e) => normalizeName(e.clubName) === normalizeName(name)).length > 1;
  return entities.map(({ clubEntity, clubName, rows }): ClubLink => {
    const key = normalizeName(clubName);
    const affiliationNumber = entityAffiliation(clubEntity);
    const sure =
      clubs.find((c) => c.ffkEntity === clubEntity) ??
      clubs.find((c) => aliases[normalizeName(c.name)] === clubEntity) ??
      clubs.find((c) => normalizeName(c.name) === key) ??
      clubs.find((c) => affiliationNumber !== null && !!c.affiliationNumber && c.affiliationNumber === affiliationNumber);
    const containing = clubs.find((c) => {
      const k = normalizeName(c.name);
      return k !== key && k.length >= 3 && (key.includes(k) || k.includes(key));
    });
    const proposal = sure
      ? { clubId: sure.id, name: sure.name, certainty: 'sure' as const }
      : containing
        ? { clubId: containing.id, name: containing.name, certainty: 'doubtful' as const }
        : null;
    const choice = choices?.[clubEntity];
    const chosen = choice === 'none' || (choice !== undefined && clubs.some((c) => c.id === choice));
    const target = chosen ? (choice === 'none' ? null : choice!) : proposal?.certainty === 'sure' ? proposal.clubId : null;
    const link: ClubLink = { clubEntity, clubName, affiliationNumber, proposal, target, chosen, rows };
    return sameName(clubName) ? { ...link, warning: `Plusieurs entités FFK portent le même nom de club « ${clubName} » : vérifier le lien.` } : link;
  });
}
