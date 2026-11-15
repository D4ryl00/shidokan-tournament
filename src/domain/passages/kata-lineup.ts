/**
 * Un kataka d'un bloc de kata, dans l'ordre de passage : `done` quand ses notes de ce tour sont saisies ; `absent` pour un absent
 * tardif resté dans le tableau (la feuille de notation le garde : il n'est jamais appelé).
 */
export interface KatakaSlot {
  registrationId: string;
  done: boolean;
  absent: boolean;
}

/** Katakas de `ids`, dans cet ordre ; `done` : au moins une note déjà saisie dans ce tour ; `absent` : dans `absentIds`. */
export function kataLineup(ids: string[], absentIds: string[], notes: Record<string, number[]>): KatakaSlot[] {
  const absent = new Set(absentIds);
  return ids.map((registrationId) => ({ registrationId, done: (notes[registrationId] ?? []).length > 0, absent: absent.has(registrationId) }));
}
