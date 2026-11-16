import { DISCIPLINES } from '../disciplines.js';
import type { FfkRow } from '../ffk-import.js';
import type { CategoryGrid, WeightClass } from '../types.js';
import { buildCards, type ExistingFighter, type FfkCardDraft } from './cards.js';
import { linkClubs, type ClubLink, type ExistingClub } from './clubs.js';
import { cardChanges, ffkCardDiffs, FIELD_LABELS, initialValue, missingFields, type ChangeLabels, type FfkCardDiff, type FfkCardValue } from './values.js';

/** Ce que le plan connaît de la compétition. */
export interface ExistingData {
  clubs: ExistingClub[];
  fighters: ExistingFighter[];
  /** nameKey d’un club → entité FFK, mémorisé d’une compétition à l’autre. */
  aliases: Record<string, string>;
}

/** Décision de l’organisateur sur une carte : ne pas lier, écarter, ou valider (combattant + valeurs à enregistrer). */
export type FfkCardChoice = { kind: 'none' } | { kind: 'skip' } | { kind: 'validated'; fighterId: string | 'new'; value: FfkCardValue };

export interface FfkChoices {
  /** Catégories de poids absentes de la grille, cochées pour être créées. */
  acceptedWeightClasses?: string[];
  /** Entité FFK → id de club, ou `'none'` (ne pas relier pour l’instant). */
  clubLinks?: Record<string, string | 'none'>;
  /** `FfkCardDraft.key` → choix. */
  cards?: Record<string, FfkCardChoice>;
  /** Combattant sans inscription FFK → action (défaut « keep »). */
  orphans?: Record<string, 'keep' | 'delete'>;
}

export type FfkCardState = 'todo' | 'auto' | 'done' | 'skip';

export interface FfkCard extends FfkCardDraft {
  state: FfkCardState;
  /** Combattant retenu (choix validé, ou rapprochement sûr par défaut) ; `null` = pas lié. */
  fighterId: string | 'new' | null;
  /** Valeur importée si la carte est `auto` ou `done`. */
  value: FfkCardValue | null;
  /** Écarts avec le combattant retenu (à défaut le sûr). */
  diffs: FfkCardDiff[];
  missing: string[];
  changes: string[];
  /** Pourquoi la carte est laissée de côté (`todo`). */
  reason: string | null;
  /** Version de la fiche retenue (empreinte de l’aperçu) ; `null` pour un nouveau combattant ou une carte non liée. */
  version: string | null;
}

export interface FfkOrphan {
  fighterId: string;
  label: string;
  clubName: string;
  disciplines: string;
  /** A une inscription venue d’un import FFK précédent. */
  fromFfk: boolean;
  action: 'keep' | 'delete';
  version: string;
}

export interface FfkCardsPlan {
  weightClasses: (WeightClass & { rows: number; accepted: boolean })[];
  clubs: ClubLink[];
  cards: FfkCard[];
  orphans: FfkOrphan[];
  summary: { todo: number; auto: number; done: number; skip: number; clubsTodo: number; creates: number; updates: number; deletes: number };
}

/** Combattant de la compétition tel que la page le cherche (« Pas dans la liste ? ») : tout `ExistingFighter`, plus de quoi l’afficher. */
export interface FfkSearchFighter extends ExistingFighter {
  /** « NOM Prénom ». */
  label: string;
  clubName: string;
  ageLabel: string;
  /** « Karaté, Kata ». */
  disciplines: string;
}

/** Résultat de l’import : `deleted` = fiches supprimées, `leftAside` = cartes laissées de côté (à trancher ou écartées). */
export interface FfkImportResult {
  created: number;
  updated: number;
  deleted: number;
  weightClassesCreated: number;
  leftAside: number;
}

/** Libellés d’un combattant : nom, club, catégorie d’âge, disciplines en clair. */
export function fighterDisplay(f: ExistingFighter, clubs: ExistingClub[], grid: CategoryGrid): Pick<FfkSearchFighter, 'label' | 'clubName' | 'ageLabel' | 'disciplines'> {
  const disciplines = [...f.line.combats.map((d) => DISCIPLINES[d].label), ...(f.line.kata ? [DISCIPLINES.kata.label] : [])];
  const age = f.line.ageBandCode;
  return {
    label: `${f.line.lastName} ${f.line.firstName}`,
    clubName: (f.clubId && clubs.find((c) => c.id === f.clubId)?.name) || 'Sans club',
    ageLabel: age ? (grid.ageBands.find((b) => b.code === age)?.label ?? age) : '—',
    disciplines: disciplines.join(', ') || '—',
  };
}

