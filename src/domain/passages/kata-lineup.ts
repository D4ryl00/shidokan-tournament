/** Un kataka d'un bloc de kata, dans l'ordre de passage : `done` quand ses notes de ce tour sont saisies. */
export interface KatakaSlot {
  registrationId: string;
  done: boolean;
}

/** Présents de `ids`, dans cet ordre (les absents sont retirés) ; `done` : au moins une note déjà saisie dans ce tour. */
export function kataLineup(ids: string[], absentIds: string[], notes: Record<string, number[]>): KatakaSlot[] {
  const absent = new Set(absentIds);
  return ids.filter((id) => !absent.has(id)).map((registrationId) => ({ registrationId, done: (notes[registrationId] ?? []).length > 0 }));
}
