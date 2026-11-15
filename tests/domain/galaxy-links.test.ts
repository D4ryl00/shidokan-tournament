import { describe, expect, test } from 'vitest';
import { freeKey, keyString, type CategoryKey } from '../../src/domain/categories.js';
import { cellsOf, galaxyLinks, linkKind, rulesFrom, rulesRank, type GalaxyLink, type GalaxyNode } from '../../src/domain/galaxy/links.js';
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
    expect(rulesFrom(l, cadet.id)).toContain('ageUp');
    expect(rulesFrom(l, junior.id)).toContain('ageDown');
  });

  test('juniors → seniors ajoute minorsAdults ; seniors ↔ v1 = seniorsVeterans', () => {
    const junior = kj('F', 'junior', '-53');
    const senior = kj('F', 'senior', '-55');
    const v1 = kj('F', 'v1', '-55');
    const links = galaxyLinks([junior, senior, v1], grid, settings({ mixMinorsAdults: true }));
    const js = between(links, junior, senior)!;
    expect(from(js, junior)).toEqual(['ageUp', 'minorsAdults']);
    expect(from(js, senior)).toEqual(['ageDown', 'minorsAdults']);
    const sv = between(links, senior, v1)!;
    expect(sv.fromA).toEqual(['seniorsVeterans']);
    expect(sv.fromB).toEqual(['seniorsVeterans']);
    // Sans le mélange mineurs / adultes, plus de lien juniors ↔ seniors.
    expect(between(galaxyLinks([junior, senior], grid, settings()), junior, senior)).toBeUndefined();
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
    expect(rulesFrom(between(links, merged, m55)!, merged.id)).toEqual(['ageDown']);
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
    expect(from(between(links, junior, senior)!, junior)).toEqual(['ageUp', 'minorsAdults']);
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
    [['shobuToJiyu', 'weight'], 'ruleset'],
    [['discipline', 'shobuToJiyu', 'weight'], 'discipline'],
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
});
