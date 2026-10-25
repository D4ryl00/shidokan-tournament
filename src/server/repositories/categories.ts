import { and, eq } from 'drizzle-orm';
import {
  compatibleFormats,
  defaultFormat,
  generateBracket,
  type Bracket,
  type BracketFormat,
  type Entrant,
} from '../../domain/brackets/index.js';
import {
  categoryLabel,
  compareKeys,
  keyString,
  naturalKey,
  type Category,
  type CategoryKey,
  type CategoryStatus,
} from '../../domain/categories.js';
import type { CompetitionSettings } from '../../domain/settings.js';
import type { CategoryGrid } from '../../domain/types.js';
import { WAVE_NONE, waveOfCategory, type Wave } from '../../domain/waves.js';
import type { AppDb } from '../db/client.js';
import { rowRev } from '../revisions.js';
import { categories, fighters, registrations, tieBreaks, zones } from '../db/schema.js';
import { getCompetition, getGrid } from './competitions.js';
import { NotFoundError, RegistrationValidationError } from './registrations.js';
import { listWaves } from './waves.js';
import { launchedCategoryIds } from './launch-state.js';
import { plural } from '../../domain/plural.js';

export class CategoryLockedError extends Error {
  constructor(message = "Catégorie lancée : déverrouillez-la d'abord") {
    super(message);
  }
}

type Row = typeof categories.$inferSelect;
const LOCKED: CategoryStatus[] = ['started', 'finished'];
const newSeed = () => crypto.getRandomValues(new Uint32Array(1))[0]!;

interface Context {
  settings: CompetitionSettings;
  /** Tous les inscrits de chaque catégorie. */
  members: Map<string, string[]>;
  /** Inscrits non absents : ceux qui figurent dans le tableau. */
  active: Map<string, string[]>;
  entrants: Map<string, Entrant>;
  waves: Wave[];
  grid: CategoryGrid;
  /** Tranches des combattants d'origine (non recasés) de chaque catégorie. */
  waveBands: Map<string, string[]>;
  /** Catégories numérotées dans une vague lancée. */
  launched: Set<string>;
}

async function loadContext(db: AppDb, competitionId: string): Promise<Context> {
  const competition = await getCompetition(db, competitionId);
  if (!competition) throw new NotFoundError('Compétition introuvable');
  const regs = db.select().from(registrations).where(eq(registrations.competitionId, competitionId)).all();
  const fs = new Map(db.select().from(fighters).where(eq(fighters.competitionId, competitionId)).all().map((f) => [f.id, f]));
  const members = new Map<string, string[]>();
  const active = new Map<string, string[]>();
  const entrants = new Map<string, Entrant>();
  const waveBands = new Map<string, Set<string>>();
  for (const r of regs) {
    const f = fs.get(r.fighterId)!;
    entrants.set(r.id, { registrationId: r.id, clubId: f.clubId, label: `${f.lastName} ${f.firstName}`.trim() });
    if (!r.categoryId) continue;
    if (!r.placementLocked) waveBands.set(r.categoryId, (waveBands.get(r.categoryId) ?? new Set()).add(f.ageBandCode));
    members.set(r.categoryId, [...(members.get(r.categoryId) ?? []), r.id]);
    if (r.presence !== 'absent') active.set(r.categoryId, [...(active.get(r.categoryId) ?? []), r.id]);
  }
  return {
    settings: competition.settings, members, active, entrants, waves: await listWaves(db, competitionId), grid: await getGrid(db, competitionId),
    waveBands: new Map([...waveBands].map(([k, v]) => [k, [...v]])),
    launched: launchedCategoryIds(db, competitionId),
  };
}

function effectiveFormat(row: Row, key: CategoryKey, count: number, ctx: Context): BracketFormat {
  const forced = row.format as BracketFormat | null;
  if (forced && compatibleFormats(key.discipline, count).includes(forced)) return forced;
  return defaultFormat(key.discipline, count, ctx.settings);
}

function buildBracket(row: Row, ctx: Context): Bracket {
  const key = JSON.parse(row.keyJson) as CategoryKey;
  const ids = [...(ctx.active.get(row.id) ?? [])].sort();
  const format = effectiveFormat(row, key, ids.length, ctx);
  return generateBracket(
    format,
    ids.map((id) => ctx.entrants.get(id)!),
    {
      repechage: row.repechage ?? ctx.settings.repechage,
      thirdPlace: row.thirdPlace ?? ctx.settings.thirdPlaceMatch,
      kataBronzeCount: ctx.settings.kataBronzeCount,
    },
    row.seed,
  );
}

const bracketMembers = (b: Bracket | null) => (b ? b.entrants.map((e) => e.registrationId).sort().join(',') : '');

