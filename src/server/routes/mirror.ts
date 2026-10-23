import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDb } from '../db/client.js';
import { copiesDir, getMirror, isCopyName, listCopies, mirrorStatus, setMirror } from '../mirror.js';
import { backupNow, restoreFrom } from '../repositories/backups.js';
import { NotFoundError } from '../repositories/registrations.js';

/** PC de secours (rôle local) : réglage de la copie régulière du PC principal, liste et restauration des copies. */
export async function mirrorRoutes(app: FastifyInstance, { db, dbPath }: { db: AppDb; dbPath: string }) {
  const view = () => ({ url: getMirror(db)?.url ?? null, intervalMin: getMirror(db)?.intervalMin ?? 5, ...mirrorStatus(dbPath) });

  app.get('/api/mirror', async () => view());
  app.put('/api/mirror', async (req) => {
    const { url, intervalMin } = z
      .object({
        url: z.string().trim().max(300).refine((v) => /^https?:\/\/[^\s/]+/.test(v), 'Adresse du PC principal invalide (par exemple http://192.168.1.10:3000).').nullable(),
        intervalMin: z.number().int().min(1).max(60),
      })
      .strict()
      .parse(req.body);
    setMirror(db, url ? { url: url.replace(/\/+$/, ''), intervalMin } : null);
    return view();
  });
  app.get('/api/mirror/copies', async () => listCopies(dbPath));
  app.post<{ Params: { name: string } }>('/api/mirror/copies/:name/restore', async (req, reply) => {
    const file = path.join(copiesDir(dbPath), req.params.name);
    if (!isCopyName(req.params.name) || !fs.existsSync(file)) throw new NotFoundError('Copie introuvable');
    await restoreFrom(db, fs.readFileSync(file), () => backupNow(db, dbPath)); // filet de sécurité avant d'écraser
    return reply.status(204).send();
  });
}
