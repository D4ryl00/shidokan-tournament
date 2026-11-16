import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { findHeaderRow, guessColumnMapping, headerSignature, parseFfkRows, type ColumnMapping, type FfkRow } from '../../domain/ffk-import.js';
import type { ExistingFighter } from '../../domain/ffk-plan/cards.js';
import type { ExistingClub } from '../../domain/ffk-plan/clubs.js';
import { planFfkCards, type ExistingData, type FfkCardsPlan, type FfkChoices } from '../../domain/ffk-plan/plan.js';
import type { AppDb } from '../db/client.js';
import { clubAliases, clubDirectory, clubs, fighters, importMappings, registrations, uploads } from '../db/schema.js';
import { readWorkbook } from '../spreadsheet/read.js';
import { closedSet } from './closed-categories.js';
import { fighterLine } from './club-entry.js';
import { getGrid } from './competitions.js';
import { NotFoundError } from './registrations.js';

export interface SheetSetup {
  name: string;
  headerRow: number;
  headers: string[];
  mapping: ColumnMapping;
  include: boolean;
}

const KEEP_UPLOADS = 5;
const UPLOAD_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export async function saveUpload(db: AppDb, competitionId: string, fileName: string, data: Buffer): Promise<string> {
  const id = crypto.randomUUID();
  db.insert(uploads).values({ id, competitionId, fileName, data }).run();
  // Purge : au-delà des derniers fichiers envoyés (ordre d'insertion), ceux de plus d'un jour ; un aperçu en cours n'est jamais perdu.
  const all = db
    .select({ id: uploads.id, createdAt: uploads.createdAt })
    .from(uploads)
    .where(eq(uploads.competitionId, competitionId))
    .orderBy(desc(sql`rowid`))
    .all();
  const dayAgo = new Date(Date.now() - UPLOAD_MAX_AGE_MS).toISOString();
  const old = all.slice(KEEP_UPLOADS).filter((u) => u.createdAt < dayAgo).map((u) => u.id);
  if (old.length) db.delete(uploads).where(inArray(uploads.id, old)).run();
  return id;
}

export async function deleteUpload(db: AppDb, uploadId: string): Promise<void> {
  db.delete(uploads).where(eq(uploads.id, uploadId)).run();
}

export async function loadUpload(db: AppDb, competitionId: string, uploadId: string): Promise<Buffer> {
  const row = db.select().from(uploads).where(and(eq(uploads.id, uploadId), eq(uploads.competitionId, competitionId))).get();
  if (!row) throw new NotFoundError('Fichier introuvable : renvoyez-le.');
  return Buffer.from(row.data);
}

export async function rememberedMapping(db: AppDb, signature: string): Promise<ColumnMapping | null> {
  const row = db.select().from(importMappings).where(eq(importMappings.signature, signature)).get();
  return row ? (JSON.parse(row.mappingJson) as ColumnMapping) : null;
}

/** Onglets du fichier, avec leur en-tête et la correspondance mémorisée (sinon devinée). */
export async function analyzeUpload(db: AppDb, data: Buffer): Promise<SheetSetup[]> {
  const { sheets } = readWorkbook(data);
  const out: SheetSetup[] = [];
  for (const sheet of sheets) {
    const headerRow = findHeaderRow(sheet.cells);
    const headers = headerRow === null ? [] : (sheet.cells[headerRow] ?? []).map((h) => (h === null ? '' : String(h)));
    const guessed = guessColumnMapping(headers);
    const mapping = (await rememberedMapping(db, headerSignature(headers))) ?? guessed;
    const recognized = Object.values(guessed).filter((v) => v !== null).length;
    out.push({ name: sheet.name, headerRow: headerRow ?? 0, headers, mapping, include: headerRow !== null && recognized >= 3 });
  }
  return out;
}

/**
 * Clubs de la compétition avec leur N° d'affiliation : celui du club, sinon celui de sa fiche d'annuaire.
 * `''` = effacé par le club (choix explicite) : traité comme « aucun numéro », sans repli sur l'annuaire.
 */
