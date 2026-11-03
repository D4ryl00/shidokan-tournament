/** « 0 présent », « 1 présent », « 3 présents » : 0 et 1 au singulier, nombre écrit à la française. */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString('fr-FR')} ${n > 1 ? many : one}`;
}

/** « de » devant un nom propre : « d’Arts Martiaux », « d’Élan », mais « de Budo » ; devant un h ou un y, gardé (h aspiré, Yoseikan). */
export function ofName(name: string): string {
  const n = name.trim();
  return /^[aeiouàâäéèêëîïôöùûü]/i.test(n) ? `d’${n}` : `de ${n}`;
}
