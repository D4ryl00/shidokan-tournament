import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DISCIPLINES } from '../../domain/disciplines.js';
import type { DisciplineId } from '../../domain/types.js';
import type { AppDb } from '../db/client.js';
import { checkRev, tableListRev } from '../revisions.js';
import { getCompetition } from '../repositories/competitions.js';
import { listZones, replaceZones } from '../repositories/zones.js';

type P = { Params: { id: string } };
const disciplines = Object.keys(DISCIPLINES) as [DisciplineId, ...DisciplineId[]];
const list = z.array(z.object({ id: z.string().optional(), name: z.string(), disciplines: z.array(z.enum(disciplines)).nullable().optional() }).strict()).max(200);
/** Liste seule, ou avec les identifiants que l'écran connaissait (refus si les zones ont changé entre-temps). */
const zonesSchema = z.union([list, z.object({ zones: list, knownIds: z.array(z.string()) }).strict()]);

export async function zoneRoutes(app: FastifyInstance, { db }: { db: AppDb }) {
  app.addHook('preHandler', async (req, reply) => {
    const id = (req.params as { id?: string }).id;
    if (id && !(await getCompetition(db, id))) return reply.status(404).send({ error: 'Compétition introuvable' });
  });
  app.get<P>('/api/competitions/:id/zones', async (req, reply) => {
    reply.header('ETag', `"${tableListRev(db, 'zones', req.params.id)}"`);
    return listZones(db, req.params.id);
  });
  app.put<P>('/api/competitions/:id/zones', async (req, reply) => {
    const body = zonesSchema.parse(req.body);
    checkRev(req.headers['if-match'], tableListRev(db, 'zones', req.params.id));
    reply.header('Cache-Control', 'no-store');
    return Array.isArray(body) ? replaceZones(db, req.params.id, body) : replaceZones(db, req.params.id, body.zones, body.knownIds);
  });
}