/** Tous les combattants de la compétition, pour la recherche de la page. */
export const searchableFighters = (existing: ExistingData, grid: CategoryGrid): FfkSearchFighter[] =>
  existing.fighters.map((f) => ({ ...f, ...fighterDisplay(f, existing.clubs, grid) }));

export const ALREADY_RETAINED = 'combattant déjà retenu par une autre carte';

/** Libellés de « Ce qui change », tirés de la grille (et des catégories nouvelles) et des clubs. */
function changeLabels(grid: CategoryGrid, added: WeightClass[], clubs: ExistingClub[]): ChangeLabels {
  return {
    ageBand: (code) => grid.ageBands.find((b) => b.code === code)?.label ?? code,
    weightClass: (id) => {
      const w = [...grid.weightClasses, ...added].find((x) => x.id === id);
      return w ? `${w.label} kg` : id;
    },
    discipline: (d) => DISCIPLINES[d]?.label ?? d,
    ruleset: (r) => (r === 'shobu' ? 'Shobu' : 'Jiyu'),
    club: (id) => clubs.find((c) => c.id === id)?.name ?? id,
  };
}

const unique = (items: string[]) => [...new Set(items)];

/** Ce qu’une valeur validée peut désigner : catégories de poids de la grille (et nouvelles cochées), clubs de la compétition. */
interface Known {
  weightClassIds: ReadonlySet<string>;
  clubIds: ReadonlySet<string>;
}

function planCard(draft: FfkCardDraft, choice: FfkCardChoice | undefined, fighters: Map<string, ExistingFighter>, labels: ChangeLabels, known: Known): FfkCard {
  const fighter = (id: string | null) => (id && id !== 'new' ? (fighters.get(id) ?? null) : null);
  const base: FfkCard = {
    ...draft, state: 'todo', fighterId: null, value: null, diffs: ffkCardDiffs(draft, fighter(draft.sure)), missing: [], changes: [], reason: null, version: null,
  };
  const retained = (fighterId: string | 'new', value: FfkCardValue, saved: ExistingFighter | null, state: 'auto' | 'done'): FfkCard => ({
    ...base, state, fighterId, value, diffs: ffkCardDiffs(draft, saved), changes: cardChanges(saved, value, labels), version: saved?.version ?? null,
  });

  if (choice?.kind === 'skip') return { ...base, state: 'skip' };
  if (choice?.kind === 'none') return { ...base, reason: 'combattant pas choisi' };
  if (choice?.kind === 'validated') {
    const saved = fighter(choice.fighterId);
    if (choice.fighterId !== 'new' && !saved) return { ...base, reason: 'combattant introuvable' };
    const missing = missingFields(choice.value);
    if (missing.length) return { ...base, diffs: ffkCardDiffs(draft, saved), missing, reason: `reste à remplir : ${missing.join(', ')}` };
    // Valeur devenue impossible depuis sa validation (catégorie décochée, club supprimé) : jamais écrite.
    const { line } = choice.value;
    if (line.combats.length && line.weightClassId && !known.weightClassIds.has(line.weightClassId)) {
      return { ...base, diffs: ffkCardDiffs(draft, saved), reason: 'catégorie de poids absente de la grille' };
    }
    if (!known.clubIds.has(choice.value.clubId!)) return { ...base, diffs: ffkCardDiffs(draft, saved), reason: 'club introuvable' };
    return retained(choice.fighterId, choice.value, saved, 'done');
  }

  // Par défaut : lié d’office seulement si le rapprochement est sûr (ou sans candidat, club relié) et qu’il ne reste rien à choisir.
  const target = draft.sure ?? (draft.candidates.length === 0 && draft.clubId ? 'new' : null);
  if (target === null) return { ...base, reason: draft.candidates.length ? 'combattant pas choisi' : 'club pas relié' };
  const saved = fighter(target);
  const value = initialValue(draft, saved);
  const diffs = ffkCardDiffs(draft, saved);
  const missing = missingFields(value);
  const errors = unique(draft.rows.flatMap((r) => r.errors));
  if (errors.length) return { ...base, diffs, missing, reason: `ligne à vérifier : ${errors.join(' ')}` };
  const toFill = unique([...missing, ...diffs.map((d) => FIELD_LABELS[d.field])]);
  if (toFill.length || draft.weightIssue) return { ...base, diffs, missing, reason: `reste à remplir : ${toFill.length ? toFill.join(', ') : FIELD_LABELS.weightClassId}` };
  return retained(target, value, saved, 'auto');
}

