import { and, eq } from 'drizzle-orm';
import * as XLSX from 'xlsx';
import { resolveBracket, type Bracket, type MatchMethod } from '../../domain/brackets/index.js';
import { kataScore, resolveKata, type KataScores } from '../../domain/brackets/kata.js';
import { affectedBy, categoryProgress, checkResult, medalTable, validResults, type CategoryProgress, type ResultRecord } from '../../domain/results.js';
import type { AppDb } from '../db/client.js';
import { categories, clubs, fighters, kataScores, matchResults, registrations, tieBreaks } from '../db/schema.js';
import { listCategories } from './categories.js';
import { listZones } from './zones.js';
import { listWaves } from './waves.js';
import { passageNumbers, passagePlan } from './passages.js';
import { NotFoundError, RegistrationValidationError } from './registrations.js';
import { activeEntrantCount } from '../../domain/categories.js';

type CategoryRow = typeof categories.$inferSelect;

/** Catégorie à disputer : au moins 2 combattants présents, ou déjà lancée (un absent ensuite ne la fait pas disparaître). */
const playableCategory = (c: Awaited<ReturnType<typeof listCategories>>[number]) => !!c.bracket && activeEntrantCount(c) >= 2;
const METHOD_LABELS: Record<MatchMethod, string> = {
  points: 'Points',
  decision: 'Décision',
  ko: 'KO',
  abandon: 'Abandon',
  disqualification: 'Disqualification',
  forfeit: 'Forfait',
};

function categoryRow(db: AppDb, competitionId: string, categoryId: string): CategoryRow & { bracket: Bracket } {
  const row = db.select().from(categories).where(and(eq(categories.id, categoryId), eq(categories.competitionId, competitionId))).get();
  if (!row || !row.bracketJson) throw new NotFoundError('Catégorie introuvable');
  return { ...row, bracket: JSON.parse(row.bracketJson) as Bracket };
}

function loadRecords(db: AppDb, categoryId: string): ResultRecord[] {
  return db
    .select()
    .from(matchResults)
    .where(eq(matchResults.categoryId, categoryId))
    .all()
    .map((r) => ({ matchId: r.matchId, winner: r.winner, method: r.method, entrantA: r.entrantA, entrantB: r.entrantB, ...(r.score ? { score: r.score } : {}) }));
}

function loadKata(db: AppDb, categoryId: string): KataScores {
  const scores: KataScores = { round1: {}, final: {} };
  for (const r of db.select().from(kataScores).where(eq(kataScores.categoryId, categoryId)).all()) scores[r.round][r.registrationId] = JSON.parse(r.notesJson);
  return scores;
}

function loadTieBreaks(db: AppDb, categoryId: string): { pools: Record<number, string[]>; kata: string[]; kataFinal: string[] } {
  const pools: Record<number, string[]> = {};
  let kata: string[] = [];
  let kataFinal: string[] = [];
  for (const t of db.select().from(tieBreaks).where(eq(tieBreaks.categoryId, categoryId)).all()) {
    if (t.scope === 'kata') kata = JSON.parse(t.orderJson);
    else if (t.scope === 'kata:final') kataFinal = JSON.parse(t.orderJson);
    else if (t.scope.startsWith('pool:')) pools[Number(t.scope.slice(5))] = JSON.parse(t.orderJson);
  }
  return { pools, kata, kataFinal };
}

function kataTieBreaks(db: AppDb, categoryId: string): [string[], string[]] {
  const { kata, kataFinal } = loadTieBreaks(db, categoryId);
  return [kata, kataFinal];
}

export interface CategoryResults {
  records: ResultRecord[];
  ignored: ResultRecord[];
  progress: CategoryProgress;
  kataScores: KataScores;
  tieBreaks: { pools: Record<number, string[]>; kata: string[]; kataFinal: string[] };
}

export async function getResults(db: AppDb, competitionId: string, categoryId: string): Promise<CategoryResults> {
  const row = categoryRow(db, competitionId, categoryId);
  const records = loadRecords(db, categoryId);
  const kata = loadKata(db, categoryId);
  const tb = loadTieBreaks(db, categoryId);
  const progress = categoryProgress(row.bracket, records, kata, tb.pools, tb.kata, tb.kataFinal);
  const ignored = row.bracket.kind === 'combat' ? validResults(row.bracket, records, tb.pools).ignored : [];
  return { records, ignored, progress, kataScores: kata, tieBreaks: tb };
}

