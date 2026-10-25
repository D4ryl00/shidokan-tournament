import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  findHeaderRow,
  guessColumnMapping,
  headerSignature,
  parseFfkRows,
  planFfkImport,
  type ColumnMapping,
  type ExistingData,
  type FfkChoices,
  type FfkImportPlan,
  type FfkRow,
} from '../../domain/ffk-import.js';
import { mergeWeightClasses, validateGrid } from '../../domain/grid.js';
import { normalizeName } from '../../domain/names.js';
import type { ProposalType } from '../../domain/replacement/types.js';
import type { AppDb } from '../db/client.js';
import { linkClub } from '../db/club-directory.js';
import { clubAliases, clubs, fighters, importMappings, registrations, uploads, weightClasses } from '../db/schema.js';
import { readWorkbook } from '../spreadsheet/read.js';
import { closedSet } from './closed-categories.js';
import { GridValidationError, getGrid } from './competitions.js';
import { NotFoundError, RegistrationValidationError, listClubs } from './registrations.js';

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

export async function loadExisting(db: AppDb, competitionId: string): Promise<ExistingData> {
  const regs = db.select().from(registrations).where(eq(registrations.competitionId, competitionId)).all();
  return {
    clubs: await listClubs(db, competitionId),
    fighters: db
      .select()
      .from(fighters)
      .where(eq(fighters.competitionId, competitionId))
      .all()
      .map(({ nameKey: _k, ...f }) => f),
    registrations: regs.map(({ otherDisciplinesJson, originalJson, withdrawnReason, ...r }) => ({
      ...r,
      withdrawn: withdrawnReason !== null,
      recasementType: r.recasementType as ProposalType | null,
      otherDisciplines: JSON.parse(otherDisciplinesJson),
      original: originalJson ? JSON.parse(originalJson) : null,
    })),
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
): Promise<{ plan: FfkImportPlan; rows: FfkRow[] }> {
  const data = await loadUpload(db, competitionId, uploadId);
  const grid = await getGrid(db, competitionId);
  const book = readWorkbook(data);
  const rows: FfkRow[] = [];
  for (const s of sheets.filter((x) => x.include)) {
    const sheet = book.sheets.find((x) => x.name === s.name);
    if (sheet) rows.push(...parseFfkRows(sheet.cells, s.headerRow, s.mapping, s.name, grid, closedSet(db, competitionId)));
  }
  return { plan: planFfkImport(rows, grid, await loadExisting(db, competitionId), choices), rows };
}

/** Applique le plan dans une transaction. Refuse s'il reste des rapprochements douteux. */
export async function applyFfkPlan(
  db: AppDb,
  competitionId: string,
  plan: FfkImportPlan,
  mappings: { headers: string[]; mapping: ColumnMapping }[],
): Promise<{ created: number; updated: number; removed: number; weightClassesCreated: number }> {
  if (plan.summary.doubtful > 0) throw new RegistrationValidationError(['Des rapprochements douteux restent à trancher.']);
  const merged = mergeWeightClasses(await getGrid(db, competitionId), plan.newWeightClasses);
  const gridErrors = validateGrid(merged);
  if (gridErrors.length) throw new GridValidationError(gridErrors);
  const touched = new Set(plan.newWeightClasses.map((w) => `${w.ageBandCode}|${w.sex}`));

  return db.transaction((tx) => {
    const t = tx as unknown as AppDb;

    // 1. Catégories de poids manquantes ; ordre et catégorie ouverte recalculés dans les groupes touchés.
    for (const w of plan.newWeightClasses) t.insert(weightClasses).values({ ...w, competitionId }).run();
    for (const w of merged.weightClasses.filter((x) => touched.has(`${x.ageBandCode}|${x.sex}`))) {
      t.update(weightClasses)
        .set({ label: w.label, sortOrder: w.sortOrder })
        .where(and(eq(weightClasses.competitionId, competitionId), eq(weightClasses.id, w.id)))
        .run();
    }

    // 2. Clubs : relier ou créer, mémoriser les alias.
    const clubIdByEntity = new Map<string, string>();
    for (const link of plan.clubs) {
      if (link.target.kind === 'existing') {
        const club = t.select().from(clubs).where(eq(clubs.id, link.target.clubId)).get()!;
        // Seuls les liens sûrs (ou confirmés par l'organisateur) sont mémorisés : un lien « à vérifier » le reste au réimport
        // (pas d'entité FFK sur le club) comme dans les compétitions suivantes (pas d'alias).
        if (link.certainty === 'sure') {
          t.update(clubs).set({ ffkEntity: link.clubEntity }).where(eq(clubs.id, club.id)).run();
          t.insert(clubAliases)
            .values({ nameKey: club.nameKey, clubEntity: link.clubEntity })
            .onConflictDoUpdate({ target: clubAliases.nameKey, set: { clubEntity: link.clubEntity } })
            .run();
        }
        clubIdByEntity.set(link.clubEntity, club.id);
        linkClub(t, club.id);
      } else {
        const id = crypto.randomUUID();
        t.insert(clubs)
          .values({ id, competitionId, name: link.clubName, nameKey: normalizeName(link.clubName), ffkEntity: link.clubEntity, preApproval: false })
          .run();
        clubIdByEntity.set(link.clubEntity, id);
        linkClub(t, id);
      }
    }

    // 3-4. Combattants et inscriptions.
    // Nouveaux combattants regroupés par licence, ou à défaut par nom + sexe + club.
    const newFighterByKey = new Map<string, string>();
    const groupKey = (row: FfkRow) =>
      row.licence ? `L:${row.licence}` : `N:${normalizeName(`${row.lastName} ${row.firstName}`)}|${row.sex}|${row.clubEntity ?? ''}`;
    let created = 0;
    let updated = 0;
    const fighterData = (row: FfkRow) => ({
      ageBandCode: row.ageBandCode!,
      sex: row.sex!,
      ...(row.licence ? { licence: row.licence } : {}),
      ...(row.clubEntity && clubIdByEntity.has(row.clubEntity) ? { clubId: clubIdByEntity.get(row.clubEntity)! } : {}),
    });
    for (const item of plan.items) {
      if (item.kind === 'create') {
        const row = item.row;
        let fighterId = item.fighterId;
        if (fighterId === 'new') {
          fighterId = newFighterByKey.get(groupKey(row)) ?? '';
          if (!fighterId) {
            fighterId = crypto.randomUUID();
            t.insert(fighters)
              .values({
                id: fighterId,
                competitionId,
                lastName: row.lastName,
                firstName: row.firstName,
                nameKey: normalizeName(`${row.lastName} ${row.firstName}`),
                clubId: null,
                licence: null,
                ...fighterData(row),
              })
              .run();
            newFighterByKey.set(groupKey(row), fighterId);
          }
        } else {
          t.update(fighters).set(fighterData(row)).where(eq(fighters.id, fighterId)).run();
        }
        const isKata = row.discipline === 'kata';
        t.insert(registrations)
          .values({
            id: crypto.randomUUID(),
            competitionId,
            fighterId,
            discipline: row.discipline!,
            ruleset: isKata ? null : (row.ruleset ?? 'jiyu'),
            weightClassId: isKata ? null : item.weightClassId,
            source: 'ffk',
            ffkConfirmed: true,
          })
          .run();
        created++;
      } else if (item.kind === 'update') {
        t.update(fighters).set(fighterData(item.row)).where(eq(fighters.id, item.fighterId)).run();
        const current = t.select().from(registrations).where(eq(registrations.id, item.registrationId)).get()!;
        const fields = {
          ...(item.row.discipline === 'kata' ? {} : { weightClassId: item.weightClassId }),
          ...(item.row.ruleset ? { ruleset: item.row.ruleset } : {}),
        };
        if (current.originalJson) {
          // Inscription recasée : l'export FFK met à jour les valeurs d'origine, pas le placement validé.
          const original = { ...JSON.parse(current.originalJson), ...fields };
          t.update(registrations).set({ originalJson: JSON.stringify(original), ffkConfirmed: true }).where(eq(registrations.id, item.registrationId)).run();
        } else {
          t.update(registrations).set({ ...fields, ffkConfirmed: true }).where(eq(registrations.id, item.registrationId)).run();
        }
        updated++;
      }
    }

    // 5. Retraits et inscriptions non confirmées.
    if (plan.removals.length) {
      const ids = plan.removals.map((r) => r.registrationId);
      const fighterIds = t.select().from(registrations).where(inArray(registrations.id, ids)).all().map((r) => r.fighterId);
      t.delete(registrations).where(inArray(registrations.id, ids)).run();
      for (const fid of new Set(fighterIds)) {
        if (t.select().from(registrations).where(eq(registrations.fighterId, fid)).all().length === 0) {
          t.delete(fighters).where(eq(fighters.id, fid)).run();
        }
      }
    }
    if (plan.unconfirmed.length) {
      t.update(registrations).set({ ffkConfirmed: false }).where(inArray(registrations.id, plan.unconfirmed.map((u) => u.registrationId))).run();
    }

    // 6. Correspondances de colonnes.
    for (const m of mappings) {
      const signature = headerSignature(m.headers);
      t.insert(importMappings)
        .values({ signature, mappingJson: JSON.stringify(m.mapping) })
        .onConflictDoUpdate({ target: importMappings.signature, set: { mappingJson: JSON.stringify(m.mapping) } })
        .run();
    }
    return { created, updated, removed: plan.removals.length, weightClassesCreated: plan.newWeightClasses.length };
  });
}
