import { ageBandFromLabel, closedEntryWarning, rulesetFromLabel } from './club-form.js';
import { DISCIPLINES, disciplineFromLabel } from './disciplines.js';
import { normalizeName, parseSex, splitFullName } from './names.js';
import { weightClassesFor } from './grid.js';
import type { Club, Fighter, Registration } from './registration.js';
import type { CategoryGrid, DisciplineId, Ruleset, Sex, WeightClass } from './types.js';
import { parseWeightLabel, resolveWeightCell } from './weights.js';

export const FFK_FIELDS = ['lastName', 'firstName', 'licence', 'club', 'sex', 'discipline', 'ageBand', 'weight', 'ruleset'] as const;
export type FfkField = (typeof FFK_FIELDS)[number];

export const FFK_FIELD_LABELS: Record<FfkField, string> = {
  lastName: 'Nom',
  firstName: 'Prénom',
  licence: 'N° de licence',
  club: 'Club (entité)',
  sex: 'Sexe',
  discipline: 'Discipline',
  ageBand: "Catégorie d'âge",
  weight: 'Catégorie de poids',
  ruleset: 'Règlement',
};

/** Titres reconnus (après normalizeName). Dans l'export FFK, « Type » = discipline et « Discipline » = règlement. */
const ALIASES: Record<FfkField, string[]> = {
  lastName: ['NOM', 'NOM DE FAMILLE'],
  firstName: ['PRENOM'],
  licence: ['NUMERO', 'LICENCE', 'N LICENCE', 'NUMERO LICENCE', 'NUMERO DE LICENCE', 'NO LICENCE'],
  club: ['ENTITE RATTACHEMENT', 'CLUB', 'ENTITE', 'ENTITE DE RATTACHEMENT'],
  sex: ['GENRE', 'SEXE'],
  discipline: ['TYPE', 'EPREUVE'],
  ageBand: ['AGE', 'CATEGORIE D AGE', 'CATEGORIE AGE'],
  weight: ['CATEGORIE', 'POIDS', 'CATEGORIE DE POIDS', 'CATEGORIE POIDS'],
  ruleset: ['DISCIPLINE', 'REGLEMENT'],
};

export type ColumnMapping = Record<FfkField, number | null>;

const text = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());

export function guessColumnMapping(headers: unknown[]): ColumnMapping {
  const normalized = headers.map((h) => normalizeName(text(h)));
  const mapping = Object.fromEntries(FFK_FIELDS.map((f) => [f, null])) as ColumnMapping;
  for (const field of FFK_FIELDS) {
    const index = normalized.findIndex((h) => ALIASES[field].includes(h));
    mapping[field] = index >= 0 ? index : null;
  }
  return mapping;
}

const recognized = (row: unknown[]) => Object.values(guessColumnMapping(row)).filter((v) => v !== null).length;

/** Première ligne (parmi les 10 premières) qui ressemble à un en-tête (≥ 3 titres reconnus). */
export function findHeaderRow(cells: unknown[][]): number | null {
  for (let r = 0; r < Math.min(10, cells.length); r++) if (recognized(cells[r] ?? []) >= 3) return r;
  return null;
}

export function headerSignature(headers: unknown[]): string {
  return headers.map((h) => normalizeName(text(h))).join('|');
}

export function disciplineFromSheetName(name: string): DisciplineId | null {
  const s = normalizeName(name);
  if (s.includes('KATA')) return 'kata';
  if (s.includes('TRIATHLON')) return 'triathlon';
  if (s.includes('MIX')) return 'shido-mix';
  if (s.includes('BOX')) return 'shido-boxing';
  if (s.includes('KARATE')) return 'karate';
  return null;
}

export interface FfkRow {
  /** `${sheet}#${line}` : clé stable pour les décisions de l'organisateur. */
  key: string;
  sheet: string;
  /** Ligne du tableur (1-based). */
  line: number;
  licence: string | null;
  lastName: string;
  firstName: string;
  clubEntity: string | null;
  clubName: string | null;
  sex: Sex | null;
  ageBandCode: string | null;
  discipline: DisciplineId | null;
  ruleset: Ruleset | null;
  /** Libellé normalisé (« -35 », « +84 ») ; null pour le kata. */
  weightLabel: string | null;
  errors: string[];
  warnings: string[];
}

