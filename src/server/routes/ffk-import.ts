import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { FFK_FIELDS } from '../../domain/ffk-import.js';
import { planFingerprint, searchableFighters } from '../../domain/ffk-plan/plan.js';
import type { AppDb } from '../db/client.js';
import { getCompetition } from '../repositories/competitions.js';
import { analyzeUpload, applyFfkCards, buildFfkPlan, deleteUpload, loadUpload, saveUpload } from '../repositories/ffk-import.js';
import { UnreadableFileError } from '../spreadsheet/read.js';
import { clubFormLineSchema } from './registrations.js';

const mappingSchema = z.object(Object.fromEntries(FFK_FIELDS.map((f) => [f, z.number().int().min(0).nullable()])) as Record<(typeof FFK_FIELDS)[number], z.ZodNullable<z.ZodNumber>>);
const bodySchema = z.object({
  sheets: z.array(
    z.object({ name: z.string(), headerRow: z.number().int().min(0), headers: z.array(z.string()).optional(), mapping: mappingSchema, include: z.boolean() }),
  ),
  choices: z
    .object({
      acceptedWeightClasses: z.array(z.string()).optional(),
      clubLinks: z.record(z.string(), z.string()).optional(),
      cards: z
        .record(
          z.string(),
          z.discriminatedUnion('kind', [
            z.object({ kind: z.literal('none') }),
            z.object({ kind: z.literal('skip') }),
            z.object({
              kind: z.literal('validated'),
              fighterId: z.string().min(1),
              value: z.object({ line: clubFormLineSchema, clubId: z.string().nullable(), publicNameHidden: z.boolean() }),
            }),
          ]),
        )
        .optional(),
      orphans: z.record(z.string(), z.enum(['keep', 'delete'])).optional(),
    })
    .optional(),
});
/** Import : l'empreinte de l'aperçu affiché est obligatoire ; l'import est refusé (409) si le plan a changé entre-temps. */
const commitSchema = bodySchema.extend({ fingerprint: z.string().min(1) });

type P = { Params: { id: string; uploadId: string } };

export async function ffkImportRoutes(app: FastifyInstance, { db }: { db: AppDb }) {
  app.addHook('preHandler', async (req, reply) => {
    const id = (req.params as { id?: string }).id;
    if (id && !(await getCompetition(db, id))) return reply.status(404).send({ error: 'Compétition introuvable' });
  });

  app.post<{ Params: { id: string } }>('/api/competitions/:id/ffk-imports', async (req, reply) => {
    if (!Buffer.isBuffer(req.body)) throw new UnreadableFileError('Aucun fichier reçu.');
    let sheets;
    try {
      sheets = await analyzeUpload(db, req.body);
    } catch (e) {
      if (e instanceof UnreadableFileError) return reply.status(400).send({ error: 'Fichier illisible', issues: [e.message] });
      throw e;
    }
    const fileName = decodeURIComponent(String(req.headers['x-file-name'] ?? 'export'));
    const uploadId = await saveUpload(db, req.params.id, fileName, req.body);
    return { uploadId, sheets };
  });

  app.post<P>('/api/competitions/:id/ffk-imports/:uploadId/preview', async (req) => {
    const body = bodySchema.parse(req.body);
    const { plan, grid, existing } = await buildFfkPlan(db, req.params.id, req.params.uploadId, body.sheets, body.choices);
    // `fighters` : tous les combattants de la compétition, pour la recherche « Pas dans la liste ? » de la page.
    return { ...plan, fingerprint: planFingerprint(plan), fighters: searchableFighters(existing, grid) };
  });

  app.post<P>('/api/competitions/:id/ffk-imports/:uploadId/commit', async (req, reply) => {
    const body = commitSchema.parse(req.body);
    const { plan } = await buildFfkPlan(db, req.params.id, req.params.uploadId, body.sheets, body.choices);
    if (body.fingerprint !== planFingerprint(plan)) {
      return reply.status(409).send({ error: 'Les inscriptions ont changé depuis l’aperçu : relancez l’aperçu avant d’importer.' });
    }
    const included = body.sheets.filter((s) => s.include);
    // En-têtes relus depuis le fichier si le client ne les renvoie pas.
    const data = await loadUpload(db, req.params.id, req.params.uploadId);
    const analyzed = included.some((s) => !s.headers) ? await analyzeUpload(db, data) : [];
    const mappings = included.map((s) => ({ headers: s.headers ?? analyzed.find((a) => a.name === s.name)?.headers ?? [], mapping: s.mapping }));
    const result = await applyFfkCards(db, req.params.id, plan, mappings);
    await deleteUpload(db, req.params.uploadId);
    return result;
  });
}
