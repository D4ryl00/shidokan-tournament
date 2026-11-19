import { categoryLabel, keyString, naturalKey } from './categories.js';
import { DISCIPLINES } from './disciplines.js';
import { activeMembers, effectiveWeight, weighInClass } from './replacement/weights.js';
import { memberWave } from './replacement/waves.js';
import type { Member, State } from './replacement/types.js';
import type { AgeBand, CategoryGrid, DisciplineId, Ruleset, Sex, WeightClass } from './types.js';
import { waveOfCategory } from './waves.js';

/** Demandes à faire aux coachs (spec étape 45 §7.1) : calcul pur depuis l'état de la réaffectation. */

export type AuthorizationKind = 'age' | 'weight' | 'missingWeight' | 'discipline' | 'mixite' | 'session';
/** Le poids manquant n'est pas un accord : il se règle quand un poids est saisi. */
export type AnswerableKind = Exclude<AuthorizationKind, 'missingWeight'>;
export type AuthorizationSituation =
  | { kind: 'age'; ownBand: string; strongerBands: string[] }
  | { kind: 'weight'; ownClassId: string; heaviestClassId: string; gapKg: number }
  | { kind: 'missingWeight'; ownClassId: string; heaviestClassId: string }
  | { kind: 'discipline'; from: { discipline: DisciplineId; ruleset: Ruleset | null }; to: { discipline: DisciplineId; ruleset: Ruleset | null } }
  | { kind: 'mixite' }
  | { kind: 'session'; from: string | null; to: string | null };

/** Entrée active de l'historique (déplacement) : sert à retrouver les déplacements en cause. */
export interface BlameMove {
  entryId: string;
  seq: number;
  registrationIds: string[];
}

export interface AuthorizationRequest {
  /** `${kind}:${registrationId}` */
  id: string;
  registrationId: string;
  clubId: string | null;
  categoryId: string;
  situation: AuthorizationSituation;
  /** Inscription d'origine : « Karaté Jiyu · Benjamines −40 ». */
  current: string;
  /** Libellé du groupe actuel, ou « reste en … et reçoit … » pour un combattant resté sur place. */
  proposed: string;
  /** Phrase pour le coach. */
  bullet: string;
  /** Ids d'entrées d'historique en cause, plus récente d'abord. */
  blame: string[];
}

/** Seuil inclusif de l'organisateur : au-delà (après arrondi), un accord est nécessaire. */
const GAP_LIMIT_KG = 5;
const KIND_ORDER: AuthorizationKind[] = ['session', 'discipline', 'age', 'mixite', 'weight', 'missingWeight'];

/** Écart arrondi au dixième, demi vers le haut, calculé en centièmes entiers (5,05 → 5,1 malgré le flottant). */
export function roundGap(gapKg: number): number {
  const hundredths = Math.round(gapKg * 100);
  // Un nombre entier de centièmes / 10 tombe pile sur ,5 quand il le faut : l'arrondi ne se trompe plus.
  return Math.round(hundredths / 10) / 10;
}

/** « 5 kg », « 7,3 kg ». */
export function gapText(gapKg: number): string {
  return `${roundGap(gapKg).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} kg`;
}

// --- Rangs -------------------------------------------------------------------------------------------------------

/** Rang d'âge comparable : mineurs par âge, puis vétérans du plus âgé au plus jeune, puis Espoirs et Seniors. */
function ageRank(band: AgeBand | undefined): [number, number] {
  if (!band) return [0, 0];
  if (band.isMinor) return [0, band.minAge];
  return band.minAge < 35 ? [2, 0] : [1, -band.minAge];
}
const compareRank = (a: [number, number], b: [number, number]) => a[0] - b[0] || a[1] - b[1];

/** Rang de poids : limite d'une catégorie bornée ; une ouverte au-dessus de toutes, comparée à une autre par son seuil. */
function weightRank(grid: CategoryGrid, wc: WeightClass): [number, number] {
  if (wc.maxKg !== null) return [0, wc.maxKg];
  const limits = grid.weightClasses.filter((w) => w.ageBandCode === wc.ageBandCode && w.sex === wc.sex && w.maxKg !== null).map((w) => w.maxKg!);
  return [1, limits.length ? Math.max(...limits) : 0];
}

/** Catégorie de poids de référence : celle de la pesée, sinon celle de l'inscription d'origine. */
function referenceClass(state: State, m: Member): WeightClass | null {
  const weighed = weighInClass(m, state);
  if (weighed) return weighed;
  const id = m.original?.weightClassId ?? m.weightClassId;
  return state.grid.weightClasses.find((w) => w.id === id) ?? null;
}

