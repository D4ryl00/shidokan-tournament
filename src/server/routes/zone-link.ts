import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDb } from '../db/client.js';
import { fromMain, getZoneLink, resetZoneLinkStatus, restartZoneFollow, setZoneLink, ZoneLinkError, zoneLinkStatus } from '../zone/link.js';

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
