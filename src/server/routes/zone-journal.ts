import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDb } from '../db/client.js';
import { NotFoundError } from '../repositories/registrations.js';
import type { ZoneJournalFile } from '../zone/entry.js';
import { listCards } from '../zone/cards.js';
import { decideCard, receiveJournal } from '../zone/replay.js';

class JournalError extends Error {
  readonly statusCode = 400;
}

const id = z.string().min(1).max(100);
const entrySchema = z
  .object({
    id: z.string().uuid(),
    seq: z.number().int().positive(),
    kind: z.enum(['result', 'delete', 'kata', 'tie-break']),
    categoryId: id,
    matchId: id.optional(),
    registrationId: id.optional(),
    round: z.enum(['round1', 'final']).optional(),
    scope: z.string().regex(/^(kata|kata:final|pool:\d+)$/).optional(),
    data: z.union([
      z.object({ winner: z.enum(['a', 'b']), method: z.enum(['points', 'decision', 'ko', 'abandon', 'disqualification', 'forfeit']), score: z.string().max(30).nullable() }).strict(),
      z.object({ notes: z.array(z.number().min(0).max(10)).max(7) }).strict(),
      z.object({ order: z.array(id).min(2) }).strict(),
      z.null(),
    ]),
    entrants: z.tuple([id, id]).nullable(),
    baseRev: z.string().min(1).max(40),
    categoryVersion: z.number().int().nullable(),
    zoneId: id,
    at: z.string().max(40),
  })
  .strict()
  // Chaque type porte sa cible et ses données.
  .refine((e) =>
    e.kind === 'result' ? !!e.matchId && !!e.data && 'winner' in e.data
    : e.kind === 'delete' ? !!e.matchId && e.data === null
    : e.kind === 'kata' ? !!e.registrationId && !!e.round && !!e.data && 'notes' in e.data
    : !!e.scope && !!e.data && 'order' in e.data, 'Entrée de journal incohérente');
const journalSchema = z
  .object({
    format: z.literal('shidokan-zone-journal'),
    formatVersion: z.literal(1),
    competitionId: id,
    zoneId: id,
    zoneName: z.string().min(1).max(100),
    from: z.object({ instanceId: id, instanceName: z.string().max(100) }).strict(),
    entries: z.array(entrySchema).max(10_000),
  })
  .strict();

/** Contrôles d'un journal reçu (réseau ou fichier) pour cette compétition ; une entrée mal formée refuse tout le journal. */
export function parseJournal(competitionId: string, raw: unknown): ZoneJournalFile {
  const j = raw as { format?: unknown; competitionId?: unknown } | null;
  if (!j || j.format !== 'shidokan-zone-journal') throw new JournalError('Ce fichier n’est pas un journal de zone.');
  if (j.competitionId !== competitionId) throw new JournalError('Ce journal est celui d’une autre compétition.');
  return journalSchema.parse(raw) as ZoneJournalFile;
}

/** PC principal (rôle local) : recevoir le journal d'une zone autonome, par le réseau ou par fichier. */
export async function zoneJournalRoutes(app: FastifyInstance, { db }: { db: AppDb }) {
  app.post<{ Params: { id: string } }>('/api/competitions/:id/zone-journal', async (req) => {
    if (!db.$client.prepare('select 1 from competitions where id = ?').get(req.params.id)) throw new NotFoundError('Compétition introuvable');
    return receiveJournal(db, parseJournal(req.params.id, req.body));
  });
  app.get<{ Params: { id: string } }>('/api/competitions/:id/zone-cards', async (req) => listCards(db, req.params.id));
  app.post<{ Params: { id: string; entryId: string } }>('/api/competitions/:id/zone-cards/:entryId', async (req, reply) => {
    const { keep } = z.object({ keep: z.enum(['zone', 'pc']) }).strict().parse(req.body);
    await decideCard(db, req.params.id, req.params.entryId, keep);
    return reply.status(204).send();
  });
}
