import { describe, expect, test } from 'vitest';
import { answerCovers, authorizationRequests, gapText, roundGap, withStatus, type AuthorizationRequest, type AuthorizationSituation, type BlameMove, type StoredAnswer } from '../../src/domain/authorizations.js';
import type { DisciplineId } from '../../src/domain/types.js';
import { ffkDefaultGrid } from '../../src/domain/grid-ffk.js';
import { freeKey, keyString, naturalKey } from '../../src/domain/categories.js';
import { recompute } from '../../src/domain/replacement/move.js';
import type { CategoryState, Member, State } from '../../src/domain/replacement/types.js';
import type { Wave } from '../../src/domain/waves.js';
import { makeState, member } from './replacement/fixtures.js';

/** Chaque groupe devient une catégorie (clé recalculée d'après ses membres, comme après un déplacement). */
function groups(gs: Member[][], over: Partial<State> = {}): State {
  const categories: CategoryState[] = gs.map((g, i) => {
    const id = `g${i}`;
    for (const m of g) m.categoryId = id;
    return { id, key: naturalKey(g[0]!, g[0]!), status: 'provisional', aliasKeys: [], waveOverride: null, frozenWave: null };
  });
  const s = makeState(gs.flat(), { ...over, categories });
  for (const c of s.categories) recompute(s, c);
  return s;
}

/** Inscription déplacée : valeurs d'origine gardées dans `original`. */
const moved = (over: Partial<Member>, original: Partial<NonNullable<Member['original']>> = {}): Member => {
  const m = member(over);
  m.original = { discipline: m.discipline, ruleset: m.ruleset, weightClassId: m.weightClassId, reason: 'manual', ...original };
  m.placementLocked = true;
  m.recasementType = 'M';
  return m;
};

const of = (rs: AuthorizationRequest[], m: Member) => rs.filter((r) => r.registrationId === m.registrationId);
const kinds = (rs: AuthorizationRequest[], m: Member) => of(rs, m).map((r) => r.situation.kind);
const one = (rs: AuthorizationRequest[], m: Member, kind: string) => of(rs, m).find((r) => r.situation.kind === kind)!;

