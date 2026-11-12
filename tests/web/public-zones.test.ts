import { describe, expect, it } from 'vitest';
import { toPublicCompetition } from '../../src/domain/public/view.js';
import type { PublicTimes } from '../../src/domain/public/times.js';
import { currentWave, driftText, finalBadge, finalsLabel, finalsMarkers, involvesFollowed, sideText, versText, waitingWaves, waveHeaderText, zoneViews } from '../../src/web/components/public/zoneRows.js';
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
  it('une ligne par session non lancée, avec l’heure prévue si elle est connue', () => {
    const d = structuredClone(pub);
    const w = d.waves.find((x) => !x.launched)!;
    w.plannedStart = null;
    expect(waitingWaves(d)).toEqual([`${w.name} : numéros et horaires au lancement de la session.`]);
    w.plannedStart = '13:30';
    expect(waitingWaves(d)).toEqual([`${w.name} : numéros et horaires au lancement de la session, prévu vers\u00a013:30.`]);
    w.plannedStart = '09:05';
    expect(waitingWaves(d)).toEqual([`${w.name} : numéros et horaires au lancement de la session, prévu vers\u00a09:05.`]);
  });

  it('compétition passée : aucune heure', () => {
    const d = structuredClone(pub);
    d.phase = 'past';
    d.waves.forEach((w) => { w.plannedStart = '13:30'; });
    expect(waitingWaves(d).every((t) => !t.includes('prévu vers'))).toBe(true);
  });
});

describe('driftText', () => {
  it('retard, avance, à l’heure (moins de 3 min d’écart, -0 compris)', () => {
    expect(driftText(12)).toBe('en retard de 12 min');
    expect(driftText(-5)).toBe('en avance de 5 min');
    expect(driftText(2)).toBe('à l’heure');
    expect(driftText(-2)).toBe('à l’heure');
    expect(driftText(-0)).toBe('à l’heure');
    expect(driftText(3)).toBe('en retard de 3 min');
    expect(driftText(59)).toBe('en retard de 59 min');
  });
  it('une heure ou plus : en heures et minutes', () => {
    expect(driftText(433)).toBe('en retard de 7 h 13');
    expect(driftText(-65)).toBe('en avance de 1 h 05');
    expect(driftText(60)).toBe('en retard de 1 h 00');
  });
});

describe('versText', () => {
  it('« vers » et l’heure ne se séparent pas (espace insécable)', () => {
    expect(versText('9:30')).toBe('vers\u00a09:30');
  });
});

describe('finalsLabel', () => {
  it('avec l’heure de début des finales, sans elle', () => {
    expect(finalsLabel('Session 1')).toBe('Finales de la session 1');
    expect(finalsLabel('Session 1', '11:10')).toBe('Finales de la session 1 à partir de 11:10');
    expect(finalsLabel('Session 1', null)).toBe('Finales de la session 1');
  });
});

describe('finales dans la file', () => {
  // Ring (z2) : zone des finales de la session Matin ; file : passage non final, finale « Dès que finie », deux « Fin de session ».
  const d = structuredClone(pub);
  d.finalsZones = { w1: 'z2', w2: null };
  const base = item('z2', 5);
  const items = [
    { ...base, number: 1, finals: null },
    { ...base, number: 2, finals: 'ready' as const },
    { ...base, number: 3, finals: 'end' as const },
    { ...base, number: 4, finals: 'end' as const },
  ];
  it('la ligne « Finales de la session … » avant la première « Fin de session » de la zone des finales seulement', () => {
    expect([...finalsMarkers(d, items, 'z2', () => '11:10')]).toEqual([[2, 'Finales de la session Matin à partir de 11:10']]);
    expect(finalsMarkers(d, items, 'z1').size).toBe(0);
  });
  it('badge « Finale » sur les autres passages de finale', () => {
    expect(items.map((i) => finalBadge(d, i, 'z2'))).toEqual([false, true, false, false]);
    // Hors de la zone des finales (ou session sans zone des finales) : toute finale porte le badge.
    expect(items.map((i) => finalBadge(d, i, 'z1'))).toEqual([false, true, true, true]);
    expect(items.map((i) => finalBadge({ ...d, finalsZones: { w1: null } }, i, 'z2'))).toEqual([false, true, true, true]);
  });
});

describe('waveHeaderText', () => {
  const times = (start: { clock: string; estimated: boolean } | null): PublicTimes =>
    ({ at: () => null, waveStart: () => start, finalsAt: () => null, categoryFinalAt: () => null, drift: () => null });
  const wave = { id: 'w1', plannedStart: '09:30' };
  it('prévue et démarrée, démarrée estimée, parties absentes omises', () => {
    expect(waveHeaderText(pub, wave, times({ clock: '9:41', estimated: false }))).toBe(' · prévue 9:30 · démarrée 9:41');
    expect(waveHeaderText(pub, wave, times({ clock: '9:41', estimated: true }))).toBe(' · prévue 9:30 · démarrée vers\u00a09:41');
    expect(waveHeaderText(pub, wave, times(null))).toBe(' · prévue 9:30');
    expect(waveHeaderText(pub, { id: 'w1', plannedStart: null }, times(null))).toBe('');
  });
  it('compétition passée : rien', () => {
    expect(waveHeaderText({ ...pub, phase: 'past' }, wave, times({ clock: '9:41', estimated: false }))).toBe('');
  });
});
