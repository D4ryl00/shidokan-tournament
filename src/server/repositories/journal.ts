import type { JournalEntryView, JournalType } from '../../domain/journal/types.js';
import { normalizeName } from '../../domain/names.js';
import type { AppDb } from '../db/client.js';

export interface JournalQuery {
  before?: number;
  q?: string;
  types?: JournalType[];
  limit?: number;
}

export interface JournalPage {
  entries: JournalEntryView[];
  nextBefore: number | null;
  total: number;
}

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;

interface Row {
  id: string;
  seq: number;
  parent_id: string | null;
  type: string;
  action: string;
  via: string;
  at: string;
  client_at: string | null;
  actor_json: string;
  data_json: string;
  search_text: string;
}

const toView = (r: Row, children: JournalEntryView[] = [], open = false): JournalEntryView => ({
  id: r.id,
  seq: r.seq,
  type: r.type as JournalType,
  action: r.action as JournalEntryView['action'],
  at: r.at,
  clientAt: r.client_at,
  actor: JSON.parse(r.actor_json),
  via: r.via as JournalEntryView['via'],
  data: JSON.parse(r.data_json),
  children,
  open,
});

const likeWord = (w: string) => `%${w.replace(/[\\%_]/g, '\\$&')}%`;

/** Fil du journal (entrées sans parent, les plus récentes d'abord), avec leurs lignes de détail. */
export function listJournal(db: AppDb, competitionId: string, query: JournalQuery): JournalPage {
  const sqlite = db.$client;
  const limit = Math.min(Math.max(Math.trunc(query.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT);
  const words = normalizeName(query.q ?? '').split(' ').filter(Boolean);
  const where = ['p.competition_id = ?', 'p.parent_id is null'];
  const args: (string | number)[] = [competitionId];
  if (query.before !== undefined) {
    where.push('p.seq < ?');
    args.push(query.before);
  }
  if (query.types?.length) {
    where.push(`p.type in (${query.types.map(() => '?').join(',')})`);
    args.push(...query.types);
  }
  for (const w of words) {
    where.push(`(p.search_text like ? escape '\\' or exists (select 1 from journal_entries c where c.parent_id = p.id and c.search_text like ? escape '\\'))`);
    args.push(likeWord(w), likeWord(w));
  }
  const parents = sqlite.prepare(`select p.* from journal_entries p where ${where.join(' and ')} order by p.seq desc limit ?`).all(...args, limit) as Row[];

  const children = new Map<string, Row[]>();
  if (parents.length) {
    const rows = sqlite
      .prepare(`select * from journal_entries where competition_id = ? and parent_id in (${parents.map(() => '?').join(',')}) order by seq asc`)
      .all(competitionId, ...parents.map((p) => p.id)) as Row[];
    for (const r of rows) children.set(r.parent_id!, [...(children.get(r.parent_id!) ?? []), r]);
  }
  const entries = parents.map((p) => {
    const kids = children.get(p.id) ?? [];
    const open = words.length > 0 && kids.some((k) => words.some((w) => k.search_text.includes(w)));
    return toView(p, kids.map((k) => toView(k)), open);
  });
  const total = (sqlite.prepare('select count(*) n from journal_entries where competition_id = ? and parent_id is null').get(competitionId) as { n: number }).n;
  return { entries, nextBefore: entries.length === limit ? entries[entries.length - 1]!.seq : null, total };
}
