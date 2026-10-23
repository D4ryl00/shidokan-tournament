import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDb } from '../db/client.js';
import { everythingChanged } from '../events.js';
import { RestoreError, backupFile, backupNow, freshCopy, listBackups, restoreFrom } from '../repositories/backups.js';
import { createCompetition, getCompetition } from '../repositories/competitions.js';
import { listTemplates, loadTemplate, saveTemplate, templateGrid } from '../repositories/templates.js';
import { replaceGrid } from '../repositories/competitions.js';
import { competitionCreateSchema } from '../../domain/api-schemas.js';

export async function backupRoutes(app: FastifyInstance, { db, dbPath }: { db: AppDb; dbPath: string }) {
  app.get('/api/backups', async () => listBackups(dbPath));
  app.post('/api/backups', async (_req, reply) => reply.status(201).send({ file: (await backupNow(db, dbPath)).split(/[\\/]/).pop() }));
  app.get<{ Params: { name: string } }>('/api/backups/:name', async (req, reply) => {
    const file = backupFile(dbPath, req.params.name);
    if (!file) return reply.status(404).send({ error: 'Sauvegarde introuvable' });
    return reply.header('Content-Type', 'application/vnd.sqlite3').header('Content-Disposition', `attachment; filename="${req.params.name}"`).send(fs.readFileSync(file));
  });
  app.get('/api/backup.sqlite', async (_req, reply) => {
    const name = `shidokan-${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')}.sqlite`;
    return reply.header('Content-Type', 'application/vnd.sqlite3').header('Content-Disposition', `attachment; filename="${name}"`).send(freshCopy(db));
  });
  app.post('/api/restore', async (req, reply) => {
    if (!Buffer.isBuffer(req.body)) throw new RestoreError();
    await restoreFrom(db, req.body, () => backupNow(db, dbPath)); // filet de sécurité avant d'écraser
    everythingChanged();
    return reply.status(204).send();
  });

  app.get('/api/grid-templates', async () => listTemplates(db));
  app.post<{ Params: { id: string } }>('/api/competitions/:id/grid/save-template', async (req, reply) => {
    if (!(await getCompetition(db, req.params.id))) return reply.status(404).send({ error: 'Compétition introuvable' });
    const { name } = z.object({ name: z.string().trim().min(1).max(80) }).parse(req.body);
    return reply.status(201).send(await saveTemplate(db, req.params.id, name));
  });
  app.post<{ Params: { id: string } }>('/api/competitions/:id/grid/load-template', async (req, reply) => {
    if (!(await getCompetition(db, req.params.id))) return reply.status(404).send({ error: 'Compétition introuvable' });
    const { templateId } = z.object({ templateId: z.string() }).parse(req.body);
    await loadTemplate(db, req.params.id, templateId);
    return reply.status(204).send();
  });

  // Création d'une compétition, avec grille d'un modèle (remplace la route simple de app.ts).
  app.post('/api/competitions', async (req, reply) => {
    const { templateId, ...rest } = z.object({ templateId: z.string().optional() }).passthrough().parse(req.body) as { templateId?: string } & Record<string, unknown>;
    const input = competitionCreateSchema.parse(rest);
    const grid = templateId ? await templateGrid(db, templateId) : null;
    const c = await createCompetition(db, input);
    if (grid) await replaceGrid(db, c.id, grid);
    return reply.status(201).send(c);
  });
}
