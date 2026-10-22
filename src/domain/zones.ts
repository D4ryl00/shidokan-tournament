import { normalizeName } from './names.js';
import type { DisciplineId } from './types.js';

/** Zone de combat (« Tatami 1 », « Ring »…), dans l'ordre d'affichage de la compétition. */
export interface Zone {
  id: string;
  name: string;
  order: number;
  /** Disciplines accueillies ; null = toutes. */
  disciplines: DisciplineId[] | null;
}
/** Zone telle qu'enregistrée par l'organisateur : sans identifiant, c'est une nouvelle zone ; l'ordre est le rang dans la liste. */
export interface ZoneInput {
  id?: string;
  name: string;
  /** Omis : inchangé (toutes pour une nouvelle zone) ; null : toutes. */
  disciplines?: DisciplineId[] | null;
}

export const ZONE_NAME_MAX = 40;
export const ZONE_MAX = 20;

export function defaultZoneNames(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `Tatami ${i + 1}`);
}

/** Nom proposé pour une zone ajoutée : le premier « Tatami N » libre. */
export function nextZoneName(existing: string[]): string {
  const taken = new Set(existing.map((n) => normalizeName(n)));
  for (let n = 1; ; n++) if (!taken.has(normalizeName(`Tatami ${n}`))) return `Tatami ${n}`;
}

export function validateZones(zones: ZoneInput[]): string[] {
  if (zones.length === 0) return ['Il faut au moins une zone de combat.'];
  if (zones.length > ZONE_MAX) return [`Pas plus de ${ZONE_MAX} zones de combat.`];
  const errors: string[] = [];
  const ids = zones.map((z) => z.id).filter(Boolean);
  if (new Set(ids).size !== ids.length) errors.push('La même zone apparaît deux fois dans la liste.');
  const seen = new Map<string, string>();
  for (const z of zones) {
    const name = z.name.trim();
    if (!name) {
      errors.push('Une zone de combat n’a pas de nom.');
      continue;
    }
    if (z.disciplines && z.disciplines.length === 0) errors.push(`La zone « ${name} » n’accueille aucune discipline : cochez-en au moins une.`);
    if (name.length > ZONE_NAME_MAX) errors.push(`Nom de zone trop long (${ZONE_NAME_MAX} caractères au plus) : « ${name} ».`);
    const key = normalizeName(name);
    if (seen.has(key)) errors.push(`Deux zones portent le même nom : « ${seen.get(key)} ».`);
    else seen.set(key, name);
  }
  return errors;
}
