import { describe, expect, test } from 'vitest';
import { freeKey, keyString, type CategoryKey } from '../../src/domain/categories.js';
import { blockedRules, cellsOf, forbiddenLinks, galaxyLinks, linkKind, rulesFrom, rulesRank, type GalaxyLink, type GalaxyNode } from '../../src/domain/galaxy/links.js';
import { ffkDefaultGrid } from '../../src/domain/grid-ffk.js';
import { defaultSettings, type CompetitionSettings } from '../../src/domain/settings.js';
import type { DisciplineId, Ruleset } from '../../src/domain/types.js';

const grid = ffkDefaultGrid();

const key = (discipline: DisciplineId, ruleset: Ruleset | null, sex: 'F' | 'M' | 'X', bands: string[], weights: string[]): CategoryKey => ({
  discipline, ruleset, sex, ageBandCodes: bands, weightClassIds: weights,
});
const node = (k: CategoryKey): GalaxyNode => ({ id: keyString(k), key: k });
/** Karaté jiyu, une tranche, un poids. */
const kj = (sex: 'F' | 'M', band: string, weight: string): GalaxyNode => node(key('karate', 'jiyu', sex, [band], [`${band}:${sex}:${weight}`]));

const settings = (patch: Partial<CompetitionSettings> = {}): CompetitionSettings => ({ ...defaultSettings(), ...patch });
const between = (links: GalaxyLink[], x: GalaxyNode, y: GalaxyNode): GalaxyLink | undefined =>
  links.find((l) => (l.a === x.id && l.b === y.id) || (l.a === y.id && l.b === x.id));
/** Règles pour aller de x vers y (null = sens interdit). */
const from = (link: GalaxyLink, x: GalaxyNode): GalaxyLink['fromA'] => (link.a === x.id ? link.fromA : link.fromB);

