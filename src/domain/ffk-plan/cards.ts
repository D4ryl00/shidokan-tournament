import type { ClubFormLine, CombatDiscipline } from '../club-form.js';
import { weightClassesFor } from '../grid.js';
import { normalizeName } from '../names.js';
import type { CategoryGrid, DisciplineId, WeightClass } from '../types.js';
import { parseWeightLabel } from '../weights.js';
import type { FfkRow } from '../ffk-import.js';
import type { ClubLink } from './clubs.js';

/** Ce que `loadExisting` fournit par combattant de la compétition. */
export interface ExistingFighter {
  fighterId: string;
  clubId: string | null;
  licence: string | null;
  line: ClubFormLine;
  publicNameHidden: boolean;
  version: string;
  editable: boolean;
  partlyEditable: boolean;
  startedDisciplines: DisciplineId[];
  /** A une inscription source « ffk ». */
  fromFfk: boolean;
}

export interface FfkCardDraft {
  /** `L:<licence>` sinon `N:<nameKey>|<sex>|<clubEntity>` (`R:<ligne>` si la ligne n’a aucun nom). */
  key: string;
  /** Lignes de l’export (toutes disciplines). */
  rows: FfkRow[];
  /** Nom, prénom, sexe, âge, catégorie de poids, disciplines, règlement, licence de l’export. */
  exportLine: ClubFormLine;
  clubEntity: string | null;
  /** Club tel que relié ; `null` = pas relié. */
  clubId: string | null;
  weightIssue: string | null;
  /** Erreurs non bloquantes de lecture, lignes en double. */
  notes: string[];
  candidates: { fighterId: string; reason: string }[];
  /** Rapprochement sûr : licence, ou nom exact unique dans le club relié. */
  sure: string | null;
}

export function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length]!;
}

const cardKey = (r: FfkRow): string => {
  if (r.licence) return `L:${r.licence}`;
  const name = normalizeName(`${r.lastName} ${r.firstName}`);
  return name ? `N:${name}|${r.sex ?? ''}|${r.clubEntity ?? ''}` : `R:${r.line}`;
};

const firstOf = <T>(rows: FfkRow[], pick: (r: FfkRow) => T | null | undefined): T | null => {
  for (const r of rows) {
    const v = pick(r);
    if (v !== null && v !== undefined) return v;
  }
  return null;
};

