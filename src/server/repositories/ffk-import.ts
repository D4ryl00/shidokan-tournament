import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { enteredValues } from '../../domain/club-line.js';
import { findHeaderRow, guessColumnMapping, headerSignature, parseFfkRows, type ColumnMapping, type FfkRow } from '../../domain/ffk-import.js';
import type { ExistingFighter } from '../../domain/ffk-plan/cards.js';
import type { ExistingClub } from '../../domain/ffk-plan/clubs.js';
import { planFfkCards, type ExistingData, type FfkCardsPlan, type FfkChoices, type FfkImportResult } from '../../domain/ffk-plan/plan.js';
import { mergeWeightClasses, validateGrid } from '../../domain/grid.js';
import type { CategoryGrid, WeightClass } from '../../domain/types.js';
import type { AppDb } from '../db/client.js';
import { linkClub } from '../db/club-directory.js';
import { clubAliases, clubDirectory, clubs, fighters, importMappings, registrations, uploads, weightClasses } from '../db/schema.js';
import { readWorkbook } from '../spreadsheet/read.js';
import { closedSet } from './closed-categories.js';
import { fighterLine, fighterLines, LineReadOnlyError, StaleLineError, writeClubLineInTx } from './club-entry.js';
import { GridValidationError, getGrid } from './competitions.js';
import { NotFoundError, RegistrationValidationError } from './registrations.js';

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
    // La ligne vue par l'organisateur (formulaire combattant), avec sa version et ses verrous ; ordre des noms puis des ids (empreinte stable).
    fighters: fighterLines(db, competitionId).map((l): ExistingFighter => ({
      fighterId: l.fighterId, clubId: l.clubId || null, licence: l.line.licence ?? null, line: l.line, publicNameHidden: l.publicNameHidden, version: l.version,
      editable: l.editable, partlyEditable: l.partlyEditable, startedDisciplines: l.startedDisciplines, fromFfk: ffkFighters.has(l.fighterId),
    })),
    aliases: Object.fromEntries(db.select().from(clubAliases).all().map((a) => [a.nameKey, a.clubEntity])),
  };
}

/** Lit les onglets retenus et calcule le plan (aucune écriture). Rend aussi la grille et ce que le plan connaît de la compétition. */
export async function buildFfkPlan(
  db: AppDb,
  competitionId: string,
  uploadId: string,
  sheets: Pick<SheetSetup, 'name' | 'headerRow' | 'mapping' | 'include'>[],
  choices: FfkChoices = {},
): Promise<{ plan: FfkCardsPlan; rows: FfkRow[]; grid: CategoryGrid; existing: ExistingData }> {
  const data = await loadUpload(db, competitionId, uploadId);
  const grid = await getGrid(db, competitionId);
  const book = readWorkbook(data);
  const closed = closedSet(db, competitionId);
  const rows: FfkRow[] = [];
  for (const s of sheets.filter((x) => x.include)) {
    const sheet = book.sheets.find((x) => x.name === s.name);
    if (sheet) rows.push(...parseFfkRows(sheet.cells, s.headerRow, s.mapping, s.name, grid, closed));
  }
  const existing = await loadExisting(db, competitionId);
  return { plan: planFfkCards(rows, grid, existing, choices), rows, grid, existing };
}

/** Erreur d'écriture d'une carte, le nom du combattant en tête (l'import entier est annulé). */
function withName(label: string, e: unknown): unknown {
  if (e instanceof RegistrationValidationError) return new RegistrationValidationError(e.errors.length ? e.errors.map((m) => `${label} : ${m}`) : [`${label} : ligne refusée.`]);
  if (e instanceof LineReadOnlyError) return new LineReadOnlyError(`${label} : ${e.message}`);
  if (e instanceof StaleLineError) return new LineReadOnlyError(`${label} : ${e.message}`);
  return e;
}

/**
 * Applique le plan, dans une transaction : catégories cochées ; liens de club (sûrs ou choisis, mémorisés) ; cartes `auto` et `done`
 * (valeurs de la carte, écrites comme une ligne du formulaire combattant) ; fiches sans inscription FFK supprimées ou gardées ; correspondances
 * de colonnes. Une carte laissée de côté (`todo`, `skip`) ne touche pas aux inscriptions de son combattant. Une ligne refusée annule tout.
 */