function loadExistingClubs(db: AppDb, competitionId: string): ExistingClub[] {
  return db
    .select({ id: clubs.id, name: clubs.name, ffkEntity: clubs.ffkEntity, own: clubs.affiliationNumber, directory: clubDirectory.affiliationNumber })
    .from(clubs)
    .leftJoin(clubDirectory, eq(clubDirectory.id, clubs.directoryClubId))
    .where(eq(clubs.competitionId, competitionId))
    .orderBy(clubs.nameKey)
    .all()
    .map((c) => ({ id: c.id, name: c.name, ffkEntity: c.ffkEntity, affiliationNumber: (c.own ?? c.directory) || null }));
}

export async function loadExisting(db: AppDb, competitionId: string): Promise<ExistingData> {
  const ffkFighters = new Set(
    db.select({ fighterId: registrations.fighterId }).from(registrations)
      .where(and(eq(registrations.competitionId, competitionId), eq(registrations.source, 'ffk'))).all().map((r) => r.fighterId),
  );
  return {
    clubs: loadExistingClubs(db, competitionId),
    fighters: db
      .select()
      .from(fighters)
      .where(eq(fighters.competitionId, competitionId))
      .orderBy(fighters.nameKey)
      .all()
      .map((f): ExistingFighter => {
        // La ligne vue par l'organisateur (formulaire combattant), avec sa version et ses verrous.
        const l = fighterLine(db, competitionId, f.id);
        return {
          fighterId: f.id, clubId: f.clubId, licence: f.licence, line: l.line, publicNameHidden: l.publicNameHidden, version: l.version,
          editable: l.editable, partlyEditable: l.partlyEditable, startedDisciplines: l.startedDisciplines, fromFfk: ffkFighters.has(f.id),
        };
      }),
    aliases: Object.fromEntries(db.select().from(clubAliases).all().map((a) => [a.nameKey, a.clubEntity])),
  };
}

/** Lit les onglets retenus et calcule le plan (aucune écriture). */
export async function buildFfkPlan(
  db: AppDb,
  competitionId: string,
  uploadId: string,
  sheets: Pick<SheetSetup, 'name' | 'headerRow' | 'mapping' | 'include'>[],
  choices: FfkChoices = {},
): Promise<{ plan: FfkCardsPlan; rows: FfkRow[] }> {
  const data = await loadUpload(db, competitionId, uploadId);
  const grid = await getGrid(db, competitionId);
  const book = readWorkbook(data);
  const rows: FfkRow[] = [];
  for (const s of sheets.filter((x) => x.include)) {
    const sheet = book.sheets.find((x) => x.name === s.name);
    if (sheet) rows.push(...parseFfkRows(sheet.cells, s.headerRow, s.mapping, s.name, grid, closedSet(db, competitionId)));
  }
  return { plan: planFfkCards(rows, grid, await loadExisting(db, competitionId), choices), rows };
}

/** Import refusé tant que l'écriture par cartes n'est pas branchée. */
export class FfkImportUnavailableError extends Error {
  readonly statusCode = 503;
  constructor() {
    super('Import FFK en cours de refonte : l’import n’est pas encore disponible (aperçu seulement).');
  }
}

/**
 * Applique le plan. Temporaire (étape 51, Task 4) : l'écriture par cartes (cartes validées et sans problème, catégories
 * acceptées, liens de club, fiches à supprimer) est réécrite à la Task 6 ; d'ici là, l'import est refusé sans rien écrire.
 */
export async function applyFfkPlan(
  _db: AppDb,
  _competitionId: string,
  _plan: FfkCardsPlan,
  _mappings: { headers: string[]; mapping: ColumnMapping }[],
): Promise<{ created: number; updated: number; deleted: number; weightClassesCreated: number }> {
  throw new FfkImportUnavailableError();
}