/** Plan de l’import FFK par cartes : un combattant de l’export par carte, son état, les fiches sans inscription FFK. */
export function planFfkCards(rows: FfkRow[], grid: CategoryGrid, existing: ExistingData, choices: FfkChoices = {}): FfkCardsPlan {
  const entities = new Map<string, { clubEntity: string; clubName: string; rows: number }>();
  for (const r of rows) {
    if (!r.clubEntity) continue;
    const e = entities.get(r.clubEntity);
    if (e) e.rows++;
    else entities.set(r.clubEntity, { clubEntity: r.clubEntity, clubName: r.clubName ?? r.clubEntity, rows: 1 });
  }
  const clubs = linkClubs([...entities.values()], existing.clubs, existing.aliases, choices.clubLinks);
  const accepted = new Set(choices.acceptedWeightClasses ?? []);
  const { cards: drafts, newWeightClasses } = buildCards(rows, clubs, existing.fighters, grid, accepted);
  const labels = changeLabels(grid, newWeightClasses, existing.clubs);
  const byId = new Map(existing.fighters.map((f) => [f.fighterId, f]));

  const known: Known = {
    weightClassIds: new Set([...grid.weightClasses, ...newWeightClasses.filter((w) => accepted.has(w.id))].map((w) => w.id)),
    clubIds: new Set(existing.clubs.map((c) => c.id)),
  };
  const cards = drafts.map((d) => planCard(d, choices.cards?.[d.key], byId, labels, known));
  // Un combattant n’est écrit que par une carte : un choix validé passe avant un rapprochement d’office, puis l’ordre de l’export.
  const claimed = new Set<string>();
  for (const pass of ['done', 'auto'] as const) {
    cards.forEach((c, i) => {
      if (c.state !== pass || !c.fighterId || c.fighterId === 'new') return;
      if (claimed.has(c.fighterId)) cards[i] = { ...c, state: 'todo', fighterId: null, value: null, changes: [], version: null, reason: ALREADY_RETAINED };
      else claimed.add(c.fighterId);
    });
  }

  // Fiches sans inscription FFK : aucune carte ne les retient, et elles ne sont candidates d’aucune carte laissée de côté.
  const concerned = new Set(claimed);
  for (const c of cards) if (c.state === 'todo' || c.state === 'skip') for (const k of c.candidates) concerned.add(k.fighterId);
  const orphans = existing.fighters
    .filter((f) => !concerned.has(f.fighterId))
    .map((f): FfkOrphan => {
      const { label, clubName, disciplines } = fighterDisplay(f, existing.clubs, grid);
      return { fighterId: f.fighterId, label, clubName, disciplines, fromFfk: f.fromFfk, action: choices.orphans?.[f.fighterId] ?? 'keep', version: f.version };
    });

  const count = (s: FfkCardState) => cards.filter((c) => c.state === s).length;
  const imported = cards.filter((c) => c.state === 'auto' || c.state === 'done');
  return {
    weightClasses: newWeightClasses.map((w) => ({ ...w, accepted: accepted.has(w.id) })),
    clubs,
    cards,
    orphans,
    summary: {
      todo: count('todo'),
      auto: count('auto'),
      done: count('done'),
      skip: count('skip'),
      clubsTodo: clubs.filter((c) => c.target === null).length,
      creates: imported.filter((c) => c.fighterId === 'new').length,
      updates: imported.filter((c) => c.fighterId !== 'new' && c.changes.length > 0).length,
      deletes: orphans.filter((o) => o.action === 'delete').length,
    },
  };
}

/** JSON aux clés triées : deux objets égaux donnent le même texte, quel que soit l’ordre de leurs clés. */
function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (v && typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, x]) => `${JSON.stringify(k)}:${stableJson(x)}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

/**
 * Empreinte d’un plan : l’import est refusé si elle a changé depuis l’aperçu. Elle couvre les cartes (clé, état, combattant,
 * valeur, version de la fiche retenue), les liens de club, les catégories acceptées, les fiches sans inscription FFK et la
 * version de celles à supprimer.
 */
export function planFingerprint(plan: FfkCardsPlan): string {
  const data = stableJson({
    w: plan.weightClasses.filter((w) => w.accepted).map((w) => w.id),
    c: plan.clubs.map((c) => [c.clubEntity, c.target]),
    k: plan.cards.map((c) => [c.key, c.state, c.fighterId, c.value, c.version]),
    o: plan.orphans.map((o) => [o.fighterId, o.action, o.action === 'delete' ? o.version : null]),
  });
  let h = 5381;
  for (let i = 0; i < data.length; i++) h = ((h * 33) ^ data.charCodeAt(i)) >>> 0;
  return h.toString(16);
}
