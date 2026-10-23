import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDb } from '../db/client.js';
import { competitionChanged } from '../events.js';
import { getManagement } from '../sync/ownership.js';
import type { JournalReport } from '../zone/replay.js';
import { journalFile, markSent, whileSending } from '../zone/autonomous.js';
import { copyFromMain, fromMain, getZoneLink, resetZoneLinkStatus, restartZoneFollow, setZoneLink, ZoneLinkError, zoneLinkStatus } from '../zone/link.js';

const mainUrlSchema = z
  .string()
  .trim()
  .max(300)
  .transform((u) => u.replace(/\/+$/, ''))
  .refine((u) => {
    try {
      return ['http:', 'https:'].includes(new URL(u).protocol);
    } catch {
      return false;
    }
  }, 'L’adresse du PC principal doit commencer par http:// ou https://');

/** Portable de zone (rôle local) : relier au PC principal, et l'état de sa copie. */
export async function zoneLinkRoutes(app: FastifyInstance, { db, dbPath }: { db: AppDb; dbPath: string }) {
  const view = () => {
    const link = getZoneLink(db);
    const zoneName = link
      ? ((db.$client.prepare('select name from zones where id = ? and competition_id = ?').get(link.zoneId, link.competitionId) as { name: string } | undefined)?.name ?? null)
      : null;
    const pending = link
      ? (db.$client.prepare('select count(*) as n from zone_journal where competition_id = ? and sent_at is null').get(link.competitionId) as { n: number }).n
      : 0;
    return { link, zoneName, status: zoneLinkStatus(dbPath), pending };
  };

  app.get('/api/zone-link', async () => view());

  app.put('/api/zone-link', async (req) => {
    const value = z
      .object({ mainUrl: mainUrlSchema, competitionId: z.string().min(1).max(100), zoneId: z.string().min(1).max(100) })
      .strict()
      .nullable()
      .parse(req.body ?? null);
    const current = getZoneLink(db);
    if (current?.autonomous && (!value || value.competitionId !== current.competitionId || value.zoneId !== current.zoneId)) {
      throw new ZoneLinkError(409, 'Zone autonome en cours : renvoyez d’abord le journal (« Repasser en ligne ») ou arrêtez la zone autonome.');
    }
    setZoneLink(
      db,
      value && {
        ...value,
        // L'identité du PC principal est réapprise à la prochaine copie si l'adresse change.
        mainInstanceId: current?.mainUrl === value.mainUrl ? current.mainInstanceId : undefined,
        autonomous: current?.autonomous ?? null,
      },
    );
    resetZoneLinkStatus(dbPath);
    restartZoneFollow(dbPath);
    return view();
  });

  /** Réseau coupé : la copie devient modifiable ici pour les saisies de la zone seulement, notées dans le journal. */
  app.post('/api/zone-link/autonomous', async (_req, reply) => {
    const link = getZoneLink(db);
    if (!link || !getManagement(db, link.competitionId).copyOfMain) throw new ZoneLinkError(409, 'Seule une copie du PC principal peut passer en zone autonome.');
    if (!link.autonomous) setZoneLink(db, { ...link, autonomous: { since: new Date().toISOString(), finals: false } });
    competitionChanged(link.competitionId);
    return reply.status(204).send();
  });

  const autonomousOnly = () => {
    const link = getZoneLink(db);
    if (!link?.autonomous) throw new ZoneLinkError(409, 'Ce PC n’est pas en zone autonome.');
    return link;
  };
  const stopAutonomy = () => {
    const link = getZoneLink(db);
    if (link) setZoneLink(db, { ...link, autonomous: null });
    if (link) competitionChanged(link.competitionId);
  };

  /** « Jouer ici les finales de mes catégories » : la zone autonome s'étend aux finales des catégories de sa zone. */
  app.post('/api/zone-link/finals', async (_req, reply) => {
    const link = autonomousOnly();
    setZoneLink(db, { ...link, autonomous: { ...link.autonomous!, finals: true } });
    competitionChanged(link.competitionId);
    return reply.status(204).send();
  });

  /** Réseau revenu : le journal part au PC principal ; la zone autonome s'arrête seulement s'il l'a reçu. */
  app.post('/api/zone-link/online', async () => {
    const link = autonomousOnly();
    return whileSending(link.competitionId, async () => {
      const journal = journalFile(db, link);
      const report = await fromMain<JournalReport>(link.mainUrl, `/api/competitions/${encodeURIComponent(link.competitionId)}/zone-journal`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(journal),
      });
      markSent(db, journal.entries.map((e) => e.id));
      stopAutonomy();
      await copyFromMain(db, dbPath);
      return { report, zoneName: journal.zoneName, mainUrl: link.mainUrl };
    });
  });

  /** Réseau absent : le journal en fichier (clé USB), sans rien changer ici. */
  app.get('/api/zone-link/journal.json', async (_req, reply) => {
    const link = autonomousOnly();
    const journal = journalFile(db, link);
    const p = (n: number) => String(n).padStart(2, '0');
    const d = new Date();
    const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
    const zone = journal.zoneName.normalize('NFD').replace(/[^\w-]+/g, '-').replace(/-+/g, '-').slice(0, 40);
    return reply.header('Content-Disposition', `attachment; filename="journal-${zone}-${stamp}.json"`).send(journal);
  });

  /** Après l'export du journal : la zone autonome s'arrête (ce qui serait saisi ensuite ne serait pas dans le fichier). */
  app.post('/api/zone-link/stop', async (req, reply) => {
    const { exported } = z.object({ exported: z.literal(true).optional() }).strict().parse(req.body ?? {});
    const link = autonomousOnly();
    if (!exported) throw new ZoneLinkError(400, 'Exportez d’abord le journal (fichier).');
    markSent(db, journalFile(db, link).entries.map((e) => e.id));
    stopAutonomy();
    // La copie reprend dès que le PC principal répond.
    void copyFromMain(db, dbPath).catch((e) => app.log.error(e));
    return reply.status(204).send();
  });

  app.post('/api/zone-link/probe', async (req) => {
    const { mainUrl } = z.object({ mainUrl: mainUrlSchema }).strict().parse(req.body);
    const list = await fromMain<{ id: string; name: string }[]>(mainUrl, '/api/competitions');
    const competitions = [];
    for (const c of list) {
      const zones = await fromMain<{ id: string; name: string }[]>(mainUrl, `/api/competitions/${encodeURIComponent(c.id)}/zones`);
      competitions.push({ id: c.id, name: c.name, zones: zones.map((zone) => ({ id: zone.id, name: zone.name })) });
    }
    return { competitions };
  });
}
