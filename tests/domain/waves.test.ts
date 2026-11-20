import { describe, expect, test } from 'vitest';
import { freeKey, type CategoryKey } from '../../src/domain/categories.js';
import { ffkDefaultGrid } from '../../src/domain/grid-ffk.js';
import { bandCounts, validateWaves, WAVE_NONE, waveConflicts, waveOfCategory, type BandCounts, type Wave } from '../../src/domain/waves.js';

const grid = ffkDefaultGrid();
const key = (ageBandCodes: string[], discipline: CategoryKey['discipline'] = 'karate'): CategoryKey => ({
  discipline, ruleset: discipline === 'kata' ? null : 'jiyu', sex: 'F', ageBandCodes, weightClassIds: [],
});
const wave = (id: string, order: number, ageBandCodes: string[], disciplines: Wave['rules']['disciplines'] = []): Wave => ({
  id, name: id, order, rules: { ageBandCodes, disciplines }, weighInClosed: false,
});
const MATIN = wave('matin', 0, ['poussin', 'pupille', 'benjamin', 'minime']);
const APREM = wave('aprem', 1, ['cadet', 'junior', 'senior', 'v1', 'v2', 'v3', 'v4', 'v5']);

test('règle : tranche la plus jeune', () => {
  expect(waveOfCategory({ key: key(['cadet', 'minime']), waveOverride: null }, [MATIN, APREM], grid)).toBe('matin');
  expect(waveOfCategory({ key: key(['senior']), waveOverride: null }, [MATIN, APREM], grid)).toBe('aprem');
  expect(waveOfCategory({ key: key(['espoir']), waveOverride: null }, [MATIN, APREM], grid)).toBeNull();
});

test('règle : discipline', () => {
  const kata = wave('kata', 0, [], ['kata']);
  const waves = [kata, { ...MATIN, order: 1 }, { ...APREM, order: 2 }];
  expect(waveOfCategory({ key: key(['senior'], 'kata'), waveOverride: null }, waves, grid)).toBe('kata');
  expect(waveOfCategory({ key: key(['minime'], 'kata'), waveOverride: null }, waves, grid)).toBe('kata');
  expect(waveOfCategory({ key: key(['minime']), waveOverride: null }, waves, grid)).toBe('matin');
});

test('règle vide : ne prend rien d’office', () => {
  expect(waveOfCategory({ key: key(['cadet']), waveOverride: null }, [wave('vide', 0, [])], grid)).toBeNull();
});

test('choix individuel prioritaire', () => {
  expect(waveOfCategory({ key: key(['minime']), waveOverride: 'aprem' }, [MATIN, APREM], grid)).toBe('aprem');
  expect(waveOfCategory({ key: key(['minime']), waveOverride: WAVE_NONE }, [MATIN, APREM], grid)).toBeNull();
  expect(waveOfCategory({ key: key(['minime']), waveOverride: 'disparue' }, [MATIN, APREM], grid)).toBe('matin');
});

test('ordre des sessions : la première qui correspond', () => {
  const both = wave('tout', 2, ['cadet']);
  expect(waveOfCategory({ key: key(['cadet']), waveOverride: null }, [both, APREM, MATIN], grid)).toBe('aprem');
});

test('conflits : catégorie couverte par deux sessions', () => {
  const large = wave('large', 2, ['cadet']);
  const cats = [{ id: 'c1', key: key(['cadet']), waveOverride: null }, { id: 'c2', key: key(['minime']), waveOverride: null }, { id: 'c3', key: key(['cadet']), waveOverride: 'large' }];
  expect(waveConflicts(cats, [MATIN, APREM, large], grid)).toEqual([{ categoryId: 'c1', waveIds: ['aprem', 'large'] }]);
});

