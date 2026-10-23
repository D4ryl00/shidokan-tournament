import type { AppDb } from '../db/client.js';
import { instance } from '../db/schema.js';

export interface Instance {
  id: string;
  name: string;
}

export function getInstance(db: AppDb): Instance | null {
  const row = db.select({ id: instance.id, name: instance.name }).from(instance).get();
  return row ?? null;
}

/** Crée la ligne unique si elle manque (nouvel UUID, nom `name`) ; sinon la renvoie telle quelle (le nom n'est pas écrasé). */
export function ensureInstance(db: AppDb, name: string): Instance {
  const existing = getInstance(db);
  if (existing) return existing;
  const created = { id: crypto.randomUUID(), name };
  db.insert(instance).values(created).run();
  return created;
}