describe('fixture de la skill (Worked decision fixture)', () => {
  test('5 kg pile : aucune demande ; poids déclaré égal à la limite utilisé', () => {
    const alex = moved({ label: 'ALEX', sex: 'M', ageBandCode: 'benjamin', weightClassId: 'benjamin:M:-45', approxWeightKg: 45 });
    const bastien = member({ label: 'BASTIEN', sex: 'M', ageBandCode: 'benjamin', weightClassId: 'benjamin:M:-50', approxWeightKg: 50 });
    expect(authorizationRequests(groups([[alex, bastien]]), [])).toEqual([]);
  });

  test('poids manquant : seulement le plus léger, pas la limite comme poids', () => {
    // Même sexe pour juger le poids seul.
    const chloe = member({ label: 'CHLOÉ', ageBandCode: 'minime', weightClassId: 'minime:F:-35' });
    const david = member({ label: 'DAVID', ageBandCode: 'minime', weightClassId: 'minime:F:-40', approxWeightKg: 39 });
    const rs = authorizationRequests(groups([[chloe, david]]), []);
    expect(kinds(rs, chloe)).toEqual(['missingWeight']);
    expect(kinds(rs, david)).toEqual([]);
    expect(one(rs, chloe, 'missingWeight').situation).toEqual({ kind: 'missingWeight', ownClassId: 'minime:F:-35', heaviestClassId: 'minime:F:-40' });
    expect(one(rs, chloe, 'missingWeight').bullet).toBe("Merci d'indiquer son poids en kg pour vérifier que l'écart réel ne dépasse pas 5 kg.");
  });

  test('même limite, tranches différentes : âge seulement', () => {
    const eva = moved({ label: 'EVA Eva', ageBandCode: 'benjamin', weightClassId: 'benjamin:F:-50', approxWeightKg: 49 });
    const farah = member({ label: 'FARAH Farah', ageBandCode: 'minime', weightClassId: 'minime:F:-50', approxWeightKg: 48 });
    const rs = authorizationRequests(groups([[eva, farah]]), []);
    expect(kinds(rs, eva)).toEqual(['age']);
    expect(kinds(rs, farah)).toEqual([]);
    const age = one(rs, eva, 'age');
    expect(age.id).toBe(`age:${eva.registrationId}`);
    expect(age.situation).toEqual({ kind: 'age', ownBand: 'benjamin', strongerBands: ['minime'] });
    expect(age.bullet).toBe('Passage des benjamines à un groupe commun Benjamines–Minimes en karaté.');
    expect(age.current).toBe('Karaté Jiyu · Benjamines −50');
    // Même écriture que « current » : formes féminines, signe moins (U+2212), limite commune écrite une fois.
    expect(age.proposed).toBe('Karaté Jiyu · Benjamines–Minimes −50');
    expect(age.clubId).toBe(eva.clubId);
    expect(age.categoryId).toBe('g0');
  });

  test('changement de discipline : demande même si la fiche l’autorisait', () => {
    const gael = moved(
      { label: 'GAËL', sex: 'M', ageBandCode: 'minime', discipline: 'shido-mix', ruleset: null, weightClassId: 'minime:M:-40', approxWeightKg: 37, otherDisciplines: ['shido-mix'], clubPreApproval: true },
      { discipline: 'shido-boxing' },
    );
    const hugo = member({ label: 'HUGO', sex: 'M', ageBandCode: 'minime', discipline: 'shido-mix', ruleset: null, weightClassId: 'minime:M:-40', approxWeightKg: 36 });
    const rs = authorizationRequests(groups([[gael, hugo]]), []);
    expect(kinds(rs, gael)).toEqual(['discipline']);
    expect(kinds(rs, hugo)).toEqual([]);
    const d = one(rs, gael, 'discipline');
    expect(d.situation).toEqual({ kind: 'discipline', from: { discipline: 'shido-boxing', ruleset: null }, to: { discipline: 'shido-mix', ruleset: null } });
    expect(d.bullet).toBe('Passage du shido-boxing au shido-mix-martial.');
    expect(d.current).toBe('Shido-boxing · Minimes −40');
  });

  test('changement de règlement seul : demande discipline, règlement écrit', () => {
    const a = moved({ ageBandCode: 'senior', weightClassId: 'senior:F:-55', approxWeightKg: 54, ruleset: 'jiyu' }, { ruleset: 'shobu' });
    const b = member({ ageBandCode: 'senior', weightClassId: 'senior:F:-55', approxWeightKg: 53, ruleset: 'jiyu' });
    const rs = authorizationRequests(groups([[a, b]]), []);
    expect(one(rs, a, 'discipline').bullet).toBe('Passage du karaté Shobu au karaté Jiyu.');
  });

  test('−60 déclaré 57 face à −67 déclaré 64 : poids 7 kg pour le plus léger seul', () => {
    const lower = member({ sex: 'M', ageBandCode: 'senior', weightClassId: 'senior:M:-60', approxWeightKg: 57 });
    const upper = moved({ sex: 'M', ageBandCode: 'senior', weightClassId: 'senior:M:-67', approxWeightKg: 64 });
    const rs = authorizationRequests(groups([[lower, upper]]), []);
    expect(kinds(rs, lower)).toEqual(['weight']);
    expect(kinds(rs, upper)).toEqual([]);
    const w = one(rs, lower, 'weight');
    expect(w.situation).toEqual({ kind: 'weight', ownClassId: 'senior:M:-60', heaviestClassId: 'senior:M:-67', gapKg: 7 });
    expect(w.bullet).toBe('Écart de poids estimé avec ses adversaires : 7 kg maximum.');
  });

  test('Minime −50 sans poids reçoit une Benjamine +50 : missingWeight, pas d’âge', () => {
    const minime = member({ ageBandCode: 'minime', weightClassId: 'minime:F:-50' });
    const benjamine = moved({ ageBandCode: 'benjamin', weightClassId: 'benjamin:F:+50' });
    const rs = authorizationRequests(groups([[minime, benjamine]]), []);
    expect(kinds(rs, minime)).toEqual(['missingWeight']);
    expect(kinds(rs, benjamine)).toEqual(['age']);
  });
});

