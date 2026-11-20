import { eq } from 'drizzle-orm';
import * as XLSX from 'xlsx';
import { buildFfkExport, type FfkExportRegistration } from '../../domain/ffk-export.js';
import type { AppDb } from '../db/client.js';
import { categories, clubs, fighters, registrations } from '../db/schema.js';
import { syncCategories } from './categories.js';
import { getGrid } from './competitions.js';

/** « 0060690 ETOILE SPORTIVE… » : entité FFK, sinon « numéro nom » (numéro '' = effacé par le club), sinon le nom. */
function entityOf(club: { name: string; ffkEntity: string | null; affiliationNumber: string | null } | undefined): string {
  if (!club) return '';
  if (club.ffkEntity) return club.ffkEntity;
  return club.affiliationNumber ? `${club.affiliationNumber} ${club.name}` : club.name;
}

/** Export FFK de la situation finale : toutes les inscriptions, les absentes et les « ne combat pas » étant écartées par le domaine. */
export async function exportFfk(db: AppDb, competitionId: string): Promise<Buffer> {
  await syncCategories(db, competitionId);
  const grid = await getGrid(db, competitionId);
  const fs = new Map(db.select().from(fighters).where(eq(fighters.competitionId, competitionId)).all().map((f) => [f.id, f]));
  const cs = new Map(db.select().from(clubs).where(eq(clubs.competitionId, competitionId)).all().map((c) => [c.id, c]));
  const cats = new Map(db.select().from(categories).where(eq(categories.competitionId, competitionId)).all().map((c) => [c.id, c]));
  const regs: FfkExportRegistration[] = db
    .select()
    .from(registrations)
    .where(eq(registrations.competitionId, competitionId))
    .all()
    .map((r) => {
      const f = fs.get(r.fighterId)!;
      const cat = r.categoryId ? cats.get(r.categoryId) : undefined;
      const registered = r.originalJson ? JSON.parse(r.originalJson) : { discipline: r.discipline, ruleset: r.ruleset, weightClassId: r.weightClassId };
      return {
        firstName: f.firstName, lastName: f.lastName, licence: f.licence,
        entity: entityOf(f.clubId ? cs.get(f.clubId) : undefined),
        sex: f.sex, ageBandCode: f.ageBandCode,
        registered: { discipline: registered.discipline, ruleset: registered.ruleset ?? null, weightClassId: registered.weightClassId ?? null },
        final: cat ? { id: cat.id, key: JSON.parse(cat.keyJson) } : null,
        out: r.presence === 'absent' || !!r.withdrawnReason,
      };
    });
  const wb = XLSX.utils.book_new();
  for (const s of buildFfkExport(regs, grid)) {
    const ws = XLSX.utils.aoa_to_sheet(s.rows);
    const letters = 'ABCDEFGHI'.split('');
    const last = Math.max(-1, ...Object.keys(s.widths).map((l) => letters.indexOf(l)));
    if (last >= 0) ws['!cols'] = letters.slice(0, last + 1).map((l) => (s.widths[l] ? { width: s.widths[l] } : {}));
    // La catégorie (colonne H) en texte, comme dans le modèle : la cellule reste un nombre, au format texte « @ » (affichage « -35 »).
    for (let r = 1; r < s.rows.length; r++) {
      const cell = ws[`H${r + 1}`];
      if (cell) cell.z = '@';
    }
    XLSX.utils.book_append_sheet(wb, ws, s.name);
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
