export interface KatakaSlot {
  name: string;
  club: string;
  done: boolean;
}

/**
 * Appel d'un bloc de kata : le premier kataka non noté se présente, le non noté suivant se prépare.
 * `position` : rang (à partir de 1) de celui qui se présente parmi les présents ; tous notés : `total`.
 */
export function kataCall(list: KatakaSlot[]): { position: number; total: number; current: KatakaSlot | null; next: KatakaSlot | null } {
  const i = list.findIndex((k) => !k.done);
  if (i < 0) return { position: list.length, total: list.length, current: null, next: null };
  return { position: i + 1, total: list.length, current: list[i]!, next: list.slice(i + 1).find((k) => !k.done) ?? null };
}