export async function applyFfkCards(
  db: AppDb,
  competitionId: string,
  plan: FfkCardsPlan,
  mappings: { headers: string[]; mapping: ColumnMapping }[],
): Promise<FfkImportResult> {
  const added: WeightClass[] = plan.weightClasses.filter((w) => w.accepted).map(({ rows: _r, accepted: _a, ...w }) => w);
  const merged = mergeWeightClasses(await getGrid(db, competitionId), added);
  const gridErrors = validateGrid(merged);
  if (gridErrors.length) throw new GridValidationError(gridErrors);
  const touched = new Set(added.map((w) => `${w.ageBandCode}|${w.sex}`));

  return db.transaction((tx) => {
    const t = tx as unknown as AppDb;

    // 1. Catégories de poids cochées ; ordre et catégorie ouverte recalculés dans les groupes touchés.
    for (const w of added) t.insert(weightClasses).values({ ...w, competitionId }).run();
    for (const w of merged.weightClasses.filter((x) => touched.has(`${x.ageBandCode}|${x.sex}`))) {
      t.update(weightClasses)
        .set({ label: w.label, sortOrder: w.sortOrder })
        .where(and(eq(weightClasses.competitionId, competitionId), eq(weightClasses.id, w.id)))
        .run();
    }

    // 2. Clubs reliés (lien sûr ou choisi) : l'entité FFK et l'alias nom → entité sont mémorisés ; un lien « à vérifier » non choisi ne l'est pas.
    for (const link of plan.clubs) {
      if (!link.target) continue;
      const club = t.select().from(clubs).where(and(eq(clubs.id, link.target), eq(clubs.competitionId, competitionId))).get();
      if (!club) throw new NotFoundError('Club introuvable');
      if (link.chosen) {
        // Lien corrigé : l'entité quitte l'ancien club (et son alias), le nouveau lien le remplace.
        const previous = t.select().from(clubs)
          .where(and(eq(clubs.competitionId, competitionId), eq(clubs.ffkEntity, link.clubEntity), ne(clubs.id, club.id))).all();
        for (const p of previous) {
          t.update(clubs).set({ ffkEntity: null }).where(eq(clubs.id, p.id)).run();
          if (p.nameKey !== club.nameKey) t.delete(clubAliases).where(and(eq(clubAliases.nameKey, p.nameKey), eq(clubAliases.clubEntity, link.clubEntity))).run();
        }
      }
      t.update(clubs).set({ ffkEntity: link.clubEntity }).where(eq(clubs.id, club.id)).run();
      t.insert(clubAliases)
        .values({ nameKey: club.nameKey, clubEntity: link.clubEntity })
        .onConflictDoUpdate({ target: clubAliases.nameKey, set: { clubEntity: link.clubEntity } })
        .run();
      linkClub(t, club.id);
    }

    // 3. Cartes retenues : la valeur de la carte, écrite comme une ligne du formulaire combattant (verrous des combats commencés, recasements).
    let created = 0;
    let updated = 0;
    for (const card of plan.cards) {
      if ((card.state !== 'auto' && card.state !== 'done') || !card.value || !card.fighterId) continue;
      const { line, clubId, publicNameHidden } = card.value;
      const isNew = card.fighterId === 'new';
      let fighterId: string;
      try {
        fighterId = writeClubLineInTx(t, competitionId, {
          fighterId: isNew ? null : card.fighterId, line, clubId: clubId!, expectedVersion: card.version, writer: { kind: 'organiser' },
          publicNameHidden, source: 'ffk', licence: line.licence,
        });
      } catch (e) {
        throw withName(`${line.lastName} ${line.firstName}`.trim(), e);
      }
      if (isNew) created++;
      else if (card.changes.length) updated++;
      // Confirmées par l'export : les inscriptions de ses disciplines ; les autres (gardées de la fiche) ne le sont pas.
      const exported = new Set(card.rows.map((r) => r.discipline).filter((d) => d !== null));
      for (const r of t.select().from(registrations).where(eq(registrations.fighterId, fighterId)).all()) {
        const ffkConfirmed = exported.has(enteredValues({ ...r, otherDisciplines: [] }).discipline);
        if (r.ffkConfirmed !== ffkConfirmed) t.update(registrations).set({ ffkConfirmed }).where(eq(registrations.id, r.id)).run();
      }
    }

    // 4. Fiches sans inscription FFK : supprimées sur demande, sinon gardées mais plus confirmées par l'export.
    let deleted = 0;
    for (const orphan of plan.orphans) {
      if (orphan.action === 'delete') {
        const current = fighterLine(t, competitionId, orphan.fighterId);
        if (current.startedDisciplines.length) {
          throw new RegistrationValidationError([`${orphan.label} : ses combats ont commencé, il ne peut pas être supprimé.`]);
        }
        t.delete(registrations).where(eq(registrations.fighterId, orphan.fighterId)).run();
        t.delete(fighters).where(eq(fighters.id, orphan.fighterId)).run();
        deleted++;
      } else {
        t.update(registrations)
          .set({ ffkConfirmed: false })
          .where(and(eq(registrations.fighterId, orphan.fighterId), eq(registrations.ffkConfirmed, true)))
          .run();
      }
    }

    // 5. Correspondances de colonnes.
    for (const m of mappings) {
      const signature = headerSignature(m.headers);
      t.insert(importMappings)
        .values({ signature, mappingJson: JSON.stringify(m.mapping) })
        .onConflictDoUpdate({ target: importMappings.signature, set: { mappingJson: JSON.stringify(m.mapping) } })
        .run();
    }
    return { created, updated, deleted, weightClassesCreated: added.length, leftAside: plan.summary.todo + plan.summary.skip };
  });
}
