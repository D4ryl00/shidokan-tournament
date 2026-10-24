/** « 0 présent », « 1 présent », « 3 présents » : 0 et 1 au singulier, nombre écrit à la française. */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString('fr-FR')} ${n > 1 ? many : one}`;
}