describe('galaxyLinks', () => {
  test('relie Cadets F -54 à -47 et -61 par weight, pas à +61', () => {
    const [w47, w54, w61, open] = [kj('F', 'cadet', '-47'), kj('F', 'cadet', '-54'), kj('F', 'cadet', '-61'), kj('F', 'cadet', '+61')];
    const links = galaxyLinks([w47, w54, w61, open], grid, settings());
    for (const other of [w47, w61]) {
      const l = between(links, w54, other)!;
      expect(l).toBeDefined();
      expect(l.fromA).toEqual(['weight']);
      expect(l.fromB).toEqual(['weight']);
    }
    expect(between(links, w54, open)).toBeUndefined();
    for (const l of links) expect(l.a < l.b).toBe(true);
  });

  test('cadets → juniors : ageUp vu des cadets, ageDown vu des juniors', () => {
    const cadet = kj('F', 'cadet', '-54');
    const junior = kj('F', 'junior', '-53');
    const l = between(galaxyLinks([cadet, junior], grid, settings()), cadet, junior)!;
    expect(rulesFrom(l, cadet.id)).toEqual(['ageUp']);
    expect(rulesFrom(l, junior.id)).toEqual(['ageDown']);
  });

  test('entre vétérans (C dans les deux sens), ageUp des deux côtés ; ageUp éteint = pas de lien', () => {
    const v1 = kj('F', 'v1', '-61');
    const v2 = kj('F', 'v2', '-61');
    const l = between(galaxyLinks([v1, v2], grid, settings()), v1, v2)!;
    expect(l.fromA).toEqual(['ageUp']);
    expect(l.fromB).toEqual(['ageUp']);
    const off = settings({ replacementRules: { ...defaultSettings().replacementRules, off: ['ageUp'] } });
    expect(galaxyLinks([v1, v2], grid, off)).toEqual([]);
  });

  test('juniors → seniors = minorsAdults seul ; seniors ↔ v1 = seniorsVeterans', () => {
    const junior = kj('F', 'junior', '-53');
    const senior = kj('F', 'senior', '-55');
    const v1 = kj('F', 'v1', '-55');
    const links = galaxyLinks([junior, senior, v1], grid, settings({ mixMinorsAdults: true }));
    const js = between(links, junior, senior)!;
    expect(from(js, junior)).toEqual(['minorsAdults']);
    expect(from(js, senior)).toEqual(['minorsAdults']);
    const sv = between(links, senior, v1)!;
    expect(sv.fromA).toEqual(['seniorsVeterans']);
    expect(sv.fromB).toEqual(['seniorsVeterans']);
    // Sans le mélange mineurs / adultes, plus de lien juniors ↔ seniors.
    expect(between(galaxyLinks([junior, senior], grid, settings()), junior, senior)).toBeUndefined();
    // ageUp éteint : le passage reste possible, il ne demande que minorsAdults.
    const noUp = settings({ mixMinorsAdults: true, replacementRules: { ...defaultSettings().replacementRules, off: ['ageUp'] } });
    expect(from(between(galaxyLinks([junior, senior], grid, noUp), junior, senior)!, junior)).toEqual(['minorsAdults']);
  });

  test('karaté jiyu ↔ shido-mix même poids = discipline ; kata n’a aucun lien de discipline', () => {
    const karate = kj('F', 'cadet', '-54');
    const mix = node(key('shido-mix', 'jiyu', 'F', ['cadet'], ['cadet:F:-54']));
    const kata = node(key('kata', null, 'F', ['cadet'], []));
    const links = galaxyLinks([karate, mix, kata], grid, settings());
    const l = between(links, karate, mix)!;
    expect(l.fromA).toEqual(['discipline']);
    expect(l.fromB).toEqual(['discipline']);
    expect(between(links, karate, kata)).toBeUndefined();
    expect(between(links, mix, kata)).toBeUndefined();
  });

  test('autre discipline vers un poids voisin : discipline seule, même poids voisin éteint', () => {
    const karate = kj('F', 'cadet', '-54');
    const mix61 = node(key('shido-mix', 'jiyu', 'F', ['cadet'], ['cadet:F:-61']));
    const noWeight = settings({ replacementRules: { ...defaultSettings().replacementRules, off: ['weight'] } });
    const l = between(galaxyLinks([karate, mix61], grid, noWeight), karate, mix61)!;
    expect(from(l, karate)).toEqual(['discipline']);
    expect(from(l, mix61)).toEqual(['discipline']);
  });

  test('autre discipline et shobu → jiyu ensemble', () => {
    const shobu = node(key('karate', 'shobu', 'F', ['senior'], ['senior:F:-55']));
    const mixJiyu = node(key('shido-mix', 'jiyu', 'F', ['senior'], ['senior:F:-55']));
    const l = between(galaxyLinks([shobu, mixJiyu], grid, settings({ shobuToJiyu: true })), shobu, mixJiyu)!;
    expect(from(l, shobu)).toEqual(['discipline', 'shobuToJiyu']);
    expect(from(l, mixJiyu)).toBeNull();
  });

  test('pas de shobu pour une tranche mineure', () => {
    const cadetShobu = node(key('karate', 'shobu', 'F', ['cadet'], ['cadet:F:-54']));
    const cadetMixShobu = node(key('shido-mix', 'shobu', 'F', ['cadet'], ['cadet:F:-54']));
    expect(galaxyLinks([cadetShobu, cadetMixShobu], grid, settings())).toEqual([]);
    const seniorShobu = node(key('karate', 'shobu', 'F', ['senior'], ['senior:F:-55']));
    const seniorMixShobu = node(key('shido-mix', 'shobu', 'F', ['senior'], ['senior:F:-55']));
    expect(between(galaxyLinks([seniorShobu, seniorMixShobu], grid, settings()), seniorShobu, seniorMixShobu)!.fromA).toEqual(['discipline']);
  });

  test('shobu → jiyu possible, jiyu → shobu null', () => {
    const shobu = node(key('karate', 'shobu', 'F', ['senior'], ['senior:F:-55']));
    const jiyu = kj('F', 'senior', '-55');
    const l = between(galaxyLinks([shobu, jiyu], grid, settings({ shobuToJiyu: true })), shobu, jiyu)!;
    expect(from(l, shobu)).toEqual(['shobuToJiyu']);
    expect(from(l, jiyu)).toBeNull();
    expect(rulesFrom(l, jiyu.id)).toEqual(['shobuToJiyu']);
    // Réglage éteint : aucun lien.
    expect(galaxyLinks([shobu, jiyu], grid, settings())).toEqual([]);
  });

  test('shobu → jiyu vers un poids voisin : shobuToJiyu seul, même poids voisin éteint', () => {
    const shobu = node(key('karate', 'shobu', 'F', ['senior'], ['senior:F:-55']));
    const jiyu61 = kj('F', 'senior', '-61');
    const s = settings({ shobuToJiyu: true, replacementRules: { ...defaultSettings().replacementRules, off: ['weight'] } });
    expect(from(between(galaxyLinks([shobu, jiyu61], grid, s), shobu, jiyu61)!, shobu)).toEqual(['shobuToJiyu']);
  });

  test('entrer dans une catégorie mixte demande toujours mixSexes', () => {
    const f47 = kj('F', 'cadet', '-47');
    const mixed = node(key('karate', 'jiyu', 'X', ['cadet'], ['cadet:F:-47', 'cadet:M:-52']));
    const off = between(galaxyLinks([f47, mixed], grid, settings()), f47, mixed);
    expect(off && from(off, f47)).toBeFalsy();
    const unticked = between(galaxyLinks([f47, mixed], grid, settings({ mixSexes: { enabled: true, ageBandCodes: ['pupille'] } })), f47, mixed);
    expect(unticked && from(unticked, f47)).toBeFalsy();
    const on = between(galaxyLinks([f47, mixed], grid, settings({ mixSexes: { enabled: true, ageBandCodes: ['cadet'] } })), f47, mixed)!;
    expect(from(on, f47)).toEqual(['mixSexes']);
  });

  test('mixSexes seulement pour les tranches cochées', () => {
    const [pf, pm, cf, cm] = [kj('F', 'pupille', '-30'), kj('M', 'pupille', '-30'), kj('F', 'cadet', '-54'), kj('M', 'cadet', '-52')];
    const links = galaxyLinks([pf, pm, cf, cm], grid, settings({ mixSexes: { enabled: true, ageBandCodes: ['pupille'] } }));
    const l = between(links, pf, pm)!;
    expect(l.fromA).toEqual(['mixSexes']);
    expect(l.fromB).toEqual(['mixSexes']);
    expect(between(links, cf, cm)).toBeUndefined();
  });

  test('règle éteinte = pas de lien', () => {
    const cadet = kj('F', 'cadet', '-54');
    const junior = kj('F', 'junior', '-53');
    const off = (rules: ('ageUp' | 'ageDown')[]) =>
      settings({ replacementRules: { ...defaultSettings().replacementRules, off: rules } });
    const l = between(galaxyLinks([cadet, junior], grid, off(['ageDown'])), cadet, junior)!;
    expect(l).toBeDefined();
    expect(l.a).toBe(cadet.id);
    expect(l.fromA).toEqual(['ageUp']);
    expect(l.fromB).toBeNull();
    expect(galaxyLinks([cadet, junior], grid, off(['ageUp', 'ageDown']))).toEqual([]);
  });

  test('catégorie regroupée Cadets+Juniors F -54+-53 : reliée par chacune de ses cases', () => {
    const merged = node(key('karate', 'jiyu', 'F', ['cadet', 'junior'], ['cadet:F:-54', 'junior:F:-53']));
    const c47 = kj('F', 'cadet', '-47');
    const j59 = kj('F', 'junior', '-59');
    const m55 = kj('F', 'minime', '-55');
    const links = galaxyLinks([merged, c47, j59, m55], grid, settings());
    expect(rulesFrom(between(links, merged, c47)!, merged.id)).toEqual(['weight']);
    expect(rulesFrom(between(links, merged, j59)!, merged.id)).toEqual(['weight']);
    // Au départ, une case suffit (cadets → minimes) ; à l'arrivée, toutes les tranches comptent (minimes → juniors interdit).
    const mm = between(links, merged, m55)!;
    expect(from(mm, merged)).toEqual(['ageDown']);
    expect(from(mm, m55)).toBeNull();
  });

  test('arriver dans une catégorie regroupée : l’âge convient à toutes ses tranches', () => {
    const v2 = kj('F', 'v2', '-61');
    const v13 = node(key('karate', 'jiyu', 'F', ['v1', 'v3'], ['v1:F:-61', 'v3:F:-61']));
    expect(from(between(galaxyLinks([v2, v13], grid, settings()), v2, v13)!, v2)).toEqual(['ageUp']);
  });

  test('poids le plus proche parmi les nœuds fournis', () => {
    const cadet = kj('F', 'cadet', '-54');
    const j59 = kj('F', 'junior', '-59');
    const j66 = kj('F', 'junior', '-66');
    const links = galaxyLinks([cadet, j59, j66], grid, settings());
    expect(from(between(links, cadet, j59)!, cadet)).toEqual(['ageUp']);
    // Vu des cadets, -66 n'est pas le plus proche ; vu des juniors -66, cadets -54 est la seule case fournie.
    const far = between(links, cadet, j66)!;
    expect(from(far, cadet)).toBeNull();
    expect(from(far, j66)).toEqual(['ageDown']);
  });

  test('le poids le plus proche se cherche hors de la catégorie de départ', () => {
    // La case cadette -54 du regroupement a sa voisine juniors -53 chez elle : elle se relie à juniors -59.
    const merged = node(key('karate', 'jiyu', 'F', ['cadet', 'junior'], ['cadet:F:-54', 'junior:F:-53']));
    const j59 = kj('F', 'junior', '-59');
    const j66 = kj('F', 'junior', '-66');
    const links = galaxyLinks([merged, j59, j66], grid, settings({ replacementRules: { ...defaultSettings().replacementRules, off: ['weight'] } }));
    expect(from(between(links, merged, j59)!, merged)).toEqual(['ageUp']);
    // Juniors -66 n'entre pas non plus dans le regroupement : il a déjà des juniors, sans classe voisine de -66.
    expect(between(links, merged, j66)).toBeUndefined();
  });

  test('tableau libre : aucun lien', () => {
    const free = node(freeKey('Open', 'karate', 'jiyu'));
    const cadet = kj('F', 'cadet', '-54');
    expect(galaxyLinks([free, cadet], grid, null)).toEqual([]);
    expect(cellsOf(free.key, grid)).toEqual([]);
  });

  test('settings null : toutes les règles, ordre RULE_IDS', () => {
    const [cf, cm] = [kj('F', 'cadet', '-54'), kj('M', 'cadet', '-52')];
    const junior = kj('F', 'junior', '-53');
    const senior = kj('F', 'senior', '-55');
    const links = galaxyLinks([cf, cm, junior, senior], grid, null);
    expect(between(links, cf, cm)!.fromA).toEqual(['mixSexes']);
    expect(from(between(links, junior, senior)!, junior)).toEqual(['minorsAdults']);
  });
});