export function parseFfkRows(
  cells: unknown[][],
  headerRow: number,
  mapping: ColumnMapping,
  sheetName: string,
  grid: CategoryGrid,
  closed: ReadonlySet<string> = new Set(),
): FfkRow[] {
  const sheetDiscipline = disciplineFromSheetName(sheetName);
  const get = (row: unknown[], f: FfkField) => (mapping[f] === null ? null : (row[mapping[f]!] ?? null));
  const rows: FfkRow[] = [];
  for (let r = headerRow + 1; r < cells.length; r++) {
    const row = cells[r] ?? [];
    const used = FFK_FIELDS.map((f) => text(get(row, f)));
    if (used.every((v) => v === '')) continue;
    const errors: string[] = [];
    const warnings: string[] = [];

    const { lastName, firstName } = splitFullName(text(get(row, 'lastName')), text(get(row, 'firstName')) || null);
    if (!lastName) errors.push('Nom manquant.');
    const licence = text(get(row, 'licence')) || null;
    if (!licence) warnings.push('Pas de numéro de licence.');
    const clubEntity = text(get(row, 'club')) || null;
    const clubName = clubEntity ? clubEntity.replace(/^\d+\s*/, '').replace(/\s+/g, ' ').trim() || clubEntity : null;
    if (!clubEntity) warnings.push('Pas de club.');

    const sexCell = get(row, 'sex');
    const sex = parseSex(sexCell);
    if (!sex) errors.push(`Sexe incompréhensible : « ${text(sexCell)} ».`);

    const ageCell = get(row, 'ageBand');
    const ageBandCode = ageBandFromLabel(ageCell, grid);
    if (!ageBandCode) errors.push(`Catégorie d'âge manquante ou incompréhensible : « ${text(ageCell)} ».`);
    else if (/^VETERANS?$/.test(normalizeName(text(ageCell)))) {
      warnings.push('« Vétéran » sans numéro : placé en V1 (à corriger si besoin).');
    }

    const disciplineCell = get(row, 'discipline');
    const discipline = disciplineFromLabel(disciplineCell) ?? (text(disciplineCell) ? null : sheetDiscipline);
    if (!discipline) errors.push(`Discipline incompréhensible : « ${text(disciplineCell) || sheetName} ».`);

    const rulesetCell = get(row, 'ruleset');
    const ruleset = rulesetFromLabel(rulesetCell);
    if (text(rulesetCell) && !ruleset) warnings.push(`Règlement ignoré : « ${text(rulesetCell)} ».`);

    let weightLabel: string | null = null;
    if (discipline && DISCIPLINES[discipline].hasWeight && sex && ageBandCode) {
      const res = resolveWeightCell(grid, ageBandCode, sex, get(row, 'weight'));
      if (res.kind === 'ok') {
        weightLabel = res.weightClass.label;
        if (res.warning) warnings.push(res.warning);
      } else if (res.kind === 'unknown') {
        if (res.maxKg === null) errors.push(`Catégorie ouverte « ${res.label} » inconnue dans la grille pour cette catégorie d'âge.`);
        else {
          weightLabel = res.label;
          warnings.push(`Catégorie de poids « ${res.label} » absente de la grille : elle sera créée.`);
        }
      } else errors.push(res.message);
    }

    // Règlement absent : jiyu à l'import (comme le fait l'import lui-même).
    if (sex && ageBandCode && discipline) {
      const w = closedEntryWarning({ ageBandCode, sex, discipline, ruleset: discipline === 'kata' ? null : (ruleset ?? 'jiyu') }, closed);
      if (w) warnings.push(w);
    }
    rows.push({
      key: `${sheetName}#${r + 1}`,
      sheet: sheetName,
      line: r + 1,
      licence,
      lastName,
      firstName,
      clubEntity,
      clubName,
      sex,
      ageBandCode,
      discipline,
      ruleset,
      weightLabel,
      errors,
      warnings,
    });
  }
  return rows;
}

// --- Plan d'import et rapprochement (spec §7.3) ---

export interface ExistingData {
  clubs: Club[];
  fighters: Fighter[];
  /** `original` : valeurs d'avant un recasement (l'export FFK porte toujours sur elles). */
  registrations: (Registration & { ffkConfirmed: boolean; original?: { discipline: DisciplineId; ruleset: Ruleset | null; weightClassId: string | null } | null })[];
  /** nameKey d'un club (fiche) → entité FFK, mémorisé d'une compétition à l'autre. */
  aliases: Record<string, string>;
}

export type ClubLink = {
  clubEntity: string;
  clubName: string;
  target: { kind: 'existing'; clubId: string } | { kind: 'new' };
  certainty: 'sure' | 'doubtful' | 'new';
  candidates: { clubId: string; name: string }[];
  /** Remarque (ex. deux entités FFK portent le même nom de club). */
  warning?: string;
};

export type FighterDecision = string | 'new';

