import type { QueueKataka } from './api.js';

/**
 * Appel d'un bloc de kata : le premier kataka non noté se présente, le non noté suivant se prépare ; un absent tardif n'est
 * jamais appelé ni compté. `position` : rang (à partir de 1) de celui qui se présente parmi les présents ; tous notés : `total`.
 */
export function kataCall(list: QueueKataka[]): { position: number; total: number; current: QueueKataka | null; next: QueueKataka | null } {
  const present = list.filter((k) => !k.absent);
  const i = present.findIndex((k) => !k.done);
  if (i < 0) return { position: present.length, total: present.length, current: null, next: null };
  return { position: i + 1, total: present.length, current: present[i]!, next: present.slice(i + 1).find((k) => !k.done) ?? null };
}