test('conflits : tranche prise par deux sessions', () => {
  const large = wave('large', 2, ['cadet']);
  const cats: { id: string; key: CategoryKey; waveOverride: null; bandCounts: BandCounts }[] = [
    // Clé « minime » mais un cadet recasé vote : sa tranche est prise par deux sessions.
    { id: 'c1', key: key(['minime']), waveOverride: null, bandCounts: { minime: 2, cadet: 1 } },
    // Seuls des minimes votent : aucune tranche disputée, même si la clé contient « cadet ».
    { id: 'c2', key: key(['cadet', 'minime']), waveOverride: null, bandCounts: { minime: 1 } },
    // Tranche sans session : ne vote pas ; sans voix, la clé (tranche la plus jeune) décide.
    { id: 'c3', key: key(['cadet']), waveOverride: null, bandCounts: { espoir: 3 } },
  ];
  expect(waveConflicts(cats, [MATIN, APREM, large], grid)).toEqual([
    { categoryId: 'c1', waveIds: ['aprem', 'large'] },
    { categoryId: 'c3', waveIds: ['aprem', 'large'] },
  ]);
});

test('conflits : ignorés pour une catégorie figée', () => {
  const large = wave('large', 2, ['cadet']);
  const cats = [
    { id: 'c1', key: key(['cadet']), waveOverride: null, frozenWave: 'aprem', bandCounts: { cadet: 1 } },
    { id: 'c2', key: key(['cadet']), waveOverride: null, frozenWave: WAVE_NONE, bandCounts: { cadet: 1 } },
    // Session figée disparue : ignorée, la catégorie suit les règles et reste signalée.
    { id: 'c3', key: key(['cadet']), waveOverride: null, frozenWave: 'disparue', bandCounts: { cadet: 1 } },
  ];
  expect(waveConflicts(cats, [MATIN, APREM, large], grid)).toEqual([{ categoryId: 'c3', waveIds: ['aprem', 'large'] }]);
});

test('validation des sessions', () => {
  const r = { ageBandCodes: [], disciplines: [] };
  expect(validateWaves([])).toEqual([]);
  expect(validateWaves([{ name: ' ', rules: r }])).toEqual(['Une session n’a pas de nom.']);
  expect(validateWaves([{ name: 'Matin', rules: r }, { name: ' matin ', rules: r }])).toEqual(['Deux sessions portent le même nom : « Matin ».']);
  expect(validateWaves(Array.from({ length: 21 }, (_, i) => ({ name: `V${i}`, rules: r })))).toEqual(['Pas plus de 20 sessions.']);
  expect(validateWaves([{ id: 'w', name: 'A', rules: r }, { id: 'w', name: 'B', rules: r }])).toEqual(['La même session apparaît deux fois dans la liste.']);
});

test('relecture : catégorie d’arrivée d’une réaffectation — sa session suit la majorité de ses combattants, recasés compris', () => {
  // Cadets ayant reçu un minime recasé : clé « minime + cadet », deux cadets contre un minime → session des cadets
  expect(waveOfCategory({ key: key(['cadet', 'minime']), waveOverride: null, bandCounts: { cadet: 2, minime: 1 } }, [MATIN, APREM], grid)).toBe('aprem');
  // Un cadet et un minime recasé : égalité, la tranche la plus jeune (minime) l'emporte
  expect(waveOfCategory({ key: key(['cadet', 'minime']), waveOverride: null, bandCounts: { cadet: 1, minime: 1 } }, [MATIN, APREM], grid)).toBe('matin');
  // Sans combattant : clé de la catégorie
  expect(waveOfCategory({ key: key(['cadet', 'minime']), waveOverride: null, bandCounts: {} }, [MATIN, APREM], grid)).toBe('matin');
});

test('tableau libre : session seulement par choix individuel', () => {
  const kata = wave('kata', 0, [], ['kata']);
  const waves = [kata, MATIN];
  const key = freeKey('Gala', 'kata', null);
  expect(waveOfCategory({ key, waveOverride: null, bandCounts: {} }, waves, grid)).toBeNull();
  expect(waveOfCategory({ key, waveOverride: waves[0]!.id, bandCounts: {} }, waves, grid)).toBe(waves[0]!.id);
  expect(waveConflicts([{ id: 'c', key, waveOverride: null }], [kata, wave('k2', 1, [], ['kata'])], grid)).toEqual([]);
});