describe('cellsOf', () => {
  test('une clé mixte regroupée se développe en tranches × poids × sexes', () => {
    const k = key('karate', 'jiyu', 'X', ['cadet', 'junior'], ['cadet:F:-54', 'cadet:M:-52', 'junior:F:-53']);
    expect(cellsOf(k, grid).map(keyString).sort()).toEqual([
      'karate|jiyu|F|cadet|cadet:F:-54',
      'karate|jiyu|F|junior|junior:F:-53',
      'karate|jiyu|M|cadet|cadet:M:-52',
    ]);
    expect(cellsOf(key('kata', null, 'X', ['cadet'], []), grid).map(keyString)).toEqual(['kata||F|cadet|', 'kata||M|cadet|']);
  });
});

describe('linkKind', () => {
  test.each([
    [['weight'], 'weight'],
    [['ageUp', 'minorsAdults'], 'age'],
    [['seniorsVeterans'], 'age'],
    [['minorsAdults'], 'age'],
    [['shobuToJiyu'], 'ruleset'],
    [['discipline', 'shobuToJiyu'], 'discipline'],
    [['mixSexes'], 'sex'],
  ] as const)('%j → %s', (rules, kind) => {
    expect(linkKind([...rules])).toBe(kind);
  });
});

describe('rulesRank', () => {
  test('rulesRank : la règle la plus loin compte ; beyondCut au-delà de cutAfter', () => {
    const s = settings();
    expect(rulesRank(['ageUp', 'minorsAdults'], s).rank).toBe(s.replacementRules.order.indexOf('minorsAdults'));
    expect(rulesRank(['weight'], s)).toEqual({ rank: s.replacementRules.order.indexOf('weight'), beyondCut: false });
    expect(rulesRank(['discipline'], s).beyondCut).toBe(false);
    expect(rulesRank(['mixSexes'], settings({ replacementRules: { ...s.replacementRules, cutAfter: 'discipline' } })).beyondCut).toBe(true);
  });

  test('une coupure absente de l’ordre ne coupe rien', () => {
    const s = settings();
    const broken = settings({ replacementRules: { ...s.replacementRules, order: s.replacementRules.order.filter((r) => r !== s.replacementRules.cutAfter) } });
    expect(rulesRank(['mixSexes'], broken).beyondCut).toBe(false);
    expect(rulesRank([], s)).toEqual({ rank: -1, beyondCut: false });
  });
});