/** Statut automatique après une saisie : lancée, terminée, ou sans aucun résultat de nouveau prête (une provisoire le reste). */
async function refreshStatus(db: AppDb, competitionId: string, categoryId: string): Promise<void> {
  const { progress, records } = await getResults(db, competitionId, categoryId);
  const row = categoryRow(db, competitionId, categoryId);
  const status =
    progress.status === 'finished' ? 'finished' : progress.status === 'started' || records.length > 0 ? 'started' : row.status === 'provisional' ? 'provisional' : 'ready';
  // Une catégorie lancée garde sa zone : sa zone automatique devient un épinglage.
  const zoneId = (status === 'started' || status === 'finished') && !row.zoneId ? ((await passagePlan(db, competitionId)).categories[categoryId]?.zoneId ?? null) : row.zoneId;
  db.update(categories).set({ status, zoneId }).where(eq(categories.id, categoryId)).run();
}

/** Efface des départages devenus caducs (une poule ou un tour de kata dont un résultat a changé). */
function clearTieBreaks(db: AppDb, categoryId: string, scopes: string[]): void {
  for (const scope of scopes) db.delete(tieBreaks).where(and(eq(tieBreaks.categoryId, categoryId), eq(tieBreaks.scope, scope))).run();
}

export async function putResult(
  db: AppDb,
  competitionId: string,
  categoryId: string,
  matchId: string,
  data: { winner: 'a' | 'b'; method: MatchMethod; score?: string | null },
): Promise<{ affected: string[] }> {
  const row = categoryRow(db, competitionId, categoryId);
  if (row.bracket.kind !== 'combat') throw new RegistrationValidationError(['Les katas se notent, ils ne se saisissent pas comme des combats.']);
  const records = loadRecords(db, categoryId);
  const tb = loadTieBreaks(db, categoryId);
  const others = records.filter((r) => r.matchId !== matchId);
  const { results } = validResults(row.bracket, others, tb.pools);
  const match = resolveBracket(row.bracket, results, tb.pools).matches.find((m) => m.id === matchId);
  if (!match) throw new NotFoundError('Combat introuvable');
  const ruleset = (JSON.parse(row.keyJson) as { ruleset: 'jiyu' | 'shobu' | null }).ruleset;
  const error = checkResult(match, ruleset, data.method);
  if (error) throw new RegistrationValidationError([error]);
  const existing = records.find((r) => r.matchId === matchId);
  const affected = existing ? affectedBy(row.bracket, records, matchId, data.winner, tb.pools) : [];
  const values = { winner: data.winner, method: data.method, score: data.score ?? null, entrantA: match.entrantA!, entrantB: match.entrantB! };
  const sameOutcome = existing && existing.winner === values.winner && existing.entrantA === values.entrantA && existing.entrantB === values.entrantB;
  db.insert(matchResults)
    .values({ competitionId, categoryId, matchId, ...values })
    .onConflictDoUpdate({ target: [matchResults.categoryId, matchResults.matchId], set: values })
    .run();
  if (match.pool !== undefined && !sameOutcome) clearTieBreaks(db, categoryId, [`pool:${match.pool}`]);
  await refreshStatus(db, competitionId, categoryId);
  return { affected };
}

export async function deleteResult(db: AppDb, competitionId: string, categoryId: string, matchId: string): Promise<void> {
  const row = categoryRow(db, competitionId, categoryId);
  const removed = db.delete(matchResults).where(and(eq(matchResults.categoryId, categoryId), eq(matchResults.matchId, matchId))).run().changes;
  const pool = row.bracket.kind === 'combat' ? row.bracket.matches.find((m) => m.id === matchId)?.pool : undefined;
  if (removed > 0 && pool !== undefined) clearTieBreaks(db, categoryId, [`pool:${pool}`]);
  await refreshStatus(db, competitionId, categoryId);
}