describe('session à la majorité', () => {
  const J = wave('J', 0, ['junior']);
  const S = wave('S', 1, ['senior']);
  const k = key(['junior', 'senior']);
  const of = (counts: Record<string, number>, waves: Wave[] = [J, S], extra: { waveOverride?: string | null; frozenWave?: string | null } = {}) =>
    waveOfCategory({ key: k, waveOverride: null, bandCounts: counts, ...extra }, waves, grid);

  test('vote : 2 seniors 1 junior → S', () => {
    expect(of({ senior: 2, junior: 1 })).toBe('S');
  });

  test('vote : 1-1 → J (plus jeune)', () => {
    expect(of({ senior: 1, junior: 1 })).toBe('J');
    // L'ordre des sessions ne change pas l'égalité : la tranche la plus jeune l'emporte.
    expect(of({ senior: 1, junior: 1 }, [{ ...S, order: 0 }, { ...J, order: 1 }])).toBe('J');
  });

  test('vote par session : junior 1, espoir 1, senior 1 avec Adultes = espoir+senior → Adultes', () => {
    const adultes = wave('Adultes', 1, ['espoir', 'senior']);
    expect(of({ junior: 1, espoir: 1, senior: 1 }, [J, adultes])).toBe('Adultes');
  });

  test('tranche hors session ne vote pas : 2 minimes (aucune session) + 1 senior → S', () => {
    expect(waveOfCategory({ key: key(['minime', 'senior']), waveOverride: null, bandCounts: { minime: 2, senior: 1 } }, [J, S], grid)).toBe('S');
  });

  test('sans voix : la clé décide (tranche la plus jeune)', () => {
    expect(of({})).toBe('J');
    expect(of({ minime: 3 })).toBe('J');
    expect(waveOfCategory({ key: k, waveOverride: null }, [J, S], grid)).toBe('J');
  });

  test('frozenWave prioritaire sur le vote', () => {
    expect(of({ senior: 3 }, [J, S], { frozenWave: 'J' })).toBe('J');
    expect(of({ junior: 3 }, [J, S], { frozenWave: 'S' })).toBe('S');
  });

  test('waveOverride prioritaire sur frozenWave', () => {
    expect(of({ senior: 3 }, [J, S], { frozenWave: 'J', waveOverride: 'S' })).toBe('S');
    expect(of({ senior: 3 }, [J, S], { frozenWave: 'J', waveOverride: WAVE_NONE })).toBeNull();
  });

  test("frozenWave 'none' → null", () => {
    expect(of({ senior: 3 }, [J, S], { frozenWave: WAVE_NONE })).toBeNull();
  });

  test('frozenWave inconnu ignoré', () => {
    expect(of({ senior: 3 }, [J, S], { frozenWave: 'disparue' })).toBe('S');
  });

  test('catégorie libre : pas de vote', () => {
    expect(waveOfCategory({ key: freeKey('Gala', 'karate', 'jiyu'), waveOverride: null, bandCounts: { senior: 3 } }, [J, S, wave('tout', 2, [], ['karate'])], grid)).toBeNull();
  });

  test('bandCounts : absents comptés avant le gel, pas après', () => {
    const members = [
      { ageBandCode: 'senior', presence: 'absent' as const },
      { ageBandCode: 'senior', presence: 'present' as const },
      { ageBandCode: 'junior', presence: 'unknown' as const },
      { ageBandCode: 'senior', presence: 'absent' as const },
    ];
    expect(bandCounts(members, false)).toEqual({ senior: 3, junior: 1 });
    expect(bandCounts(members, true)).toEqual({ senior: 1, junior: 1 });
    expect(of(bandCounts(members, false))).toBe('S');
    expect(of(bandCounts(members, true))).toBe('J');
  });
});