const hundredths = (kg: number) => Math.round(kg * 100);
const hasWeight = (m: Member) => m.weighInKg !== null || m.approxWeightKg !== null;

// --- Libellés ----------------------------------------------------------------------------------------------------

/** « Benjamins » → « Benjamines », « Cadets » → « Cadettes » pour les filles. */
function bandLabel(grid: CategoryGrid, code: string, sex: Sex | 'X'): string {
  const label = grid.ageBands.find((b) => b.code === code)?.label ?? code;
  return sex === 'F' ? label.replace(/ins\b/g, 'ines').replace(/ets\b/g, 'ettes') : label;
}
const weightLabel = (wc: WeightClass | undefined) => (wc ? wc.label.replace(/^-/, '−') : '');
const disciplineText = (d: { discipline: DisciplineId; ruleset: Ruleset | null }) =>
  [DISCIPLINES[d.discipline].label, ...(d.ruleset ? [d.ruleset === 'jiyu' ? 'Jiyu' : 'Shobu'] : [])].join(' ');
const bandOrder = (grid: CategoryGrid, code: string) => {
  const i = grid.ageBands.findIndex((b) => b.code === code);
  return i < 0 ? Number.MAX_SAFE_INTEGER : i;
};
const byGridOrder = (grid: CategoryGrid, codes: Iterable<string>) =>
  [...new Set(codes)].sort((a, b) => bandOrder(grid, a) - bandOrder(grid, b) || a.localeCompare(b));

/** Valeurs d'origine de l'inscription. */
const originOf = (m: Member) => ({
  discipline: m.original?.discipline ?? m.discipline,
  ruleset: m.original ? m.original.ruleset : m.ruleset,
  weightClassId: m.original ? m.original.weightClassId : m.weightClassId,
});

/** « Benjamines −40 » : tranche et catégorie de poids d'origine. */
function bandAndWeight(state: State, m: Member, wc: WeightClass | undefined): string {
  return [bandLabel(state.grid, m.ageBandCode, m.sex), ...(wc ? [weightLabel(wc)] : [])].join(' ');
}
const originClass = (state: State, m: Member) => state.grid.weightClasses.find((w) => w.id === originOf(m).weightClassId);

const byUnique = (xs: string[]) => [...new Set(xs)];
/** Le nom du club n'est pas dans l'état : regroupement par identifiant, sans club en dernier (le serveur trie par nom). */
const compareClub = (a: string | null, b: string | null) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a.localeCompare(b));

const waveName = (state: State, id: string) => state.waves.find((w) => w.id === id)?.name ?? id;

// --- Calcul ------------------------------------------------------------------------------------------------------

/**
 * Session de la catégorie d'origine : choix individuel d'une catégorie dont la clé est exactement la clé d'origine (non
 * fusionnée), sinon les règles. Le choix d'un groupe fusionné (clé d'origine dans `aliasKeys` seulement) est sa session
 * actuelle, pas celle d'origine.
 */
function originWave(state: State, m: Member): string | null {
  const o = originOf(m);
  const key = naturalKey(o, m);
  const ks = keyString(key);
  const cat = state.categories.find((c) => keyString(c.key) === ks);
  return waveOfCategory({ key, waveOverride: cat?.waveOverride ?? null }, state.waves, state.grid);
}

interface Draft {
  situation: AuthorizationSituation;
  bullet: string;
  /** Adversaires qui créent la demande (blâme, « reçoit »). */
  causes: Member[];
}

