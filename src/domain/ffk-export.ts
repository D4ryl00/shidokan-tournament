import { isFreeKey, keyString, naturalKey, type CategoryKey } from './categories.js';
import type { CategoryGrid, DisciplineId, Ruleset, Sex } from './types.js';

// Export FFK : le fichier au format de l'export d'inscriptions de la FFK (modèle « Shidokan.xlsm »), avec la situation finale.

export interface FfkExportRegistration {
  firstName: string; lastName: string; licence: string | null;
  /** « 0060690 ETOILE SPORTIVE… » : entité FFK, sinon « numéro nom », sinon le nom ; '' sans club. */
  entity: string;
  sex: Sex; ageBandCode: string;
  /** Valeurs d'inscription : `original` si l'inscription a été déplacée, sinon les valeurs actuelles. */
  registered: { discipline: DisciplineId; ruleset: Ruleset | null; weightClassId: string | null };
  /** Catégorie où il combat (null : pas placé ; tableau libre : sa clé `free`). */
  final: { id: string; key: CategoryKey } | null;
  /** Absent à la pesée ou « ne combat pas ». */
  out: boolean;
}

const KARATE_WIDTHS = { A: 25.71, B: 19.71, D: 58.29, G: 33.71, H: 11.43 };

/** Feuilles du modèle, dans son ordre, avec la valeur de « Type » et les largeurs de colonnes. */
export const FFK_SHEETS: { name: string; discipline: DisciplineId; type: string; widths: Record<string, number> }[] = [
  { name: 'Karate', discipline: 'karate', type: 'Karate', widths: KARATE_WIDTHS },
  { name: 'Boxe', discipline: 'shido-boxing', type: 'Boxe', widths: { B: 20.43, C: 10.86, D: 58.29, E: 11.29, F: 16.43, G: 33.71, H: 9.57, I: 10.29 } },
  { name: 'Mix Martial', discipline: 'shido-mix', type: 'Kmix', widths: { A: 11.86, B: 21.86, C: 10.71, D: 34.57, E: 8.86, F: 10, G: 33.71, H: 9.57, I: 10.29 } },
  { name: 'Triathlon', discipline: 'triathlon', type: 'Triathlon', widths: KARATE_WIDTHS },
  { name: 'Kata', discipline: 'kata', type: 'Kata', widths: { A: 15.57, B: 16.86, D: 44.14, G: 17.14 } },
];

export interface FfkSheet { name: string; widths: Record<string, number>; rows: (string | number | null)[][] }

const HEADER = ['Prénom', 'Nom', 'Numero', 'Entite rattachement', 'Genre', 'Type', 'Age', 'Categorie', 'Technique'];
const SEX_LABEL: Record<Sex, string> = { F: 'Féminin', M: 'Masculin' };

/** Libellé « Age » de l'export FFK : « Cadet », « Vétéran 2 », « Séniors shobu ippon kumité »… (reconnu par l'import FFK). */
export function ffkAgeLabel(grid: CategoryGrid, ageBandCode: string, ruleset: Ruleset | null): string {
  if (ageBandCode === 'senior') return ruleset === 'shobu' ? 'Séniors shobu ippon kumité' : 'Séniors jiyu ippon kumite';
  const vet = /^v(\d)$/.exec(ageBandCode);
  if (vet) return `Vétéran ${vet[1]}`;
  const label = grid.ageBands.find((b) => b.code === ageBandCode)?.label ?? ageBandCode;
  return label.replace(/s$/, '');
}

/** Une vraie catégorie de la grille pour ce combattant : une tranche, au plus un poids, de cette tranche et de son sexe. */
function isRealFor(key: CategoryKey, reg: FfkExportRegistration, grid: CategoryGrid): boolean {
  if (key.ageBandCodes.length !== 1 || key.weightClassIds.length > 1) return false;
  const id = key.weightClassIds[0];
  if (id === undefined) return true;
  const wc = grid.weightClasses.find((w) => w.id === id);
  return !!wc && wc.ageBandCode === key.ageBandCodes[0] && wc.sex === reg.sex;
}

