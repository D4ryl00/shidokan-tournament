import { activeEntrantCount, categoryLabelParts, compareKeys, isFreeKey, type Category } from '../../../domain/categories.js';
import { normalizeName } from '../../../domain/names.js';
import type { CategoryGrid } from '../../../domain/types.js';

export type PlancheSort = 'categorie' | 'zone';
export interface PlancheGroup { key: string; title: string; categories: Category[] }

export const FREE_GROUP_TITLE = 'Tableaux libres';
export const NO_ZONE_TITLE = 'Sans zone';

/** Première tranche d'âge (dans l'ordre de la grille) : un regroupement de tranches va dans le groupe de la première. */
function firstBand(c: Category, grid: CategoryGrid): { code: string; label: string } {
  const idx = (code: string) => { const i = grid.ageBands.findIndex((b) => b.code === code); return i < 0 ? Number.MAX_SAFE_INTEGER : i; };
  const code = [...c.key.ageBandCodes].sort((a, b) => idx(a) - idx(b))[0] ?? '';
  return { code, label: grid.ageBands.find((b) => b.code === code)?.label ?? code };
}

/** « Karaté · Jiyu — Benjamins », « Kata — Minimes », « Tableaux libres ». */
export function groupTitle(c: Category, grid: CategoryGrid): string {
  if (isFreeKey(c.key)) return FREE_GROUP_TITLE;
  const p = categoryLabelParts(c.key, grid);
  return `${[p.discipline, ...(p.ruleset ? [p.ruleset] : [])].join(' · ')} — ${firstBand(c, grid).label}`;
}

const groupKey = (c: Category, grid: CategoryGrid): string =>
  isFreeKey(c.key) ? 'libres' : `${c.key.discipline}|${c.key.ruleset ?? ''}|${firstBand(c, grid).code}`;

/** Libellé sans la discipline ni le règlement (le groupe les donne) : « Benjamins F · -35 kg » ; tableau libre : son nom. */
export function cardTitle(c: Category, grid: CategoryGrid): string {
  if (isFreeKey(c.key)) return c.key.free ?? c.label;
  const p = categoryLabelParts(c.key, grid);
  return [`${p.ages} ${p.sex}`, ...(p.weights ? [p.weights] : [])].join(' · ');
}

export function plancheGroups(cats: Category[], o: {
  sort: PlancheSort; grid: CategoryGrid; zoneOf: (c: Category) => { id: string; name: string } | null; zoneOrder: string[];
}): PlancheGroup[] {
  const sorted = [...cats].sort((a, b) => compareKeys(a.key, b.key, o.grid));
  const groups = new Map<string, PlancheGroup>();
  const add = (key: string, title: string, c: Category) => {
    const g = groups.get(key);
    if (g) g.categories.push(c);
    else groups.set(key, { key, title, categories: [c] });
  };
  if (o.sort === 'categorie') {
    for (const c of sorted) add(groupKey(c, o.grid), groupTitle(c, o.grid), c);
    return [...groups.values()];
  }
  for (const c of sorted) {
    const z = o.zoneOf(c);
    if (z) add(`zone:${z.id}`, z.name, c);
    else add('sans-zone', NO_ZONE_TITLE, c);
  }
  const rank = (g: PlancheGroup) => {
    if (g.key === 'sans-zone') return Number.MAX_SAFE_INTEGER;
    const i = o.zoneOrder.indexOf(g.key.slice(5));
    return i < 0 ? Number.MAX_SAFE_INTEGER - 1 : i;
  };
  return [...groups.values()].sort((a, b) => rank(a) - rank(b));
}

export function plancheFilter(cats: Category[], o: { query: string; names: Map<string, string>; onlyTodo: boolean; cases: Map<string, number> }): Category[] {
  const words = normalizeName(o.query).split(' ').filter(Boolean);
  return cats.filter((c) => {
    if (o.onlyTodo && activeEntrantCount(c) !== 1 && !(o.cases.get(c.id) ?? 0)) return false;
    if (words.length === 0) return true;
    const hay = normalizeName([c.label, ...c.registrationIds.map((r) => o.names.get(r) ?? '')].join(' '));
    return words.every((w) => hay.includes(w));
  });
}