/** Le tableau stocké correspond-il encore à la composition et aux options ? (sinon régénération) */
function upToDate(row: Row, ctx: Context): boolean {
  if (!row.bracketJson) return false;
  const stored = JSON.parse(row.bracketJson) as Bracket;
  const fresh = buildBracket(row, ctx);
  if (bracketMembers(stored) !== bracketMembers(fresh)) return false;
  if (stored.kind !== fresh.kind) return false;
  if (stored.kind === 'combat' && fresh.kind === 'combat') {
    return stored.format === fresh.format && stored.seed === fresh.seed && JSON.stringify(stored.options) === JSON.stringify(fresh.options);
  }
  return stored.seed === fresh.seed && (stored as { bronzeCount: number }).bronzeCount === (fresh as { bronzeCount: number }).bronzeCount;
}

/**
 * Place chaque inscription non verrouillée dans sa catégorie naturelle (créée si besoin), supprime les catégories
 * vides non lancées et régénère les tableaux non lancés qui ne correspondent plus.
 */
export async function syncCategories(db: AppDb, competitionId: string, opts: { regenerate?: string } = {}): Promise<void> {
  const grid = await getGrid(db, competitionId);
  // Catégories d'une vague lancée : traitées comme lancées (tableau gardé) ; `regenerate` : sauf celle-ci (confirmation donnée).
  const frozen = launchedCategoryIds(db, competitionId);
  if (opts.regenerate) frozen.delete(opts.regenerate);
  const kept = (c: Row) => LOCKED.includes(c.status) || frozen.has(c.id);
  db.transaction((tx) => {
    const t = tx as unknown as AppDb;
    const regs = t.select().from(registrations).where(eq(registrations.competitionId, competitionId)).all();
    const fs = new Map(t.select().from(fighters).where(eq(fighters.competitionId, competitionId)).all().map((f) => [f.id, f]));
    const cats = t.select().from(categories).where(eq(categories.competitionId, competitionId)).all();
    // Routage déterministe : clé exacte avant alias, catégorie non lancée avant lancée (cas limite de doublons).
    const byKey = new Map<string, Row>();
    const rank = (c: Row, exact: boolean) => (exact ? 0 : 2) + (LOCKED.includes(c.status) ? 1 : 0);
    const ranked = new Map<string, number>();
    const offer = (key: string, c: Row, exact: boolean) => {
      const r = rank(c, exact);
      if (!ranked.has(key) || r < ranked.get(key)! || (r === ranked.get(key)! && c.id < byKey.get(key)!.id)) {
        byKey.set(key, c);
        ranked.set(key, r);
      }
    };
    for (const c of cats) {
      offer(c.keyString, c, true);
      for (const alias of JSON.parse(c.aliasKeys) as string[]) offer(alias, c, false);
    }
    const lockedIds = new Set(cats.filter(kept).map((c) => c.id));
    for (const r of regs) {
      if (r.placementLocked && r.categoryId && cats.some((c) => c.id === r.categoryId)) continue;
      // Une catégorie lancée garde ses inscrits, même si leur clé change (le tableau est figé).
      if (r.categoryId && lockedIds.has(r.categoryId)) continue;
      // « Ne combat pas » : dans aucune catégorie.
      if (r.withdrawnReason) {
        if (r.categoryId) t.update(registrations).set({ categoryId: null }).where(eq(registrations.id, r.id)).run();
        continue;
      }
      const key = naturalKey(r, fs.get(r.fighterId)!);
      const ks = keyString(key);
      let cat = byKey.get(ks);
      if (!cat) {
        const row = {
          id: crypto.randomUUID(),
          competitionId,
          keyString: ks,
          keyJson: JSON.stringify(key),
          label: categoryLabel(key, grid),
          status: 'provisional' as const,
          format: null,
          repechage: null,
          thirdPlace: null,
          seed: newSeed(),
          bracketJson: null,
          aliasKeys: '[]',
          stale: false,
          zoneId: null,
          waveOverride: null,
          sortOrder: 0,
          numbersUpdatedAt: null,
          version: null,
          updatedAt: null,
        };
        t.insert(categories).values(row).run();
        cat = row;
        byKey.set(ks, cat);
        cats.push(cat);
      }
      if (r.categoryId !== cat.id) t.update(registrations).set({ categoryId: cat.id }).where(eq(registrations.id, r.id)).run();
    }
  });

  const ctx = await loadContext(db, competitionId);
  db.transaction((tx) => {
    const t = tx as unknown as AppDb;
    for (const row of t.select().from(categories).where(eq(categories.competitionId, competitionId)).all()) {
      const count = ctx.members.get(row.id)?.length ?? 0;
      const key = JSON.parse(row.keyJson) as CategoryKey;
      const label = categoryLabel(key, grid);
      if (count === 0 && !kept(row)) {
        t.delete(categories).where(eq(categories.id, row.id)).run();
        continue;
      }
      if (kept(row)) {
        const stored = row.bracketJson ? (JSON.parse(row.bracketJson) as Bracket) : null;
        const stale = bracketMembers(stored) !== [...(ctx.active.get(row.id) ?? [])].sort().join(',');
        if (stale !== row.stale || label !== row.label) t.update(categories).set({ stale, label }).where(eq(categories.id, row.id)).run();
        continue;
      }
      if (!upToDate(row, ctx) || row.stale) {
        t.update(categories)
          .set({ bracketJson: JSON.stringify(buildBracket(row, ctx)), label, stale: false })
          .where(eq(categories.id, row.id))
          .run();
        // Nouveau tableau : les départages de l'ancien ne valent plus (mêmes ex-æquo par hasard compris).
        t.delete(tieBreaks).where(eq(tieBreaks.categoryId, row.id)).run();
      } else if (label !== row.label) {
        // Simple renommage : le tableau (et ses échanges manuels) est conservé.
        t.update(categories).set({ label }).where(eq(categories.id, row.id)).run();
      }
    }
  });
}

