import { normalizeName } from '../../../domain/names.js';

/** La recherche a assez de lettres pour chercher (sinon aucun résultat, et rien à signaler). */
export const searchReady = (query: string): boolean => normalizeName(query).length >= 2;

/**
 * Recherche par le nom (club ou combattant) : dès 2 lettres, insensible aux accents et à la casse, le nom contient la recherche ;
 * `limit` résultats au plus, dans l’ordre de la liste. Jamais une longue liste à faire défiler.
 */
export function searchByName<T>(items: T[], query: string, name: (t: T) => string, limit = 6): T[] {
  if (!searchReady(query)) return [];
  const q = normalizeName(query);
  const found: T[] = [];
  for (const item of items) {
    if (normalizeName(name(item)).includes(q)) found.push(item);
    if (found.length >= limit) break;
  }
  return found;
}
