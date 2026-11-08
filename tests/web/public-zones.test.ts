import { describe, expect, it } from 'vitest';
import { toPublicCompetition } from '../../src/domain/public/view.js';
import { currentWave, finalsLabel, finalsMarkers, involvesFollowed, sideText, waitingWaves, zoneViews } from '../../src/web/components/public/zoneRows.js';
import { source } from '../domain/public-fixtures.js';

const pub = toPublicCompetition(source());
const item = (zoneId: string, n: number) => {
  const i = pub.queues.find((q) => q.zoneId === zoneId)!.items.find((x) => x.number === n)!;
  expect(i).toBeDefined();
  return i;
};

describe('zoneViews', () => {
  it('découpe prochain / 3 suivants / reste, et ignore les zones sans passage', () => {
    const v = zoneViews(pub);
    expect(v.map((z) => z.name).sort()).toEqual(['Ring', 'Tatami 1', 'Tatami 2']);
    const t1 = v.find((z) => z.zoneId === 'z1')!;
    expect(t1.next?.number).toBe(12);
    expect(t1.shown.map((i) => i.number)).toEqual([15]);
    expect(t1.rest).toEqual([]);
    expect(t1.done).toBe(false);
  });

  it('au-delà de 3 suivants, le reste est replié', () => {
    const big = structuredClone(pub);
    const items = Array.from({ length: 6 }, (_, i) => ({ ...big.queues[0]!.items[0]!, number: 100 + i, state: 'ready' as const }));
    big.queues = [{ zoneId: 'z1', items }];
    const z = zoneViews(big)[0]!;
    expect([z.next?.number, z.shown.length, z.rest.length]).toEqual([100, 3, 2]);
  });

  it('zone dont tout est joué : terminée', () => {
    const d = structuredClone(pub);
    d.queues = [{ zoneId: 'z1', items: d.queues.find((q) => q.zoneId === 'z1')!.items.map((i) => ({ ...i, state: 'played' as const })) }];
    expect(zoneViews(d)[0]).toMatchObject({ zoneId: 'z1', next: null, done: true });
  });
});

describe('sideText', () => {
  const m12 = item('z1', 12);
  const final = item('z2', 5);
  it('nom court, ou origine du côté inconnu', () => {
    expect(sideText(pub, m12.a, m12.aFrom, 'z1')).toBe(pub.entrants[m12.a!]!.shortName);
    expect(sideText(pub, final.a, final.aFrom, 'z2')).toBe('le vainqueur du n° 12, Tatami 1');
    expect(sideText(pub, null, null, 'z1')).toBe('à déterminer');
    expect(sideText(pub, 'inconnue', null, 'z1')).toBe('à déterminer');
  });
});

describe('involvesFollowed', () => {
  it('combat : un des deux côtés connus', () => {
    const m12 = item('z1', 12);
    const fid = pub.entrants[m12.a!]!.fighterId!;
    expect(involvesFollowed(pub, m12, new Set([fid]))).toBe(true);
    expect(involvesFollowed(pub, m12, new Set(['f999']))).toBe(false);
  });

  it('bloc de kata : tous les inscrits de la catégorie', () => {
    const kata = item('z2', 1);
    expect(kata.matchId).toBeNull();
    expect(involvesFollowed(pub, kata, new Set(['f2']))).toBe(true);
    expect(involvesFollowed(pub, kata, new Set(['f14']))).toBe(false);
  });
});

describe('waitingWaves', () => {
  it('une ligne par session non lancée', () => {
    expect(waitingWaves(pub)).toEqual(['Après-midi : numéros au lancement de la session.']);
  });
});

describe('session en cours', () => {
  it('la première session lancée qui a encore un passage ; toutes jouées : la dernière, terminée ; aucune : rien', () => {
    expect(currentWave(pub)).toEqual({ name: 'Matin', done: false });
    const played = structuredClone(pub);
    played.queues = played.queues.map((q) => ({ ...q, items: q.items.map((i) => ({ ...i, state: 'played' as const })) }));
    expect(currentWave(played)).toEqual({ name: 'Matin', done: true });
    const none = structuredClone(pub);
    none.waves = none.waves.map((w) => ({ ...w, launched: false }));
    expect(currentWave(none)).toBeNull();
  });
});

describe('finales de la session', () => {
  it('libellé sans répéter « session »', () => {
    expect(finalsLabel('Session 1')).toBe('Finales de la session 1');
    expect(finalsLabel('Session unique')).toBe('Finales de la session unique');
    expect(finalsLabel('Matin')).toBe('Finales de la session Matin');
  });

  it('une ligne avant la première finale de chaque session, rien sans finale', () => {
    const base = pub.queues.find((q) => q.zoneId === 'z2')!.items;
    const own = { ...base[0]!, finals: false };
    const final = (n: number, waveId: string) => ({ ...base[1]!, number: n, waveId, finals: true });
    const two = structuredClone(pub);
    two.waves = [{ id: 'w1', name: 'Session 1', launched: true }, { id: 'w2', name: 'Session 2', launched: true }];
    expect([...finalsMarkers(two, [own, final(5, 'w1'), final(6, 'w1'), { ...own, number: 7, waveId: 'w2' }, final(8, 'w2')])]).toEqual([
      [1, 'Finales de la session 1'],
      [4, 'Finales de la session 2'],
    ]);
    expect(finalsMarkers(pub, base).size).toBe(0);
  });
});