/** Noms des inscrits à jour (une correction de nom ne régénère pas le tableau). */
function withCurrentLabels(bracket: Bracket | null, ctx: Context): Bracket | null {
  if (!bracket) return null;
  return { ...bracket, entrants: bracket.entrants.map((e) => ({ ...e, label: ctx.entrants.get(e.registrationId)?.label ?? e.label })) } as Bracket;
}

function toCategory(row: Row, ctx: Context): Category {
  const key = JSON.parse(row.keyJson) as CategoryKey;
  const ids = ctx.members.get(row.id) ?? [];
  return {
    id: row.id,
    rev: rowRev(row.version),
    competitionId: row.competitionId,
    key,
    label: row.label,
    status: row.status,
    format: (row.format as BracketFormat | null) ?? null,
    repechage: row.repechage,
    thirdPlace: row.thirdPlace,
    seed: row.seed,
    bracket: withCurrentLabels(row.bracketJson ? (JSON.parse(row.bracketJson) as Bracket) : null, ctx),
    zoneId: row.zoneId,
    waveId: waveOfCategory({ key, waveOverride: row.waveOverride, waveBands: ctx.waveBands.get(row.id) ?? [] }, ctx.waves, ctx.grid),
    waveOverride: row.waveOverride,
    waveBands: ctx.waveBands.get(row.id) ?? [],
    order: row.sortOrder,
    registrationIds: [...ids].sort(),
    absentIds: ids.filter((id) => !(ctx.active.get(row.id) ?? []).includes(id)).sort(),
    aliasKeys: JSON.parse(row.aliasKeys) as string[],
    effectiveFormat: row.bracketJson ? ((JSON.parse(row.bracketJson) as Bracket).kind === 'kata' ? 'kata_two_rounds' : (JSON.parse(row.bracketJson) as { format: BracketFormat }).format) : effectiveFormat(row, key, (ctx.active.get(row.id) ?? []).length, ctx),
    stale: row.stale,
    numbersUpdatedAt: row.numbersUpdatedAt,
    launchLocked: ctx.launched.has(row.id),
  };
}

export async function listCategories(db: AppDb, competitionId: string): Promise<Category[]> {
  await syncCategories(db, competitionId);
  const grid = await getGrid(db, competitionId);
  const ctx = await loadContext(db, competitionId);
  return db
    .select()
    .from(categories)
    .where(eq(categories.competitionId, competitionId))
    .all()
    .map((r) => toCategory(r, ctx))
    .sort((a, b) => compareKeys(a.key, b.key, grid));
}

function getRow(db: AppDb, competitionId: string, categoryId: string): Row {
  const row = db.select().from(categories).where(and(eq(categories.id, categoryId), eq(categories.competitionId, competitionId))).get();
  if (!row) throw new NotFoundError('Catégorie introuvable');
  return row;
}

async function categoryById(db: AppDb, competitionId: string, categoryId: string): Promise<Category> {
  const found = (await listCategories(db, competitionId)).find((c) => c.id === categoryId);
  if (!found) throw new NotFoundError('Catégorie introuvable');
  return found;
}

