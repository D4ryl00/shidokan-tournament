import { asc, eq } from 'drizzle-orm';
import type { CategoryGrid } from '../../domain/types.js';
import type { AppDb } from '../db/client.js';
import { gridTemplates } from '../db/schema.js';
import { getGrid, replaceGrid } from './competitions.js';
import { NotFoundError } from './registrations.js';

export async function listTemplates(db: AppDb): Promise<{ id: string; name: string; createdAt: string }[]> {
  return db.select().from(gridTemplates).orderBy(asc(gridTemplates.name)).all().map(({ gridJson: _g, ...t }) => t);
}

export async function saveTemplate(db: AppDb, competitionId: string, name: string): Promise<{ id: string; name: string }> {
  const grid = await getGrid(db, competitionId);
  const id = crypto.randomUUID();
  db.insert(gridTemplates).values({ id, name, gridJson: JSON.stringify(grid) }).run();
  return { id, name };
}

export async function templateGrid(db: AppDb, templateId: string): Promise<CategoryGrid> {
  const row = db.select().from(gridTemplates).where(eq(gridTemplates.id, templateId)).get();
  if (!row) throw new NotFoundError('Modèle introuvable');
  return JSON.parse(row.gridJson) as CategoryGrid;
}

export async function loadTemplate(db: AppDb, competitionId: string, templateId: string): Promise<void> {
  await replaceGrid(db, competitionId, await templateGrid(db, templateId));
}
