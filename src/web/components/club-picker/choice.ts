/** Choix d'un club : un club de la compétition, ou une fiche de l'annuaire (son club de compétition n'existe pas encore). */
export type ClubChoice = { kind: 'club'; id: string } | { kind: 'directory'; id: string };

/** Clé d'une option de liste : `club:<id>` ou `dir:<id>`. */
export const choiceKey = (c: ClubChoice): string => `${c.kind === 'club' ? 'club' : 'dir'}:${c.id}`;

export function parseChoice(key: string): ClubChoice | null {
  const m = /^(club|dir):(.+)$/.exec(key);
  if (!m) return null;
  return { kind: m[1] === 'club' ? 'club' : 'directory', id: m[2]! };
}