export async function updateCategory(
  db: AppDb,
  competitionId: string,
  categoryId: string,
  patch: { format?: BracketFormat | null; repechage?: boolean | null; thirdPlace?: boolean | null; status?: CategoryStatus; zoneId?: string | null; waveOverride?: string | null; order?: number; unlock?: boolean },
): Promise<Category> {
  const row = getRow(db, competitionId, categoryId);
  if (launchedCategoryIds(db, competitionId).has(categoryId)) {
    const blocked = patch.zoneId !== undefined || patch.waveOverride !== undefined || patch.format !== undefined || patch.repechage !== undefined || patch.thirdPlace !== undefined;
    if (blocked) throw new CategoryLockedError('La session est lancée : rouvrez-la pour changer la zone, la session ou le tableau de cette catégorie.');
  }
  const locked = LOCKED.includes(row.status);
  const unlocking = locked && patch.status !== undefined && !LOCKED.includes(patch.status);
  if (unlocking && !patch.unlock) throw new CategoryLockedError();
  const changesBracket = patch.format !== undefined || patch.repechage !== undefined || patch.thirdPlace !== undefined;
  if (locked && !unlocking && changesBracket) throw new CategoryLockedError();
  if (patch.format) {
    const key = JSON.parse(row.keyJson) as CategoryKey;
    const ctx = await loadContext(db, competitionId);
    const count = ctx.active.get(row.id)?.length ?? 0;
    if (!compatibleFormats(key.discipline, count).includes(patch.format)) {
      throw new RegistrationValidationError([`Format incompatible avec ${plural(count, 'inscrit')}.`]);
    }
  }
  const set: Partial<Row> = {};
  if (patch.format !== undefined) set.format = patch.format;
  if (patch.repechage !== undefined) set.repechage = patch.repechage;
  if (patch.thirdPlace !== undefined) set.thirdPlace = patch.thirdPlace;
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.zoneId !== undefined) {
    if (patch.zoneId !== null && !db.select().from(zones).where(and(eq(zones.id, patch.zoneId), eq(zones.competitionId, competitionId))).get()) {
      throw new RegistrationValidationError(['Zone de combat inconnue pour cette compétition.']);
    }
    set.zoneId = patch.zoneId;
  }
  if (patch.waveOverride !== undefined) {
    if (patch.waveOverride !== null && patch.waveOverride !== WAVE_NONE && !(await listWaves(db, competitionId)).some((w) => w.id === patch.waveOverride)) {
      throw new RegistrationValidationError(['Session inconnue pour cette compétition.']);
    }
    set.waveOverride = patch.waveOverride;
  }
  if (patch.order !== undefined) set.sortOrder = patch.order;
  if (Object.keys(set).length) db.update(categories).set(set).where(eq(categories.id, categoryId)).run();
  return categoryById(db, competitionId, categoryId);
}

export async function redraw(db: AppDb, competitionId: string, categoryId: string): Promise<Category> {
  const row = getRow(db, competitionId, categoryId);
  if (LOCKED.includes(row.status) || launchedCategoryIds(db, competitionId).has(categoryId)) throw new CategoryLockedError();
  let seed = newSeed();
  while (seed === row.seed) seed = newSeed();
  db.update(categories).set({ seed }).where(eq(categories.id, categoryId)).run();
  return categoryById(db, competitionId, categoryId);
}

/** Échange deux inscrits dans le tableau (tirage manuel). */
export async function swapEntrants(db: AppDb, competitionId: string, categoryId: string, a: string, b: string): Promise<Category> {
  const row = getRow(db, competitionId, categoryId);
  if (LOCKED.includes(row.status) || launchedCategoryIds(db, competitionId).has(categoryId)) throw new CategoryLockedError();
  if (!row.bracketJson) throw new NotFoundError('Tableau introuvable');
  const swap = (id: string) => (id === a ? b : id === b ? a : id);
  const bracket = JSON.parse(row.bracketJson) as Bracket;
  const members = bracket.entrants.map((e) => e.registrationId);
  if (a === b || !members.includes(a) || !members.includes(b)) {
    throw new RegistrationValidationError(['Échange impossible : choisir deux combattants différents de ce tableau.']);
  }
  const swapEntrant = <T extends { registrationId: string }>(list: T[]) => {
    const ia = list.findIndex((e) => e.registrationId === a);
    const ib = list.findIndex((e) => e.registrationId === b);
    if (ia >= 0 && ib >= 0) [list[ia], list[ib]] = [list[ib]!, list[ia]!];
  };
  swapEntrant(bracket.entrants);
  if (bracket.kind === 'kata') bracket.order = bracket.order.map(swap);
  else {
    for (const m of bracket.matches) {
      for (const side of ['a', 'b'] as const) {
        const src = m[side];
        if (src.kind === 'entrant') m[side] = { kind: 'entrant', registrationId: swap(src.registrationId) };
      }
    }
    if (bracket.pools) bracket.pools = bracket.pools.map((p) => p.map(swap));
  }
  db.update(categories).set({ bracketJson: JSON.stringify(bracket) }).where(eq(categories.id, categoryId)).run();
  db.delete(tieBreaks).where(eq(tieBreaks.categoryId, categoryId)).run();
  return categoryById(db, competitionId, categoryId);
}