export interface FfkChoices {
  /** clubEntity → id de club existant, ou 'new'. */
  clubLinks?: Record<string, string>;
  /** FfkRow.key → id de combattant existant, ou 'new'. */
  decisions?: Record<string, FighterDecision>;
}

export type PlanItem =
  | { kind: 'create'; row: FfkRow; fighterId: string | 'new'; weightClassId: string | null }
  | { kind: 'update'; row: FfkRow; registrationId: string; fighterId: string; weightClassId: string | null; changes: string[] }
  | { kind: 'doubtful'; row: FfkRow; candidates: { fighterId: string; label: string; reason: string }[] }
  | { kind: 'error'; row: FfkRow };

export interface FfkImportPlan {
  clubs: ClubLink[];
  items: PlanItem[];
  newWeightClasses: WeightClass[];
  removals: { registrationId: string; label: string }[];
  unconfirmed: { registrationId: string; label: string }[];
  summary: { create: number; update: number; doubtful: number; errors: number; removals: number; newWeightClasses: number };
}

function levenshtein(a: string, b: string): number {
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

function linkClubs(rows: FfkRow[], existing: ExistingData, choices: FfkChoices): ClubLink[] {
  const entities = new Map<string, string>();
  for (const r of rows) if (r.clubEntity) entities.set(r.clubEntity, r.clubName ?? r.clubEntity);
  const sameName = (name: string) => [...entities.values()].filter((n) => normalizeName(n) === normalizeName(name)).length > 1;
  return [...entities].map(([clubEntity, clubName]): ClubLink => {
    const link = linkOne(clubEntity, clubName);
    return sameName(clubName) ? { ...link, warning: `Plusieurs entités FFK portent le même nom de club « ${clubName} » : vérifier le lien.` } : link;
  });

  function linkOne(clubEntity: string, clubName: string): ClubLink {
    const key = normalizeName(clubName);
    const containing = existing.clubs.filter((c) => {
      const k = normalizeName(c.name);
      return k !== key && k.length >= 3 && (key.includes(k) || k.includes(key));
    });
    const candidates = containing.map((c) => ({ clubId: c.id, name: c.name }));
    const chosen = choices.clubLinks?.[clubEntity];
    if (chosen === 'new') return { clubEntity, clubName, target: { kind: 'new' }, certainty: 'sure', candidates };
    if (chosen && existing.clubs.some((c) => c.id === chosen)) {
      return { clubEntity, clubName, target: { kind: 'existing', clubId: chosen }, certainty: 'sure', candidates };
    }
    const byEntity = existing.clubs.find((c) => c.ffkEntity === clubEntity);
    const byAlias = existing.clubs.find((c) => existing.aliases[normalizeName(c.name)] === clubEntity);
    const byName = existing.clubs.find((c) => normalizeName(c.name) === key);
    const sure = byEntity ?? byAlias ?? byName;
    if (sure) return { clubEntity, clubName, target: { kind: 'existing', clubId: sure.id }, certainty: 'sure', candidates };
    if (containing.length) {
      return { clubEntity, clubName, target: { kind: 'existing', clubId: containing[0]!.id }, certainty: 'doubtful', candidates };
    }
    return { clubEntity, clubName, target: { kind: 'new' }, certainty: 'new', candidates };
  }
}

const fighterLabel = (f: Fighter, clubs: Club[]) =>
  `${f.lastName} ${f.firstName}${f.clubId ? ` (${clubs.find((c) => c.id === f.clubId)?.name ?? '?'})` : ''}`;

export function planFfkImport(rows: FfkRow[], grid: CategoryGrid, existing: ExistingData, choices: FfkChoices = {}): FfkImportPlan {
  const clubs = linkClubs(rows, existing, choices);
  const clubOf = (row: FfkRow): string | null => {
    const link = clubs.find((c) => c.clubEntity === row.clubEntity);
    return link?.target.kind === 'existing' ? link.target.clubId : null;
  };

  // Catégories de poids : existantes ou à créer.
  const newWeightClasses: WeightClass[] = [];
  const weightClassIdFor = (row: FfkRow): string | null => {
    if (!row.weightLabel || !row.ageBandCode || !row.sex) return null;
    const found = weightClassesFor(grid, row.ageBandCode, row.sex).find((w) => w.label === row.weightLabel);
    if (found) return found.id;
    const id = `${row.ageBandCode}:${row.sex}:${row.weightLabel}`;
    if (!newWeightClasses.some((w) => w.id === id)) {
      const parsed = parseWeightLabel(row.weightLabel)!;
      newWeightClasses.push({ id, ageBandCode: row.ageBandCode, sex: row.sex, label: parsed.label, maxKg: parsed.maxKg, sortOrder: 0 });
    }
    return id;
  };
  const labelOf = (id: string | null) =>
    id ? (grid.weightClasses.find((w) => w.id === id) ?? newWeightClasses.find((w) => w.id === id))?.label ?? '?' : '—';
  const bandLabel = (code: string) => grid.ageBands.find((b) => b.code === code)?.label ?? code;

  const items: PlanItem[] = [];
  const seenLicence = new Map<string, number>();
  const usedRegistrations = new Set<string>();
  /** Combattant → licence de la ligne qui l'a déjà réclamé dans cet import. */
  const claimedBy = new Map<string, string | null>();
  const keyOf = (f: Fighter) => normalizeName(`${f.lastName} ${f.firstName}`);

  /** Une ligne en erreur mais reconnue garde son inscription (jamais retirée). */
  const keepMatched = (row: FfkRow) => {
    const clubId = clubOf(row);
    const full = normalizeName(`${row.lastName} ${row.firstName}`);
    const f =
      (row.licence ? existing.fighters.find((x) => x.licence === row.licence) : undefined) ??
      (() => {
        const exact = existing.fighters.filter((x) => clubId && x.clubId === clubId && keyOf(x) === full);
        return exact.length === 1 ? exact[0] : undefined;
      })();
    if (!f) return;
    for (const r of existing.registrations) {
      if (r.fighterId === f.id && (!row.discipline || (r.original?.discipline ?? r.discipline) === row.discipline)) usedRegistrations.add(r.id);
    }
  };

  for (const row of rows) {
    if (row.errors.length || !row.sex || !row.discipline || !row.ageBandCode) {
      keepMatched(row);
      items.push({ kind: 'error', row });
      continue;
    }
    if (row.licence) {
      const k = `${row.licence}|${row.discipline}`;
      const first = seenLicence.get(k);
      if (first !== undefined) {
        items.push({ kind: 'error', row: { ...row, errors: [`Ligne en double : même licence et même discipline que la ligne ${first}.`] } });
        continue;
      }
      seenLicence.set(k, row.line);
    }
    const weightClassId = weightClassIdFor(row);
    const clubId = clubOf(row);
    const fullKey = normalizeName(`${row.lastName} ${row.firstName}`);
    const reversedKey = normalizeName(`${row.firstName} ${row.lastName}`);
    // Un combattant qui a déjà une autre licence n'est jamais le même que cette ligne.
    const sameSex = existing.fighters.filter((f) => f.sex === row.sex && !(row.licence && f.licence && f.licence !== row.licence));
    // Conflit seulement entre deux licences différentes (une ligne sans licence ne réclame rien).
    const claimedByOther = (f: Fighter) => {
      const other = claimedBy.get(f.id);
      return other !== undefined && other !== null && row.licence !== null && other !== row.licence;
    };

    let fighterId: string | 'new' | null = null;
    let candidates: { fighterId: string; label: string; reason: string }[] = [];
    const decision = choices.decisions?.[row.key];
    if (decision === 'new') fighterId = 'new';
    else if (decision && existing.fighters.some((f) => f.id === decision)) fighterId = decision;
    else {
      const byLicence = row.licence ? existing.fighters.find((f) => f.licence === row.licence) : undefined;
      if (byLicence) fighterId = byLicence.id;
      else {
        const inClub = clubId ? sameSex.filter((f) => f.clubId === clubId) : [];
        const exact = inClub.filter((f) => keyOf(f) === fullKey || keyOf(f) === reversedKey);
        if (exact.length === 1 && claimedByOther(exact[0]!)) {
          candidates = [{ fighterId: exact[0]!.id, label: fighterLabel(exact[0]!, existing.clubs), reason: 'déjà rapproché d’une autre licence dans cet import' }];
        } else if (exact.length === 1) fighterId = exact[0]!.id;
        else if (exact.length > 1) {
          candidates = exact.map((f) => ({ fighterId: f.id, label: fighterLabel(f, existing.clubs), reason: 'homonymes dans le même club' }));
        } else {
          for (const f of inClub) {
            if (normalizeName(f.lastName) === normalizeName(row.lastName)) {
              candidates.push({ fighterId: f.id, label: fighterLabel(f, existing.clubs), reason: 'même nom de famille, prénom différent' });
            } else if (Math.min(levenshtein(keyOf(f), fullKey), levenshtein(keyOf(f), reversedKey)) <= 2) {
              candidates.push({ fighterId: f.id, label: fighterLabel(f, existing.clubs), reason: 'nom très proche' });
            }
          }
          for (const f of sameSex.filter((f) => clubId === null || f.clubId !== clubId)) {
            if (keyOf(f) === fullKey || keyOf(f) === reversedKey) {
              const reason = clubId === null ? 'même nom, club non renseigné' : 'même nom, autre club';
              candidates.push({ fighterId: f.id, label: fighterLabel(f, existing.clubs), reason });
            }
          }
          if (candidates.length === 0) fighterId = 'new';
        }
      }
    }

    if (fighterId === null) {
      items.push({ kind: 'doubtful', row, candidates });
      continue;
    }
    if (fighterId === 'new') {
      items.push({ kind: 'create', row, fighterId: 'new', weightClassId });
      continue;
    }
    if (!claimedBy.has(fighterId)) claimedBy.set(fighterId, row.licence);
    const fighter = existing.fighters.find((f) => f.id === fighterId)!;
    if (decision && decision !== 'new' && existing.registrations.some((r) => r.fighterId === fighterId && (r.original?.discipline ?? r.discipline) === row.discipline && usedRegistrations.has(r.id))) {
      items.push({ kind: 'error', row: { ...row, errors: [`Ce combattant est déjà rapproché d'une autre ligne pour cette discipline.`] } });
      continue;
    }
    const registration = existing.registrations.find(
      (r) => r.fighterId === fighterId && (r.original?.discipline ?? r.discipline) === row.discipline && !usedRegistrations.has(r.id),
    );
    if (!registration) {
      items.push({ kind: 'create', row, fighterId, weightClassId });
      continue;
    }
    usedRegistrations.add(registration.id);
    const changes: string[] = [];
    if (fighter.ageBandCode !== row.ageBandCode) changes.push(`Âge : ${bandLabel(fighter.ageBandCode)} → ${bandLabel(row.ageBandCode)}`);
    const registered = registration.original ?? registration;
    if (registered.weightClassId !== weightClassId) changes.push(`Poids : ${labelOf(registered.weightClassId)} → ${labelOf(weightClassId)}`);
    if (clubId && fighter.clubId !== clubId) changes.push(`Club : ${existing.clubs.find((c) => c.id === fighter.clubId)?.name ?? '—'} → ${row.clubName}`);
    if (row.ruleset && registered.ruleset !== row.ruleset) changes.push(`Règlement : ${registered.ruleset ?? '—'} → ${row.ruleset}`);
    items.push({ kind: 'update', row, registrationId: registration.id, fighterId, weightClassId, changes });
  }

  const describe = (r: Registration) => {
    const f = existing.fighters.find((x) => x.id === r.fighterId);
    return `${f ? `${f.lastName} ${f.firstName}` : '?'} — ${DISCIPLINES[r.discipline].label}`;
  };
  const importedDisciplines = new Set(rows.map((r) => r.discipline).filter(Boolean));
  const removals = existing.registrations
    .filter((r) => r.source === 'ffk' && !usedRegistrations.has(r.id) && importedDisciplines.has(r.discipline))
    .map((r) => ({ registrationId: r.id, label: describe(r) }));
  const unconfirmed = existing.registrations
    .filter((r) => r.source !== 'ffk' && !usedRegistrations.has(r.id))
    .map((r) => ({ registrationId: r.id, label: describe(r) }));

  const count = (k: PlanItem['kind']) => items.filter((i) => i.kind === k).length;
  return {
    clubs,
    items,
    newWeightClasses,
    removals,
    unconfirmed,
    summary: {
      create: count('create'),
      update: count('update'),
      doubtful: count('doubtful'),
      errors: count('error'),
      removals: removals.length,
      newWeightClasses: newWeightClasses.length,
    },
  };
}

/** Empreinte d'un plan : la validation est refusée si le plan a changé depuis l'aperçu. */
export function planFingerprint(plan: FfkImportPlan): string {
  const data = JSON.stringify({
    s: plan.summary,
    i: plan.items.map((i) => [i.kind, i.row.key, 'registrationId' in i ? i.registrationId : '', 'fighterId' in i ? i.fighterId : '', 'weightClassId' in i ? i.weightClassId : '']),
    r: plan.removals.map((r) => r.registrationId),
    u: plan.unconfirmed.map((r) => r.registrationId),
    w: plan.newWeightClasses.map((w) => w.id),
    c: plan.clubs.map((c) => [c.clubEntity, c.target.kind === 'existing' ? c.target.clubId : 'new']),
  });
  let h = 5381;
  for (let i = 0; i < data.length; i++) h = ((h * 33) ^ data.charCodeAt(i)) >>> 0;
  return h.toString(16);
}
