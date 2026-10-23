import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDb } from '../db/client.js';
import { checkRev, kataRev, resultRev, tieBreakRev } from '../revisions.js';
import { getCompetition } from '../repositories/competitions.js';
import { passagePlan } from '../repositories/passages.js';
import { deleteResult, exportPodiums, exportResults, getResults, podiums, putKataNotes, putResult, putTieBreak, schedule } from '../repositories/results.js';

type P = { Params: { id: string; cid: string } };
const MIME = { xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ods: 'application/vnd.oasis.opendocument.spreadsheet' };

export async function resultRoutes(app: FastifyInstance, { db }: { db: AppDb }) {
  app.addHook('preHandler', async (req, reply) => {
    const id = (req.params as { id?: string }).id;
    if (id && !(await getCompetition(db, id))) return reply.status(404).send({ error: 'Compétition introuvable' });
  });
  app.get<P>('/api/competitions/:id/categories/:cid/results', async (req) => getResults(db, req.params.id, req.params.cid));
  app.put<{ Params: { id: string; cid: string; matchId: string } }>('/api/competitions/:id/categories/:cid/results/:matchId', async (req) => {
    const data = z
      .object({ winner: z.enum(['a', 'b']), method: z.enum(['points', 'decision', 'ko', 'abandon', 'disqualification', 'forfeit']), score: z.string().trim().max(30).nullable().optional() })
      .strict()
      .parse(req.body);
    checkRev(req.headers['if-match'], resultRev(db, req.params.cid, req.params.matchId));
    return putResult(db, req.params.id, req.params.cid, req.params.matchId, data);
  });
  app.delete<{ Params: { id: string; cid: string; matchId: string } }>('/api/competitions/:id/categories/:cid/results/:matchId', async (req, reply) => {
    checkRev(req.headers['if-match'], resultRev(db, req.params.cid, req.params.matchId));
    await deleteResult(db, req.params.id, req.params.cid, req.params.matchId);
    return reply.status(204).send();
  });
  app.put<{ Params: { id: string; cid: string; rid: string; round: string } }>('/api/competitions/:id/categories/:cid/kata/:rid/:round', async (req, reply) => {
    const round = z.enum(['round1', 'final']).parse(req.params.round);
    const { notes } = z.object({ notes: z.array(z.number().min(0).max(10)).max(7) }).strict().parse(req.body);
    checkRev(req.headers['if-match'], kataRev(db, req.params.cid, req.params.rid, round));
    await putKataNotes(db, req.params.id, req.params.cid, req.params.rid, round, notes);
    return reply.status(204).send();
  });
  app.put<P>('/api/competitions/:id/categories/:cid/tie-break', async (req, reply) => {
    const { scope, order } = z.object({ scope: z.string().regex(/^(kata|kata:final|pool:\d+)$/), order: z.array(z.string()).min(2) }).strict().parse(req.body);
    checkRev(req.headers['if-match'], tieBreakRev(db, req.params.cid, scope));
    await putTieBreak(db, req.params.id, req.params.cid, scope, order);
    return reply.status(204).send();
  });
  app.get<{ Params: { id: string }; Querystring: { vague?: string } }>('/api/competitions/:id/schedule', async (req) => schedule(db, req.params.id, req.query.vague || undefined));
  app.get<{ Params: { id: string } }>('/api/competitions/:id/passages', async (req) => passagePlan(db, req.params.id));
  app.get<{ Params: { id: string } }>('/api/competitions/:id/podiums', async (req) => {
    const { categories, medals } = await podiums(db, req.params.id);
    return { categories, medals };
  });
  for (const type of ['xlsx', 'ods'] as const) {
    app.get<{ Params: { id: string } }>(`/api/competitions/:id/exports/results.${type}`, async (req, reply) =>
      reply.header('Content-Type', MIME[type]).header('Content-Disposition', `attachment; filename="resultats.${type}"`).send(await exportResults(db, req.params.id, type)),
    );
    app.get<{ Params: { id: string } }>(`/api/competitions/:id/exports/podiums.${type}`, async (req, reply) =>
      reply.header('Content-Type', MIME[type]).header('Content-Disposition', `attachment; filename="podiums.${type}"`).send(await exportPodiums(db, req.params.id, type)),
    );
  }
}