describe('âge', () => {
  test('vétéran avec des seniors : âge pour le vétéran, rien pour les seniors', () => {
    const v1 = moved({ sex: 'M', ageBandCode: 'v1', weightClassId: 'v1:M:-75', approxWeightKg: 74 });
    const s1 = member({ sex: 'M', ageBandCode: 'senior', weightClassId: 'senior:M:-75', approxWeightKg: 73 });
    const s2 = member({ sex: 'M', ageBandCode: 'senior', weightClassId: 'senior:M:-75', approxWeightKg: 72 });
    const rs = authorizationRequests(groups([[v1, s1, s2]]), []);
    expect(kinds(rs, v1)).toEqual(['age']);
    expect(one(rs, v1, 'age').situation).toEqual({ kind: 'age', ownBand: 'v1', strongerBands: ['senior'] });
    expect(kinds(rs, s1)).toEqual([]);
    expect(kinds(rs, s2)).toEqual([]);
  });

  test('Espoir avec Seniors : pas de demande d’âge', () => {
    const e = moved({ sex: 'M', ageBandCode: 'espoir', weightClassId: 'espoir:M:-75', approxWeightKg: 74 });
    const s = member({ sex: 'M', ageBandCode: 'senior', weightClassId: 'senior:M:-75', approxWeightKg: 73 });
    expect(authorizationRequests(groups([[e, s]]), [])).toEqual([]);
  });

  test('vétérans 2 avec vétérans 1 et seniors : les deux tranches plus fortes, triées', () => {
    const v2 = moved({ sex: 'M', ageBandCode: 'v2', weightClassId: 'v2:M:-75', approxWeightKg: 74 });
    const v1 = moved({ sex: 'M', ageBandCode: 'v1', weightClassId: 'v1:M:-75', approxWeightKg: 74 });
    const s = member({ sex: 'M', ageBandCode: 'senior', weightClassId: 'senior:M:-75', approxWeightKg: 73 });
    const rs = authorizationRequests(groups([[v2, v1, s]]), []);
    expect(one(rs, v2, 'age').situation).toEqual({ kind: 'age', ownBand: 'v2', strongerBands: ['senior', 'v1'] });
    expect(one(rs, v1, 'age').situation).toEqual({ kind: 'age', ownBand: 'v1', strongerBands: ['senior'] });
  });
});

describe('poids : arrondi au dixième', () => {
  const pair = (light: number, heavy: number) => {
    const a = member({ ageBandCode: 'senior', weightClassId: 'senior:F:-50', approxWeightKg: light });
    const b = moved({ ageBandCode: 'senior', weightClassId: 'senior:F:-55', approxWeightKg: heavy });
    return { a, rs: authorizationRequests(groups([[a, b]]), []) };
  };

  test('écart 5,04 kg : arrondi 5, aucune demande', () => {
    expect(pair(50, 55.04).rs).toEqual([]);
  });

  test('écart 5,05 kg : arrondi 5,1, demande « 5,1 kg »', () => {
    // 55,05 − 50 vaut 5,049999… en flottant : l'arrondi naïf donnerait 5.
    const { a, rs } = pair(50, 55.05);
    expect(kinds(rs, a)).toEqual(['weight']);
    const w = one(rs, a, 'weight');
    expect(w.situation).toMatchObject({ gapKg: 5.1 });
    expect(w.bullet).toBe('Écart de poids estimé avec ses adversaires : 5,1 kg maximum.');
  });

  test('roundGap : demi vers le haut, en centièmes', () => {
    expect(roundGap(5.04)).toBe(5);
    expect(roundGap(5.05)).toBe(5.1);
    expect(roundGap(55.05 - 50)).toBe(5.1);
    expect(roundGap(7.25)).toBe(7.3);
    expect(roundGap(7)).toBe(7);
  });

  test('gapText : 5 → « 5 kg », 7,25 → « 7,3 kg »', () => {
    expect(gapText(5)).toBe('5 kg');
    expect(gapText(7.25)).toBe('7,3 kg');
    expect(gapText(5.1)).toBe('5,1 kg');
  });

  test('poids manquant et écart > 5 kg : les deux demandes', () => {
    const a = member({ ageBandCode: 'senior', weightClassId: 'senior:F:-50' });
    const b = moved({ ageBandCode: 'senior', weightClassId: 'senior:F:-61', approxWeightKg: 60 });
    const rs = authorizationRequests(groups([[a, b]]), []);
    expect(kinds(rs, a)).toEqual(['weight', 'missingWeight']);
    expect(one(rs, a, 'weight').situation).toEqual({ kind: 'weight', ownClassId: 'senior:F:-50', heaviestClassId: 'senior:F:-61', gapKg: 10 });
  });

  test('pesée : la catégorie de la pesée sert de référence', () => {
    // Même catégorie inscrite, mais la pesée place B en −61 : A face à plus lourd.
    const a = member({ ageBandCode: 'senior', weightClassId: 'senior:F:-55', approxWeightKg: 53 });
    const b = member({ ageBandCode: 'senior', weightClassId: 'senior:F:-55', weighInKg: 60 });
    const rs = authorizationRequests(groups([[a, b]]), []);
    expect(kinds(rs, a)).toEqual(['weight']);
    expect(one(rs, a, 'weight').situation).toEqual({ kind: 'weight', ownClassId: 'senior:F:-55', heaviestClassId: 'senior:F:-61', gapKg: 7 });
    expect(kinds(rs, b)).toEqual([]);
  });

  test('catégorie ouverte au-dessus de la bornée de même limite ; deux ouvertes comparées par leur seuil', () => {
    const minus = member({ ageBandCode: 'senior', weightClassId: 'senior:F:-68', approxWeightKg: 66 });
    const plus = moved({ ageBandCode: 'senior', weightClassId: 'senior:F:+68', approxWeightKg: 72 });
    const rs = authorizationRequests(groups([[minus, plus]]), []);
    expect(one(rs, minus, 'weight').situation).toMatchObject({ heaviestClassId: 'senior:F:+68', gapKg: 6 });

    const cadetPlus = member({ ageBandCode: 'cadet', weightClassId: 'cadet:F:+61', approxWeightKg: 62 });
    const juniorPlus = moved({ ageBandCode: 'junior', weightClassId: 'junior:F:+66', approxWeightKg: 70 });
    const rs2 = authorizationRequests(groups([[cadetPlus, juniorPlus]]), []);
    expect(kinds(rs2, cadetPlus)).toEqual(['age', 'weight']);
    expect(kinds(rs2, juniorPlus)).toEqual([]);
  });
});