/** Le seul présent de chaque catégorie qui n'en a qu'un (session affichée et catégories en attente ; toutes avec `scopeAll`). */
export function loneFighters(cats: Category[], o: { waveId: string | null; scopeAll: boolean }): { categoryId: string; registrationId: string }[] {
  const out: { categoryId: string; registrationId: string }[] = [];
  for (const c of cats) {
    if (c.status === 'started' || c.status === 'finished') continue;
    if (!(o.scopeAll || o.waveId === null || c.waveId === null || c.waveId === o.waveId)) continue;
    const present = c.registrationIds.filter((r) => !c.absentIds.includes(r));
    if (present.length === 1) out.push({ categoryId: c.id, registrationId: present[0]! });
  }
  return out;
}

/** Au moins un présent, ou tableau libre (toujours une carte, même vide). */
export const shownOnPlanche = (c: Category): boolean => isFreeKey(c.key) || activeEntrantCount(c) > 0;

export interface CardSection { label: string; ids: string[] }

/** Contenu réduit d'une carte : par combat du 1er tour (« COMBAT 1 », « EXEMPT »), par poule, ordre de passage (kata) ou « SANS ADVERSAIRE ». */
export function cardSections(c: Category): CardSection[] {
  const locked = c.status === 'started' || c.status === 'finished';
  const present = (ids: string[]) => ids.filter((r) => locked || !c.absentIds.includes(r));
  const all = present(c.registrationIds);
  if (all.length === 0) return [];
  if (activeEntrantCount(c) === 1) return [{ label: 'SANS ADVERSAIRE', ids: all }];
  const b = c.bracket;
  if (!b) return [{ label: 'INSCRITS', ids: all }];
  if (b.kind === 'kata') return [{ label: 'ORDRE DE PASSAGE', ids: present(b.order) }];
  if (b.pools?.length) return b.pools.map((p, i) => ({ label: `POULE ${String.fromCharCode(65 + i)}`, ids: present(p) }));
  const first = b.matches.filter((m) => m.phase === 'main' && m.round === 1).sort((x, y) => x.order - y.order);
  const out: CardSection[] = [];
  let n = 0;
  for (const m of first) {
    const ids = [m.a, m.b].flatMap((s) => (s.kind === 'entrant' ? [s.registrationId] : []));
    if (ids.length === 2) { n += 1; out.push({ label: `COMBAT ${n}`, ids: present(ids) }); }
    else if (ids.length === 1) out.push({ label: 'EXEMPT', ids: present(ids) });
  }
  return out.length ? out : [{ label: 'INSCRITS', ids: all }];
}

/** Ce que fait le dépôt d'une pastille (spec §2.6) ; `from` / `to` : catégories de départ et d'arrivée. */
export type DropAction = { kind: 'swap' | 'exchange' | 'move'; from: string; to: string } | { kind: 'none' } | { kind: 'locked' };

export const LOCKED_DROP = 'Catégorie lancée : déverrouillez-la d’abord.';

/** Catégorie lancée, terminée, ou de session lancée : rien n'y entre ni n'en sort. */
export const isLockedCategory = (c: Pick<Category, 'status' | 'launchLocked'> | undefined): boolean =>
  !!c && (c.status === 'started' || c.status === 'finished' || !!c.launchLocked);

/** `dropAction`, les verrous déjà connus (pastilles et cartes les portent). */
export function dropKind(
  src: { registrationId: string; categoryId: string; locked: boolean },
  target: { registrationId?: string; categoryId: string; locked: boolean },
): DropAction {
  if (target.registrationId === src.registrationId || (target.registrationId === undefined && target.categoryId === src.categoryId)) return { kind: 'none' };
  if (src.locked || target.locked) return { kind: 'locked' };
  const kind = target.categoryId === src.categoryId ? 'swap' : target.registrationId !== undefined ? 'exchange' : 'move';
  return { kind, from: src.categoryId, to: target.categoryId };
}

/**
 * Pastille déposée sur une pastille ou une carte : même pastille ou sa propre carte → rien ; une catégorie verrouillée → refusé ;
 * même catégorie → échange de places ; pastille d'une autre catégorie → échange ; carte d'une autre catégorie → déplacement.
 */
export function dropAction(src: { registrationId: string; categoryId: string }, target: { registrationId?: string; categoryId: string }, cats: Category[]): DropAction {
  const locked = (id: string) => isLockedCategory(cats.find((c) => c.id === id));
  return dropKind({ ...src, locked: locked(src.categoryId) }, { ...target, locked: locked(target.categoryId) });
}
