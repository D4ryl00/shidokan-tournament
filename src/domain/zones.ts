import { normalizeName } from './names.js';

/** Zone de combat (« Tatami 1 », « Ring »…), dans l'ordre d'affichage de la compétition. */
export interface Zone {
  id: string;
  name: string;
  order: number;
}
/** Zone telle qu'enregistrée par l'organisateur : sans identifiant, c'est une nouvelle zone ; l'ordre est le rang dans la liste. */
export interface ZoneInput {
  id?: string;
  name: string;
}

export const ZONE_NAME_MAX = 40;

export function defaultZoneNames(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `Tatami ${i + 1}`);
}

export function validateZones(zones: ZoneInput[]): string[] {
  if (zones.length === 0) return ['Il faut au moins une zone de combat.'];
  const errors: string[] = [];
  const seen = new Map<string, string>();
  for (const z of zones) {
    const name = z.name.trim();
    if (!name) {
      errors.push('Une zone de combat n’a pas de nom.');
      continue;
    }
    if (name.length > ZONE_NAME_MAX) errors.push(`Nom de zone trop long (${ZONE_NAME_MAX} caractères au plus) : « ${name} ».`);
    const key = normalizeName(name);
    if (seen.has(key)) errors.push(`Deux zones portent le même nom : « ${seen.get(key)} ».`);
    else seen.set(key, name);
  }
  return errors;
}