export async function putKataNotes(db: AppDb, competitionId: string, categoryId: string, registrationId: string, round: 'round1' | 'final', notes: number[]): Promise<void> {
  const row = categoryRow(db, competitionId, categoryId);
  if (row.bracket.kind !== 'kata') throw new RegistrationValidationError(["Cette catégorie n'est pas un kata."]);
  if (!row.bracket.order.includes(registrationId)) throw new NotFoundError('Kataka introuvable dans cette catégorie');
  const values = { notesJson: JSON.stringify(notes) };
  const stored = db.select().from(kataScores).where(and(eq(kataScores.categoryId, categoryId), eq(kataScores.registrationId, registrationId), eq(kataScores.round, round))).get();
  const changed = (stored?.notesJson ?? '[]') !== values.notesJson;
  const before = changed && round === 'round1' ? resolveKata(row.bracket, loadKata(db, categoryId), ...kataTieBreaks(db, categoryId)).finalists : [];
  db.insert(kataScores)
    .values({ competitionId, categoryId, registrationId, round, ...values })
    .onConflictDoUpdate({ target: [kataScores.categoryId, kataScores.registrationId, kataScores.round], set: values })
    .run();
  if (changed && round === 'final') clearTieBreaks(db, categoryId, ['kata:final']);
  if (changed && round === 'round1') {
    // Le kataka dont la note change sort du départage du tour 1 (les autres ex-æquo restent départagés entre eux) ;
    // celui de la finale n'est effacé que si les finalistes changent.
    const kata = kataTieBreaks(db, categoryId)[0];
    if (kata.includes(registrationId)) {
      const order = kata.filter((id) => id !== registrationId);
      if (order.length === 0) clearTieBreaks(db, categoryId, ['kata']);
      else db.update(tieBreaks).set({ orderJson: JSON.stringify(order) }).where(and(eq(tieBreaks.categoryId, categoryId), eq(tieBreaks.scope, 'kata'))).run();
    }
    const after = resolveKata(row.bracket, loadKata(db, categoryId), ...kataTieBreaks(db, categoryId)).finalists;
    if ([...before].sort().join() !== [...after].sort().join()) clearTieBreaks(db, categoryId, ['kata:final']);
  }
  await refreshStatus(db, competitionId, categoryId);
}

export async function putTieBreak(db: AppDb, competitionId: string, categoryId: string, scope: string, order: string[]): Promise<void> {
  const row = categoryRow(db, competitionId, categoryId);
  const b = row.bracket;
  const allowed =
    scope === 'kata' || scope === 'kata:final'
      ? b.kind === 'kata'
        ? b.order
        : null
      : b.kind === 'combat' && scope.startsWith('pool:')
        ? (b.pools?.[Number(scope.slice(5))] ?? null)
        : null;
  if (!allowed) throw new RegistrationValidationError(['Départage impossible : portée inconnue pour cette catégorie.']);
  if (order.some((id) => !allowed.includes(id))) throw new RegistrationValidationError(['Départage impossible : combattant étranger à la catégorie ou à la poule.']);
  // Fusion : un nouveau départage ne défait pas les précédents (autres ex-æquo de la même portée).
  const stored = db.select().from(tieBreaks).where(and(eq(tieBreaks.categoryId, categoryId), eq(tieBreaks.scope, scope))).get();
  const previous = stored ? (JSON.parse(stored.orderJson) as string[]) : [];
  const values = { orderJson: JSON.stringify([...previous.filter((id) => !order.includes(id)), ...order]) };
  db.insert(tieBreaks)
    .values({ competitionId, categoryId, scope, ...values })
    .onConflictDoUpdate({ target: [tieBreaks.categoryId, tieBreaks.scope], set: values })
    .run();
  await refreshStatus(db, competitionId, categoryId);
}

function labels(db: AppDb, competitionId: string) {
  const fs = new Map(db.select().from(fighters).where(eq(fighters.competitionId, competitionId)).all().map((f) => [f.id, f]));
  const cs = new Map(db.select().from(clubs).where(eq(clubs.competitionId, competitionId)).all().map((c) => [c.id, c]));
  const map = new Map<string, { name: string; clubId: string | null; club: string }>();
  for (const r of db.select().from(registrations).where(eq(registrations.competitionId, competitionId)).all()) {
    const f = fs.get(r.fighterId)!;
    map.set(r.id, { name: `${f.lastName} ${f.firstName}`.trim(), clubId: f.clubId, club: (f.clubId && cs.get(f.clubId)?.name) || 'Sans club' });
  }
  return map;
}

/** Passage de la file d'une zone : un combat à appeler, ou un bloc de kata (`matchId` null). */
export interface QueueItem {
  number: number;
  categoryId: string;
  categoryLabel: string;
  matchId: string | null;
  a: string | null;
  b: string | null;
  katakas: number | null;
  noRest: boolean;
}

/**
 * Jour J, par zone (épinglée ou automatique) : ses catégories (dans l'ordre saisi) et sa file, c'est-à-dire les prochains
 * passages de la vague (toutes sans `waveId`) dans l'ordre des numéros — combats jouables sans résultat, blocs de kata non terminés.
 */