describe('mixité, présence, session', () => {
  test('groupe mixte : une demande mixite par membre', () => {
    const f = member({ sex: 'F', ageBandCode: 'senior', weightClassId: 'senior:F:-68', approxWeightKg: 66 });
    const m = moved({ sex: 'M', ageBandCode: 'senior', weightClassId: 'senior:M:-67', approxWeightKg: 66 });
    const moves: BlameMove[] = [{ entryId: 'e1', seq: 1, registrationIds: [m.registrationId] }];
    const rs = authorizationRequests(groups([[f, m]]), moves);
    expect(kinds(rs, f)).toEqual(['mixite']);
    expect(kinds(rs, m)).toEqual(['mixite']);
    expect(one(rs, f, 'mixite').situation).toEqual({ kind: 'mixite' });
    expect(one(rs, f, 'mixite').bullet).toBe('Groupe mixte filles et garçons.');
    expect(one(rs, f, 'mixite').blame).toEqual(['e1']);
    expect(one(rs, m, 'mixite').blame).toEqual(['e1']);
    // Groupe mixte : tranche au masculin, « mixte », limites différentes de la plus légère à la plus lourde.
    expect(one(rs, m, 'mixite').proposed).toBe('Karaté Jiyu · Seniors mixte −67 / −68');
  });

  test('adversaire absent : ignoré', () => {
    const eva = moved({ ageBandCode: 'benjamin', weightClassId: 'benjamin:F:-50', approxWeightKg: 49 });
    const farah = member({ ageBandCode: 'minime', weightClassId: 'minime:F:-50', approxWeightKg: 48, presence: 'absent' });
    expect(authorizationRequests(groups([[eva, farah]]), [])).toEqual([]);
  });

  const matin: Wave = { id: 'matin', name: 'Matin', order: 0, rules: { ageBandCodes: ['benjamin'], disciplines: [] }, weighInClosed: false };
  const aprem: Wave = { id: 'aprem', name: 'Après-midi', order: 1, rules: { ageBandCodes: ['minime'], disciplines: [] }, weighInClosed: false };

  test('changement de session : session, du blâme du combattant seul', () => {
    const benj = moved({ label: 'BENJ', clubId: 'c', ageBandCode: 'benjamin', weightClassId: 'benjamin:F:-50', approxWeightKg: 49 });
    const stay = member({ label: 'STAY', clubId: 'c', ageBandCode: 'minime', weightClassId: 'minime:F:-50', approxWeightKg: 48 });
    const came = moved({ label: 'CAME', clubId: 'c', ageBandCode: 'minime', weightClassId: 'minime:F:-50', approxWeightKg: 48 }, { weightClassId: 'minime:F:-45' });
    const moves: BlameMove[] = [
      { entryId: 'e1', seq: 1, registrationIds: [came.registrationId] },
      { entryId: 'e0', seq: 0, registrationIds: [benj.registrationId] },
      { entryId: 'e2', seq: 2, registrationIds: [benj.registrationId] },
    ];
    const rs = authorizationRequests(groups([[benj, stay, came]], { waves: [matin, aprem] }), moves);
    // Ordre : par combattant, puis session, discipline, age, mixite, weight, missingWeight.
    expect(rs.map((r) => r.id)).toEqual([`session:${benj.registrationId}`, `age:${benj.registrationId}`]);
    const session = one(rs, benj, 'session');
    expect(session.situation).toEqual({ kind: 'session', from: 'matin', to: 'aprem' });
    expect(session.bullet).toBe('Passage de la session Matin à la session Après-midi.');
    expect(session.blame).toEqual(['e2']);
    expect(one(rs, benj, 'age').blame).toEqual(['e2', 'e1']);
  });

  test('session : le choix individuel de la catégorie d’origine compte', () => {
    // Catégorie des minimes mise à la main en Matin : une minime restée sur place ne change pas de session.
    const a = member({ ageBandCode: 'minime', weightClassId: 'minime:F:-50', approxWeightKg: 48 });
    const b = member({ ageBandCode: 'minime', weightClassId: 'minime:F:-50', approxWeightKg: 47 });
    const s = groups([[a, b]], { waves: [matin, aprem] });
    s.categories[0]!.waveOverride = 'matin';
    expect(keyString(s.categories[0]!.key)).toBe(keyString(naturalKey(a, a)));
    expect(authorizationRequests(s, [])).toEqual([]);
  });

  test('session : le choix individuel d’un groupe fusionné n’est pas la session d’origine', () => {
    // Deux minimes −50 (Après-midi par les règles) reçoivent une benjamine (Matin) : la majorité garde le groupe en
    // Après-midi. Le groupe est ensuite mis à la main en Matin.
    const stay = member({ ageBandCode: 'minime', weightClassId: 'minime:F:-50', approxWeightKg: 48 });
    const stay2 = member({ ageBandCode: 'minime', weightClassId: 'minime:F:-50', approxWeightKg: 48 });
    const benj = moved({ ageBandCode: 'benjamin', weightClassId: 'benjamin:F:-50', approxWeightKg: 49 });
    const s = groups([[stay, stay2, benj]], { waves: [matin, aprem] });
    expect(authorizationRequests(s, []).map((r) => r.id)).toEqual([`session:${benj.registrationId}`, `age:${benj.registrationId}`]);
    s.categories[0]!.waveOverride = 'matin';
    const rs = authorizationRequests(s, []);
    // Les minimes restées passent vraiment d'Après-midi à Matin ; la benjamine, venue de Matin, y reste.
    expect(one(rs, stay, 'session').situation).toEqual({ kind: 'session', from: 'aprem', to: 'matin' });
    expect(kinds(rs, stay)).toEqual(['session']);
    expect(kinds(rs, stay2)).toEqual(['session']);
    expect(kinds(rs, benj)).toEqual(['age']);
  });

  test('sans session : aucune demande de session', () => {
    const benj = moved({ ageBandCode: 'benjamin', weightClassId: 'benjamin:F:-50', approxWeightKg: 49 });
    const stay = member({ ageBandCode: 'minime', weightClassId: 'minime:F:-50', approxWeightKg: 48 });
    expect(kinds(authorizationRequests(groups([[benj, stay]]), []), benj)).toEqual(['age']);
  });
});