function requestsFor(state: State, m: Member, group: Member[]): Draft[] {
  const grid = state.grid;
  const out: Draft[] = [];
  const opponents = group.filter((x) => x !== m);
  const bandOf = (x: Member) => grid.ageBands.find((b) => b.code === x.ageBandCode);
  const disciplineLower = DISCIPLINES[m.discipline].label.toLowerCase();

  if (state.waves.length > 0) {
    const from = originWave(state, m);
    const to = memberWave(state, m);
    if (from !== to) {
      const fromText = from === null ? "d'une session pas encore fixée" : `de la session ${waveName(state, from)}`;
      const toText = to === null ? 'une session pas encore fixée' : `la session ${waveName(state, to)}`;
      out.push({ situation: { kind: 'session', from, to }, bullet: `Passage ${fromText} à ${toText}.`, causes: [] });
    }
  }

  const o = originOf(m);
  if (m.original && (o.discipline !== m.discipline || o.ruleset !== m.ruleset)) {
    const from = { discipline: o.discipline, ruleset: o.ruleset };
    const to = { discipline: m.discipline, ruleset: m.ruleset };
    const lower = (d: typeof from) => disciplineText(d).replace(/^\S+/, (w) => w.toLowerCase());
    out.push({ situation: { kind: 'discipline', from, to }, bullet: `Passage du ${lower(from)} au ${lower(to)}.`, causes: [] });
  }

  const ownAge = ageRank(bandOf(m));
  const older = opponents.filter((x) => compareRank(ageRank(bandOf(x)), ownAge) > 0);
  if (older.length > 0) {
    const sexes = new Set(group.map((x) => x.sex));
    const groupSex = sexes.size === 1 ? m.sex : 'X';
    const groupBands = byGridOrder(grid, group.map((x) => x.ageBandCode)).map((c) => bandLabel(grid, c, groupSex)).join('–');
    out.push({
      situation: { kind: 'age', ownBand: m.ageBandCode, strongerBands: byGridOrder(grid, older.map((x) => x.ageBandCode)) },
      bullet: `Passage des ${bandLabel(grid, m.ageBandCode, m.sex).toLowerCase()} à un groupe commun ${groupBands} en ${disciplineLower}.`,
      causes: older,
    });
  }

  const otherSex = opponents.filter((x) => x.sex !== m.sex);
  if (otherSex.length > 0) out.push({ situation: { kind: 'mixite' }, bullet: 'Groupe mixte filles et garçons.', causes: otherSex });

  const own = referenceClass(state, m);
  if (own) {
    const ownRank = weightRank(grid, own);
    const heavier = opponents
      .map((x) => ({ x, wc: referenceClass(state, x) }))
      .filter((h): h is { x: Member; wc: WeightClass } => h.wc !== null && compareRank(weightRank(grid, h.wc), ownRank) > 0);
    if (heavier.length > 0) {
      const heaviest = heavier.map((h) => h.wc).sort((a, b) => compareRank(weightRank(grid, b), weightRank(grid, a)) || a.id.localeCompare(b.id))[0]!;
      const mine = effectiveWeight(m, grid);
      const gaps = heavier.map((h) => {
        const theirs = effectiveWeight(h.x, grid);
        return { ...h, gap: mine === null || theirs === null ? null : roundGap((hundredths(theirs) - hundredths(mine)) / 100) };
      });
      const over = gaps.filter((g) => g.gap !== null && g.gap > GAP_LIMIT_KG);
      if (over.length > 0) {
        const gapKg = Math.max(...over.map((g) => g.gap!));
        out.push({
          situation: { kind: 'weight', ownClassId: own.id, heaviestClassId: heaviest.id, gapKg },
          bullet: `Écart de poids estimé avec ses adversaires : ${gapText(gapKg)} maximum.`,
          causes: over.map((g) => g.x),
        });
      }
      if (!hasWeight(m)) {
        out.push({
          situation: { kind: 'missingWeight', ownClassId: own.id, heaviestClassId: heaviest.id },
          bullet: "Merci d'indiquer son poids en kg pour vérifier que l'écart réel ne dépasse pas 5 kg.",
          causes: heavier.map((h) => h.x),
        });
      }
    }
  }
  return out;
}