export async function schedule(db: AppDb, competitionId: string, waveId?: string) {
  if (waveId && !(await listWaves(db, competitionId)).some((w) => w.id === waveId)) throw new NotFoundError('Vague introuvable');
  const plan = await passagePlan(db, competitionId);
  const numbers = passageNumbers(plan);
  const cats = (await listCategories(db, competitionId)).filter(playableCategory);
  const rows = new Map(db.select().from(categories).where(eq(categories.competitionId, competitionId)).all().map((r) => [r.id, r]));
  const who = labels(db, competitionId);
  const name = (rid: string | null) => (rid ? (who.get(rid)?.name ?? '?') : null);
  const state = new Map<string, { matches: ReturnType<typeof resolveBracket>['matches']; finished: boolean }>();
  const describe = async (c: (typeof cats)[number]) => {
    const { progress } = await getResults(db, competitionId, c.id);
    let matches: ReturnType<typeof resolveBracket>['matches'] = [];
    if (c.bracket?.kind === 'combat') {
      const { results } = validResults(c.bracket, loadRecords(db, c.id), loadTieBreaks(db, c.id).pools);
      matches = resolveBracket(c.bracket, results, loadTieBreaks(db, c.id).pools).matches;
    }
    state.set(c.id, { matches, finished: progress.status === 'finished' });
    // Numéro de passage ; sans zone, numérotation propre à la catégorie.
    const local = new Map([...matches].filter((m) => !m.bye).sort((x, y) => x.order - y.order).map((m, i) => [m.id, i + 1]));
    const nextMatches = matches
      .filter((m) => !m.bye && m.playable && !m.result)
      .map((m) => ({ matchId: m.id, number: numbers.get(`${c.id}:${m.id}`) ?? local.get(m.id)!, a: name(m.entrantA)!, b: name(m.entrantB)! }));
    return { id: c.id, label: c.label, status: c.status, order: rows.get(c.id)?.sortOrder ?? 0, kata: c.bracket?.kind === 'kata', progress: { played: progress.played, total: progress.total }, nextMatches };
  };
  const byZone = new Map<string, Awaited<ReturnType<typeof describe>>[]>();
  const unassigned: Awaited<ReturnType<typeof describe>>[] = [];
  for (const c of cats) {
    const d = await describe(c);
    const zoneId = plan.categories[c.id]?.zoneId ?? null;
    if (zoneId) byZone.set(zoneId, [...(byZone.get(zoneId) ?? []), d]);
    else unassigned.push(d);
  }
  const labelOf = new Map(cats.map((c) => [c.id, c.label]));
  const queue = (zoneId: string) =>
    (plan.zones.find((z) => z.zoneId === zoneId)?.passages ?? [])
      .filter((p) => !waveId || p.waveId === waveId)
      .flatMap((p): QueueItem[] => {
        const st = state.get(p.categoryId);
        if (!st) return [];
        const base = { number: p.number, categoryId: p.categoryId, categoryLabel: labelOf.get(p.categoryId) ?? '', noRest: p.noRest };
        if (p.matchId === null) {
          const c = cats.find((x) => x.id === p.categoryId)!;
          return st.finished ? [] : [{ ...base, matchId: null, a: null, b: null, katakas: c.bracket?.entrants.length ?? 0 }];
        }
        const m = st.matches.find((x) => x.id === p.matchId);
        return m && m.playable && !m.result ? [{ ...base, matchId: m.id, a: name(m.entrantA), b: name(m.entrantB), katakas: null }] : [];
      })
      .slice(0, 6);
  // Dans l'ordre des zones de la compétition ; une zone sans catégorie n'apparaît pas.
  return {
    zones: (await listZones(db, competitionId))
      .filter((z) => byZone.has(z.id))
      .map((zone) => ({ zone, categories: byZone.get(zone.id)!.sort((a, b) => a.order - b.order), queue: queue(zone.id) })),
    unassigned,
    impossible: plan.impossible,
  };
}

export async function podiums(db: AppDb, competitionId: string) {
  const cats = (await listCategories(db, competitionId)).filter(playableCategory);
  const who = labels(db, competitionId);
  const list = [];
  for (const c of cats) {
    const { progress } = await getResults(db, competitionId, c.id);
    list.push({ id: c.id, label: c.label, podium: progress.podium, complete: progress.podium.complete && progress.played > 0, status: progress.status });
  }
  const medals = medalTable(
    list.filter((x) => x.complete),
    (id) => ({ id: who.get(id)?.clubId ?? null, name: who.get(id)?.club ?? 'Sans club' }),
  );
  const name = (id: string | null) => (id ? `${who.get(id)?.name ?? '?'} (${who.get(id)?.club ?? ''})` : '');
  return { categories: list, medals, name };
}