describe('blâme, libellés, inscriptions', () => {
  test('reste sur place et reçoit plus lourd : blame = entrée de l’adversaire', () => {
    const stay = member({ ageBandCode: 'minime', weightClassId: 'minime:F:-45', approxWeightKg: 44 });
    const heavy = moved({ ageBandCode: 'minime', weightClassId: 'minime:F:-55', approxWeightKg: 53 });
    const close = moved({ ageBandCode: 'minime', weightClassId: 'minime:F:-50', approxWeightKg: 46 });
    const moves: BlameMove[] = [
      { entryId: 'e1', seq: 1, registrationIds: [heavy.registrationId] },
      { entryId: 'e2', seq: 2, registrationIds: [close.registrationId] },
    ];
    const rs = authorizationRequests(groups([[stay, heavy, close]]), moves);
    expect(kinds(rs, stay)).toEqual(['weight']);
    const w = one(rs, stay, 'weight');
    // Seul l'adversaire qui porte l'écart au-delà de 5 kg est en cause.
    expect(w.blame).toEqual(['e1']);
    expect(w.situation).toEqual({ kind: 'weight', ownClassId: 'minime:F:-45', heaviestClassId: 'minime:F:-55', gapKg: 9 });
    expect(w.current).toBe('Karaté Jiyu · Minimes −45');
    expect(w.proposed).toBe('reste en Minimes −45 et reçoit Minimes −55');
  });

  test('poids manquant : tous les adversaires plus lourds sont en cause', () => {
    const stay = member({ ageBandCode: 'minime', weightClassId: 'minime:F:-45' });
    const close = moved({ ageBandCode: 'minime', weightClassId: 'minime:F:-50', approxWeightKg: 46 });
    const moves: BlameMove[] = [{ entryId: 'e1', seq: 1, registrationIds: [close.registrationId] }];
    const rs = authorizationRequests(groups([[stay, close]]), moves);
    expect(one(rs, stay, 'missingWeight').blame).toEqual(['e1']);
    expect(one(rs, stay, 'missingWeight').proposed).toBe('reste en Minimes −45 et reçoit Minimes −50');
  });

  test('deux inscriptions du même combattant : demandes par inscription', () => {
    const karate = moved({ fighterId: 'fx', label: 'DUPONT Léa', ageBandCode: 'benjamin', weightClassId: 'benjamin:F:-40', approxWeightKg: 39 });
    const boxing = moved({ fighterId: 'fx', label: 'DUPONT Léa', clubId: karate.clubId, ageBandCode: 'benjamin', discipline: 'shido-boxing', ruleset: null, weightClassId: 'benjamin:F:-40', approxWeightKg: 39 });
    const m1 = member({ ageBandCode: 'minime', weightClassId: 'minime:F:-40', approxWeightKg: 38 });
    const m2 = member({ ageBandCode: 'minime', discipline: 'shido-boxing', ruleset: null, weightClassId: 'minime:F:-40', approxWeightKg: 38 });
    const rs = authorizationRequests(groups([[karate, m1], [boxing, m2]]), []);
    expect(rs.map((r) => r.id).sort()).toEqual([`age:${boxing.registrationId}`, `age:${karate.registrationId}`].sort());
    expect(one(rs, karate, 'age').bullet).toBe('Passage des benjamines à un groupe commun Benjamines–Minimes en karaté.');
    expect(one(rs, boxing, 'age').bullet).toBe('Passage des benjamines à un groupe commun Benjamines–Minimes en shido-boxing.');
  });

  test('ordre : club, puis combattant, puis type', () => {
    const b = moved({ label: 'BERT', clubId: 'clubB', ageBandCode: 'benjamin', weightClassId: 'benjamin:F:-50', approxWeightKg: 49 });
    const a = moved({ label: 'ZOÉ', clubId: 'clubA', ageBandCode: 'benjamin', weightClassId: 'benjamin:F:-50', approxWeightKg: 49 });
    const a2 = moved({ label: 'ANNE', clubId: 'clubA', ageBandCode: 'benjamin', weightClassId: 'benjamin:F:-50', approxWeightKg: 49 });
    const m = member({ ageBandCode: 'minime', clubId: 'clubC', weightClassId: 'minime:F:-50', approxWeightKg: 48 });
    const rs = authorizationRequests(groups([[b, a, a2, m]]), []);
    expect(rs.map((r) => r.registrationId)).toEqual([a2.registrationId, a.registrationId, b.registrationId]);
  });
});