/** Une carte par combattant de l’export : les lignes de même licence (à défaut même nom + sexe + club) sont regroupées. */
export function buildCards(
  rows: FfkRow[],
  links: ClubLink[],
  fighters: ExistingFighter[],
  grid: CategoryGrid,
  acceptedWeightClasses: ReadonlySet<string>,
): { cards: FfkCardDraft[]; newWeightClasses: (WeightClass & { rows: number })[] } {
  const groups = new Map<string, FfkRow[]>();
  for (const r of rows) {
    const k = cardKey(r);
    const g = groups.get(k);
    if (g) g.push(r);
    else groups.set(k, [r]);
  }

  const newWeightClasses: (WeightClass & { rows: number })[] = [];
  /** Combattant → licence de la carte qui l’a déjà réclamé dans cet import. */
  const claimedBy = new Map<string, string | null>();
  const keyOf = (f: ExistingFighter) => normalizeName(`${f.line.lastName} ${f.line.firstName}`);
  const cards: FfkCardDraft[] = [];

  for (const [key, group] of groups) {
    const first = group[0]!;
    const licence = firstOf(group, (r) => r.licence);
    const sex = firstOf(group, (r) => r.sex);
    const ageBandCode = firstOf(group, (r) => r.ageBandCode);
    const clubEntity = firstOf(group, (r) => r.clubEntity);
    const clubId = clubEntity ? (links.find((l) => l.clubEntity === clubEntity)?.target ?? null) : null;

    const notes: string[] = [];
    const combats: CombatDiscipline[] = [];
    let kata = false;
    const seen = new Map<DisciplineId, number>();
    for (const r of group) {
      for (const e of r.errors) if (!notes.includes(e)) notes.push(e);
      if (!r.discipline) continue;
      const before = seen.get(r.discipline);
      if (before !== undefined) {
        notes.push(`Ligne en double : même ${r.licence ? 'licence et même ' : 'nom et même '}discipline que la ligne ${before}.`);
        continue;
      }
      seen.set(r.discipline, r.line);
      if (r.discipline === 'kata') kata = true;
      else combats.push(r.discipline as CombatDiscipline);
    }

    // Catégorie de poids : existante, ou nouvelle (acceptée ou non).
    let weightClassId: string | null = null;
    let weightIssue: string | null = null;
    for (const r of group) {
      weightIssue ??= r.weightIssue ?? null;
      if (!r.weightLabel || !r.ageBandCode || !r.sex) continue;
      const found = weightClassesFor(grid, r.ageBandCode, r.sex).find((w) => w.label === r.weightLabel);
      const id = found?.id ?? `${r.ageBandCode}:${r.sex}:${r.weightLabel}`;
      if (!found) {
        const known = newWeightClasses.find((w) => w.id === id);
        if (known) known.rows++;
        else {
          const parsed = parseWeightLabel(r.weightLabel)!;
          newWeightClasses.push({ id, ageBandCode: r.ageBandCode, sex: r.sex, label: parsed.label, maxKg: parsed.maxKg, sortOrder: 0, rows: 1 });
        }
        if (!acceptedWeightClasses.has(id)) {
          weightIssue ??= `« ${r.weightLabel.replace('-', '−')} » n’est pas dans la grille.`;
          continue;
        }
      }
      weightClassId ??= id;
    }

    const exportLine: ClubFormLine = {
      lastName: first.lastName,
      firstName: firstOf(group, (r) => r.firstName || null) ?? '',
      sex,
      ageBandCode,
      weightClassId,
      weightKg: null,
      combats,
      kata,
      grade: null,
      ruleset: firstOf(group.filter((r) => r.discipline !== 'kata'), (r) => r.ruleset),
      prefs: {},
      shobuKeep: null,
      licence,
    };

    // Rapprochement avec les combattants de l’app (reprend l’ancien import).
    const fullKey = normalizeName(`${exportLine.lastName} ${exportLine.firstName}`);
    const reversedKey = normalizeName(`${exportLine.firstName} ${exportLine.lastName}`);
    const sameSex = fighters.filter((f) => f.line.sex === sex && !(licence && f.licence && f.licence !== licence));
    const claimedByOther = (f: ExistingFighter) => {
      const other = claimedBy.get(f.fighterId);
      return other !== undefined && other !== null && licence !== null && other !== licence;
    };
    const matches = (f: ExistingFighter) => keyOf(f) === fullKey || keyOf(f) === reversedKey;

    let sure: string | null = null;
    const candidates: { fighterId: string; reason: string }[] = [];
    const byLicence = licence ? fighters.find((f) => f.licence === licence) : undefined;
    if (byLicence) {
      sure = byLicence.fighterId;
      candidates.push({ fighterId: sure, reason: 'même licence' });
    } else {
      const inClub = clubId ? sameSex.filter((f) => f.clubId === clubId) : [];
      const exact = inClub.filter(matches);
      if (exact.length === 1 && claimedByOther(exact[0]!)) {
        candidates.push({ fighterId: exact[0]!.fighterId, reason: 'déjà rapproché d’une autre licence dans cet import' });
      } else if (exact.length === 1) {
        sure = exact[0]!.fighterId;
        candidates.push({ fighterId: sure, reason: 'même nom, même club' });
      } else if (exact.length > 1) {
        for (const f of exact) candidates.push({ fighterId: f.fighterId, reason: 'homonymes dans le même club' });
      } else {
        for (const f of inClub) {
          if (normalizeName(f.line.lastName) === normalizeName(exportLine.lastName)) {
            candidates.push({ fighterId: f.fighterId, reason: 'même nom de famille, prénom différent' });
          } else if (Math.min(levenshtein(keyOf(f), fullKey), levenshtein(keyOf(f), reversedKey)) <= 2) {
            candidates.push({ fighterId: f.fighterId, reason: 'nom très proche' });
          }
        }
        for (const f of sameSex.filter((f) => clubId === null || f.clubId !== clubId)) {
          if (matches(f)) candidates.push({ fighterId: f.fighterId, reason: clubId === null ? 'même nom, club non renseigné' : 'même nom, autre club' });
        }
        // Même club, même nom, autre licence enregistrée : à l’organisateur de trancher, sauf homonyme avéré.
        for (const f of fighters) {
          const otherLicence = licence && f.licence && f.licence !== licence;
          if (otherLicence && f.line.sex === sex && clubId && f.clubId === clubId && matches(f) && !claimedByOther(f)) {
            candidates.push({ fighterId: f.fighterId, reason: 'même nom, autre licence' });
          }
        }
      }
    }
    if (sure && !claimedBy.has(sure)) claimedBy.set(sure, licence);

    cards.push({ key, rows: group, exportLine, clubEntity, clubId, weightIssue, notes, candidates, sure });
  }
  return { cards, newWeightClasses };
}