describe('forbiddenLinks', () => {
  const mixJ = node(key('shido-mix', 'jiyu', 'M', ['junior'], ['junior:M:+76']));
  const mixS = node(key('shido-mix', 'jiyu', 'M', ['senior'], ['senior:M:-84']));
  const mixJ76 = node(key('shido-mix', 'jiyu', 'M', ['junior'], ['junior:M:-76']));

  test('juniors → seniors, mélange mineurs / adultes fermé : interdit, la règle en cause nommée', () => {
    const s = settings({ mixMinorsAdults: false });
    const nodes = [mixJ, mixS, mixJ76];
    const allowed = galaxyLinks(nodes, grid, s);
    expect(between(allowed, mixJ, mixS)).toBeUndefined();
    const forbidden = forbiddenLinks(nodes, grid, s, allowed);
    const l = between(forbidden, mixJ, mixS)!;
    expect(from(l, mixJ)).toEqual(['minorsAdults']);
    expect(blockedRules(rulesFrom(l, mixJ.id), s, ['junior'])).toEqual(['minorsAdults']);
    // La voisine de poids, permise, n'est pas dans les interdits.
    expect(between(forbidden, mixJ, mixJ76)).toBeUndefined();
  });

  test('mélange ouvert : plus rien d’interdit entre ces deux-là', () => {
    const s = settings({ mixMinorsAdults: true });
    const allowed = galaxyLinks([mixJ, mixS], grid, s);
    expect(between(allowed, mixJ, mixS)).toBeDefined();
    expect(forbiddenLinks([mixJ, mixS], grid, s, allowed)).toEqual([]);
  });

  test('paire permise dans un sens : pas de lien interdit en plus', () => {
    // ageUp éteint : cadets ↔ juniors reste relié par le sens permis (ageDown, vu des juniors).
    const s = settings({ replacementRules: { ...defaultSettings().replacementRules, off: ['ageUp'] } });
    const [c, j] = [kj('F', 'cadet', '-54'), kj('F', 'junior', '-53')];
    const allowed = galaxyLinks([c, j], grid, s);
    expect(between(allowed, c, j)).toBeDefined();
    expect(between(forbiddenLinks([c, j], grid, s, allowed), c, j)).toBeUndefined();
  });

  test('règle de la liste éteinte : interdit, nommée', () => {
    const s = settings({ replacementRules: { ...defaultSettings().replacementRules, off: ['discipline'] } });
    const karate = kj('F', 'cadet', '-54');
    const mix = node(key('shido-mix', 'jiyu', 'F', ['cadet'], ['cadet:F:-54']));
    const allowed = galaxyLinks([karate, mix], grid, s);
    expect(between(allowed, karate, mix)).toBeUndefined();
    const l = between(forbiddenLinks([karate, mix], grid, s, allowed), karate, mix)!;
    expect(blockedRules(rulesFrom(l, karate.id), s, ['cadet'])).toEqual(['discipline']);
  });

  test('filles / garçons : interrupteur ouvert mais tranche non cochée → « mixSexes »', () => {
    const s = settings({ mixSexes: { enabled: true, ageBandCodes: [] } });
    const [f, m] = [kj('F', 'cadet', '-54'), kj('M', 'cadet', '-52')];
    const allowed = galaxyLinks([f, m], grid, s);
    expect(between(allowed, f, m)).toBeUndefined();
    const l = between(forbiddenLinks([f, m], grid, s, allowed), f, m)!;
    expect(blockedRules(rulesFrom(l, f.id), s, ['cadet'])).toEqual(['mixSexes']);
  });

  test('jamais possible (cadette vers le shobu) : pas de lien interdit', () => {
    const s = settings();
    const cadet = kj('F', 'cadet', '-54');
    const shobu = node(key('karate', 'shobu', 'F', ['senior'], ['senior:F:-55']));
    expect(forbiddenLinks([cadet, shobu], grid, s, galaxyLinks([cadet, shobu], grid, s))).toEqual([]);
  });

  test('blockedRules : une règle éteinte et une tranche non cochée pour le mélange filles / garçons : les deux nommées', () => {
    const s = settings({ mixSexes: { enabled: true, ageBandCodes: ['junior'] }, replacementRules: { ...defaultSettings().replacementRules, off: ['discipline'] } });
    expect(blockedRules(['mixSexes', 'discipline'], s, ['cadet'])).toEqual(['mixSexes', 'discipline']);
    // Tranche cochée : seule la règle éteinte bloque.
    expect(blockedRules(['mixSexes', 'discipline'], s, ['junior'])).toEqual(['discipline']);
    // Interrupteur fermé : le mélange bloque, quelle que soit la tranche.
    expect(blockedRules(['mixSexes'], { ...s, mixSexes: { enabled: false, ageBandCodes: ['cadet'] } }, ['cadet'])).toEqual(['mixSexes']);
  });
});
