/**
 * Graine d'une catégorie créée : fonction stable de la compétition et de la clé (FNV-1a 32 bits),
 * pour qu'un tirage à blanc (annulé) donne le même tableau que le tirage réel.
 */
export function categorySeed(competitionId: string, keyString: string): number {
  let h = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(`${competitionId}|${keyString}`)) {
    h ^= byte;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}