describe('answerCovers et withStatus', () => {
  const grid = ffkDefaultGrid();
  const w = (gapKg: number, heaviestClassId = 'cadet:M:-63'): AuthorizationSituation => ({ kind: 'weight', ownClassId: 'cadet:M:-54', heaviestClassId, gapKg });
  const age = (...strongerBands: string[]): AuthorizationSituation => ({ kind: 'age', ownBand: 'benjamin', strongerBands });

  test('poids : un accord à 7 kg couvre 6 kg, pas 9 kg', () => {
    expect(answerCovers(w(7), w(6), grid)).toBe(true);
    expect(answerCovers(w(7), w(7), grid)).toBe(true);
    expect(answerCovers(w(7), w(9), grid)).toBe(false);
  });
  test('poids : une catégorie adverse plus lourde que celle acceptée n\'est pas couverte', () => {
    expect(answerCovers(w(7, 'cadet:M:-63'), w(6, 'cadet:M:-57'), grid)).toBe(true);
    expect(answerCovers(w(7, 'cadet:M:-57'), w(6, 'cadet:M:-63'), grid)).toBe(false);
  });
  test('âge : les tranches plus fortes de la demande doivent être dans l\'accord', () => {
    expect(answerCovers(age('minime'), age('minime'), grid)).toBe(true);
    expect(answerCovers(age('minime', 'cadet'), age('minime'), grid)).toBe(true);
    expect(answerCovers(age('minime'), age('minime', 'cadet'), grid)).toBe(false);
  });
  test('discipline et session : même arrivée ; mixité : toujours', () => {
    const d = (to: DisciplineId): AuthorizationSituation => ({ kind: 'discipline', from: { discipline: 'karate', ruleset: 'jiyu' }, to: { discipline: to, ruleset: null } });
    expect(answerCovers(d('kata'), d('kata'), grid)).toBe(true);
    expect(answerCovers(d('kata'), d('karate'), grid)).toBe(false);
    const s = (to: string | null): AuthorizationSituation => ({ kind: 'session', from: 'a', to });
    expect(answerCovers(s('m'), s('m'), grid)).toBe(true);
    expect(answerCovers(s('m'), s('p'), grid)).toBe(false);
    expect(answerCovers({ kind: 'mixite' }, { kind: 'mixite' }, grid)).toBe(true);
  });
  test('types différents : jamais couvert', () => {
    expect(answerCovers({ kind: 'mixite' }, age('minime'), grid)).toBe(false);
  });

  test('withStatus : en attente, accordée (avec date) ou info', () => {
    const req = (id: string, registrationId: string, situation: AuthorizationSituation): AuthorizationRequest => ({
      id, registrationId, clubId: null, categoryId: 'g0', situation, current: '', proposed: '', bullet: '', blame: [],
    });
    const reqs = [
      req('weight:r1', 'r1', w(6)),
      req('weight:r2', 'r2', w(9)),
      req('age:r3', 'r3', age('minime')),
      req('missingWeight:r1', 'r1', { kind: 'missingWeight', ownClassId: 'a', heaviestClassId: 'b' }),
    ];
    const answers: StoredAnswer[] = [
      { registrationId: 'r1', kind: 'weight', situation: w(7), answeredAt: 't1' },
      { registrationId: 'r2', kind: 'weight', situation: w(7), answeredAt: 't2' },
    ];
    expect(withStatus(reqs, answers, grid).map((r) => [r.id, r.status, r.answeredAt])).toEqual([
      ['weight:r1', 'granted', 't1'],
      ['weight:r2', 'pending', null],
      ['age:r3', 'pending', null],
      ['missingWeight:r1', 'info', null],
    ]);
  });
});

describe('libellé du groupe proposé', () => {
  test('catégorie ouverte après les limites, chaque limite une fois', () => {
    const minime = member({ ageBandCode: 'minime', weightClassId: 'minime:F:-50' });
    const benjamine = moved({ ageBandCode: 'benjamin', weightClassId: 'benjamin:F:+50' });
    const rs = authorizationRequests(groups([[minime, benjamine]]), []);
    expect(one(rs, benjamine, 'age').proposed).toBe('Karaté Jiyu · Benjamines–Minimes −50 / +50');
  });

  test('tableau libre : son nom', () => {
    const a = moved({ ageBandCode: 'benjamin', weightClassId: 'benjamin:F:-50', approxWeightKg: 49 });
    const b = member({ ageBandCode: 'minime', weightClassId: 'minime:F:-50', approxWeightKg: 48 });
    const s = groups([[a, b]]);
    s.categories[0]!.key = freeKey('Gala 1', 'karate', 'jiyu');
    expect(one(authorizationRequests(s, []), a, 'age').proposed).toBe('Gala 1');
  });
});
