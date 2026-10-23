import type { AppDb } from '../db/client.js';
import { passageNumbers, passagePlan } from '../repositories/passages.js';
import { labels, matchEntrants } from '../repositories/results.js';
import type { ZoneEntry } from './entry.js';

export interface ZoneCard {
  id: string;
  zoneName: string;
  at: string;
  categoryId: string;
  categoryLabel: string;
  kind: ZoneEntry['kind'];
  target: string;
  /** Ce qu'a saisi la zone, et ce qu'il y a sur le PC principal (textes lisibles). */
  zone: string;
  pc: string;
  status: 'conflict' | 'waiting';
  reason: string | null;
  /** « Garder celui de la zone » possible : les combattants du combat n'ont pas changé. */
  canKeepZone: boolean;
}

const BY: Record<string, string> = {
  points: 'aux points', decision: 'par décision', ko: 'par KO', abandon: 'par abandon', disqualification: 'par disqualification', forfeit: 'par forfait',
};
const notesText = (notes: number[]) => `notes ${notes.map((n) => n.toLocaleString('fr-FR')).join(' · ')}`;

/** Cartes « À trancher » : entrées de zone en conflit ou en attente, avec l'état actuel du PC principal. */
export async function listCards(db: AppDb, competitionId: string): Promise<ZoneCard[]> {
  const rows = db.$client
    .prepare("select id, zone_name as zoneName, status, reason, entry_json as e from zone_entries where competition_id = ? and status in ('conflict', 'waiting') order by received_at, seq")
    .all(competitionId) as { id: string; zoneName: string; status: 'conflict' | 'waiting'; reason: string | null; e: string }[];
  if (rows.length === 0) return [];
  const who = labels(db, competitionId);
  const name = (rid: string | null | undefined) => (rid ? (who.get(rid)?.name ?? '?') : '?');
  const numbers = passageNumbers(await passagePlan(db, competitionId));
  const label = (cid: string) => (db.$client.prepare('select label from categories where id = ?').get(cid) as { label: string } | undefined)?.label ?? 'Catégorie supprimée';
  const q = db.$client;
  const cards: ZoneCard[] = [];
  for (const r of rows) {
    const e = JSON.parse(r.e) as ZoneEntry;
    let canKeepZone = true;
    let target: string;
    let zone: string;
    let pc: string;
    if (e.kind === 'result' || e.kind === 'delete') {
      const number = numbers.get(`${e.categoryId}:${e.matchId}`);
      target = `Combat ${number ?? e.matchId} : ${name(e.entrants?.[0])} contre ${name(e.entrants?.[1])}`;
      const d = e.data as { winner: 'a' | 'b'; method: string; score: string | null } | null;
      zone = d ? `${name(e.entrants?.[d.winner === 'a' ? 0 : 1])} gagne ${BY[d.method] ?? d.method}${d.score ? ` (${d.score})` : ''}` : 'résultat effacé';
      const cur = q.prepare('select winner, method, score, entrant_a as a, entrant_b as b from match_results where category_id = ? and match_id = ?').get(e.categoryId, e.matchId) as
        | { winner: 'a' | 'b'; method: string; score: string | null; a: string; b: string }
        | undefined;
      pc = cur ? `${name(cur.winner === 'a' ? cur.a : cur.b)} gagne ${BY[cur.method] ?? cur.method}${cur.score ? ` (${cur.score})` : ''}` : 'aucun résultat';
      const now = await matchEntrants(db, competitionId, e.categoryId, e.matchId!).catch(() => null);
      canKeepZone = JSON.stringify(now) === JSON.stringify(e.entrants);
    } else if (e.kind === 'kata') {
      target = `Kata de ${name(e.registrationId)} (${e.round === 'final' ? 'finale' : 'tour 1'})`;
      zone = notesText((e.data as { notes: number[] }).notes);
      const cur = q.prepare('select notes_json as n from kata_scores where category_id = ? and registration_id = ? and round = ?').get(e.categoryId, e.registrationId, e.round) as { n: string } | undefined;
      pc = cur ? notesText(JSON.parse(cur.n) as number[]) : 'aucune note';
    } else {
      target = `Départage (${e.scope === 'kata' ? 'kata, tour 1' : e.scope === 'kata:final' ? 'kata, finale' : `poule ${Number(e.scope!.slice(5)) + 1}`})`;
      zone = (e.data as { order: string[] }).order.map(name).join(' > ');
      const cur = q.prepare('select order_json as o from tie_breaks where category_id = ? and scope = ?').get(e.categoryId, e.scope) as { o: string } | undefined;
      pc = cur ? (JSON.parse(cur.o) as string[]).map(name).join(' > ') : 'aucun départage';
    }
    cards.push({ id: r.id, zoneName: r.zoneName, at: e.at, categoryId: e.categoryId, categoryLabel: label(e.categoryId), kind: e.kind, target, zone, pc, status: r.status, reason: r.reason, canKeepZone });
  }
  return cards;
}