/** Demandes d'autorisation (et poids manquants) de toutes les inscriptions placées dans un groupe d'au moins deux actifs. */
export function authorizationRequests(state: State, moves: BlameMove[]): AuthorizationRequest[] {
  const lastMove = new Map<string, BlameMove>();
  for (const mv of moves) {
    for (const id of mv.registrationIds) {
      const prev = lastMove.get(id);
      if (!prev || mv.seq > prev.seq) lastMove.set(id, mv);
    }
  }
  /** Dernière entrée de chacun, sans doublon, plus récente d'abord. */
  const blameOf = (members: Member[]) => {
    const hits = new Map<string, BlameMove>();
    for (const x of members) {
      const mv = lastMove.get(x.registrationId);
      if (mv) hits.set(mv.entryId, mv);
    }
    return [...hits.values()].sort((a, b) => b.seq - a.seq).map((mv) => mv.entryId);
  };

  const out: AuthorizationRequest[] = [];
  for (const cat of state.categories) {
    const group = activeMembers(state, cat.id);
    if (group.length < 2) continue;
    const proposedLabel = categoryLabel(cat.key, state.grid);
    for (const m of group) {
      for (const d of requestsFor(state, m, group)) {
        const kind = d.situation.kind;
        const own = kind === 'discipline' || kind === 'session';
        const stayed = m.original === null;
        const received = byUnique(d.causes.map((x) => bandAndWeight(state, x, referenceClass(state, x) ?? undefined)));
        out.push({
          id: `${kind}:${m.registrationId}`,
          registrationId: m.registrationId,
          clubId: m.clubId,
          categoryId: cat.id,
          situation: d.situation,
          current: `${disciplineText(originOf(m))} · ${bandAndWeight(state, m, originClass(state, m))}`,
          proposed: stayed
            ? `reste en ${bandAndWeight(state, m, originClass(state, m))}${received.length ? ` et reçoit ${received.join(', ')}` : ''}`
            : proposedLabel,
          bullet: d.bullet,
          blame: blameOf(own ? [m] : [m, ...d.causes]),
        });
      }
    }
  }
  const label = new Map(state.members.map((m) => [m.registrationId, m.label]));
  return out.sort(
    (a, b) =>
      compareClub(a.clubId, b.clubId) ||
      (label.get(a.registrationId) ?? '').localeCompare(label.get(b.registrationId) ?? '', 'fr') ||
      a.registrationId.localeCompare(b.registrationId) ||
      KIND_ORDER.indexOf(a.situation.kind) - KIND_ORDER.indexOf(b.situation.kind),
  );
}

// --- Réponses enregistrées « Accordée » (spec §7.2) ----------------------------------------------------------------

/** Réponse « Accordée » d'un coach, avec la situation exacte qu'il a acceptée. */
export interface StoredAnswer {
  registrationId: string;
  kind: AnswerableKind;
  situation: AuthorizationSituation;
  answeredAt: string;
}

/** Rang d'une catégorie de poids par son identifiant (une ouverte au-dessus des bornées) ; `null` si inconnue. */
function weightClassRank(grid: CategoryGrid, id: string): [number, number] | null {
  const wc = grid.weightClasses.find((w) => w.id === id);
  return wc ? weightRank(grid, wc) : null;
}

const sameDestination = (a: { discipline: DisciplineId; ruleset: Ruleset | null }, b: { discipline: DisciplineId; ruleset: Ruleset | null }) =>
  a.discipline === b.discipline && a.ruleset === b.ruleset;

/** La réponse enregistrée couvre-t-elle la demande actuelle ? Elle tombe quand la situation s'aggrave au-delà de l'accord. */
export function answerCovers(answer: AuthorizationSituation, request: AuthorizationSituation, grid: CategoryGrid): boolean {
  switch (answer.kind) {
    case 'age':
      return request.kind === 'age' && request.strongerBands.every((b) => answer.strongerBands.includes(b));
    case 'weight': {
      if (request.kind !== 'weight' || request.gapKg > answer.gapKg) return false;
      if (request.heaviestClassId === answer.heaviestClassId) return true;
      const asked = weightClassRank(grid, request.heaviestClassId);
      const accepted = weightClassRank(grid, answer.heaviestClassId);
      return asked !== null && accepted !== null && compareRank(asked, accepted) <= 0;
    }
    case 'discipline':
      return request.kind === 'discipline' && sameDestination(answer.to, request.to);
    case 'mixite':
      return request.kind === 'mixite';
    case 'session':
      return request.kind === 'session' && answer.to === request.to;
    case 'missingWeight':
      return false;
  }
}

/** `info` : poids manquant, qui n'a pas de réponse (il se règle en saisissant le poids). */
export type RequestStatus = 'pending' | 'granted' | 'info';

export function withStatus(
  requests: AuthorizationRequest[],
  answers: StoredAnswer[],
  grid: CategoryGrid,
): (AuthorizationRequest & { status: RequestStatus; answeredAt: string | null })[] {
  return requests.map((r) => {
    if (r.situation.kind === 'missingWeight') return { ...r, status: 'info' as const, answeredAt: null };
    const answer = answers.find((a) => a.registrationId === r.registrationId && a.kind === r.situation.kind);
    return answer && answerCovers(answer.situation, r.situation, grid)
      ? { ...r, status: 'granted' as const, answeredAt: answer.answeredAt }
      : { ...r, status: 'pending' as const, answeredAt: null };
  });
}