function book(sheets: { name: string; rows: (string | number)[][] }[], type: 'xlsx' | 'ods'): Buffer {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s.rows), s.name);
  return XLSX.write(wb, { type: 'buffer', bookType: type }) as Buffer;
}

export async function exportResults(db: AppDb, competitionId: string, type: 'xlsx' | 'ods'): Promise<Buffer> {
  const cats = await listCategories(db, competitionId);
  const numbers = passageNumbers(await passagePlan(db, competitionId));
  const who = labels(db, competitionId);
  const rows: (string | number)[][] = [['Catégorie', 'Combat', 'Combattant A', 'Club A', 'Combattant B', 'Club B', 'Vainqueur', 'Méthode', 'Score']];
  for (const c of cats) {
    if (c.bracket?.kind !== 'combat') continue;
    const tb = loadTieBreaks(db, c.id).pools;
    const { results } = validResults(c.bracket, loadRecords(db, c.id), tb);
    const numbered = resolveBracket(c.bracket, results, tb).matches.filter((m) => !m.bye).sort((a, b) => a.order - b.order);
    numbered.forEach((m, i) => {
      if (!m.entrantA || !m.entrantB) return;
      const unknown = { name: '?', clubId: null, club: '' };
      const a = who.get(m.entrantA) ?? unknown;
      const b = who.get(m.entrantB) ?? unknown;
      const winner = m.result ? (m.result.winner === 'a' ? a.name : b.name) : '';
      rows.push([c.label, numbers.get(`${c.id}:${m.id}`) ?? i + 1, a.name, a.club, b.name, b.club, winner, m.result ? METHOD_LABELS[m.result.method] : '', m.result?.score ?? '']);
    });
  }
  const kataRows: (string | number)[][] = [['Catégorie', 'Tour', 'Rang', 'Kataka', 'Club', 'Notes', 'Note retenue']];
  const decimal = (x: number) => x.toLocaleString('fr-FR', { maximumFractionDigits: 2 });
  for (const c of cats) {
    if (c.bracket?.kind !== 'kata') continue;
    const scores = loadKata(db, c.id);
    const tb = loadTieBreaks(db, c.id);
    const { round1Ranking, finalists, podium } = resolveKata(c.bracket, scores, tb.kata, tb.kataFinal);
    const line = (round: string, rank: number | string, rid: string, notes: number[]) => {
      const who1 = who.get(rid) ?? { name: '?', club: '' };
      const score = kataScore(notes);
      kataRows.push([c.label, round, rank, who1.name, who1.club, notes.map(decimal).join(' ; '), score === null ? '' : decimal(score)]);
    };
    round1Ranking.forEach((r, i) => line('Tour 1', r.score === null ? '' : i + 1, r.registrationId, scores.round1[r.registrationId] ?? []));
    for (const rid of finalists) line('Finale', podium.first === rid ? 1 : podium.second === rid ? 2 : '', rid, scores.final[rid] ?? []);
  }
  return book([{ name: 'Résultats', rows }, { name: 'Kata', rows: kataRows }], type);
}

export async function exportPodiums(db: AppDb, competitionId: string, type: 'xlsx' | 'ods'): Promise<Buffer> {
  const { categories: list, medals, name } = await podiums(db, competitionId);
  const podiumRows: (string | number)[][] = [['Catégorie', 'État', '1er', '2e', '3e', '3e']];
  for (const c of list) {
    const state = c.complete ? 'terminé' : c.status === 'not_started' ? 'à disputer' : 'en cours';
    podiumRows.push([c.label, state, name(c.podium.first), name(c.podium.second), name(c.podium.thirds[0] ?? null), name(c.podium.thirds[1] ?? null)]);
  }
  const clubRows: (string | number)[][] = [['Club', 'Or', 'Argent', 'Bronze', 'Total'], ...medals.map((m) => [m.club, m.gold, m.silver, m.bronze, m.gold + m.silver + m.bronze])];
  return book([{ name: 'Podiums', rows: podiumRows }, { name: 'Clubs', rows: clubRows }], type);
}