/** Discipline, règlement, tranche et poids écrits pour une inscription (voir la spec, section 5). */
function written(reg: FfkExportRegistration, grid: CategoryGrid) {
  const final = reg.final && !isFreeKey(reg.final.key) ? reg.final.key : null;
  if (!final) return { ...reg.registered, ageBandCode: reg.ageBandCode };
  const real = isRealFor(final, reg, grid);
  return {
    discipline: final.discipline,
    ruleset: final.ruleset,
    ageBandCode: real ? final.ageBandCodes[0]! : reg.ageBandCode,
    weightClassId: real ? (final.weightClassIds[0] ?? null) : reg.registered.weightClassId,
  };
}

/** « -35 » → nombre -35 ; « +45 » → texte ; vide sans poids (kata). */
function weightCell(grid: CategoryGrid, discipline: DisciplineId, weightClassId: string | null): string | number | null {
  if (discipline === 'kata' || !weightClassId) return null;
  const label = grid.weightClasses.find((w) => w.id === weightClassId)?.label;
  if (!label) return null;
  return label.startsWith('-') && Number.isFinite(Number(label)) ? Number(label) : label;
}

/** Rang d'un bloc : sexe (F, puis M et mixtes), tranche la plus jeune, poids le plus léger (ouverte en dernier), jiyu avant shobu. */
function blockRank(key: CategoryKey, grid: CategoryGrid): number[] {
  const bandIndex = (code: string) => {
    const i = grid.ageBands.findIndex((b) => b.code === code);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  const weight = (id: string) => {
    const wc = grid.weightClasses.find((w) => w.id === id);
    return wc ? (wc.maxKg ?? Number.MAX_SAFE_INTEGER - 1) : Number.MAX_SAFE_INTEGER;
  };
  return [
    key.sex === 'F' ? 0 : 1,
    key.ageBandCodes.length ? Math.min(...key.ageBandCodes.map(bandIndex)) : Number.MAX_SAFE_INTEGER,
    key.weightClassIds.length ? Math.min(...key.weightClassIds.map(weight)) : 0,
    key.ruleset === 'shobu' ? 1 : 0,
  ];
}

const compareRanks = (a: number[], b: number[]) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return 0;
};

interface Block { id: string; key: CategoryKey; regs: FfkExportRegistration[] }

/** Feuilles de l'export FFK : une ligne par inscription qui combat, un bloc par catégorie, deux lignes vides entre deux blocs. */
export function buildFfkExport(regs: FfkExportRegistration[], grid: CategoryGrid): FfkSheet[] {
  const blocks = new Map<string, Block>();
  for (const reg of regs) {
    if (reg.out) continue;
    const placed = reg.final && !isFreeKey(reg.final.key) ? reg.final : null;
    const key = placed ? placed.key : naturalKey(reg.registered, reg);
    const id = placed ? `categorie:${placed.id}` : `inscription:${keyString(key)}`;
    const block = blocks.get(id) ?? { id, key, regs: [] };
    block.regs.push(reg);
    blocks.set(id, block);
  }
  const byName = (a: FfkExportRegistration, b: FfkExportRegistration) =>
    a.lastName.toUpperCase().localeCompare(b.lastName.toUpperCase(), 'fr') || a.firstName.toUpperCase().localeCompare(b.firstName.toUpperCase(), 'fr');

  return FFK_SHEETS.map((sheet) => {
    const sorted = [...blocks.values()]
      .filter((b) => b.key.discipline === sheet.discipline)
      .sort((a, b) => compareRanks(blockRank(a.key, grid), blockRank(b.key, grid)) || keyString(a.key).localeCompare(keyString(b.key)) || a.id.localeCompare(b.id));
    // Feuille Triathlon du modèle quand elle n'a pas d'inscription.
    if (sheet.discipline === 'triathlon' && sorted.length === 0) return { name: sheet.name, widths: {}, rows: [['Ytiathlon']] };
    const rows: FfkSheet['rows'] = [[...HEADER]];
    sorted.forEach((block, i) => {
      if (i > 0) rows.push([], []);
      for (const reg of [...block.regs].sort(byName)) {
        const w = written(reg, grid);
        rows.push([
          reg.firstName.toUpperCase(), reg.lastName.toUpperCase(), reg.licence, reg.entity, SEX_LABEL[reg.sex], sheet.type,
          ffkAgeLabel(grid, w.ageBandCode, w.ruleset), weightCell(grid, w.discipline, w.weightClassId), null,
        ]);
      }
    });
    return { name: sheet.name, widths: sheet.widths, rows };
  });
}
