import { expect, test } from 'vitest';
import type { FinalsWhen } from '../../src/domain/passages/index.js';
import { buildTimeline, zoneDrift, type TimelineInput, type TimelineItem } from '../../src/domain/schedule/timeline.js';

const h = (hh: number, mm: number) => hh * 3600 + mm * 60;
const item = (key: string, waveKey: string, durationSec: number, endedAt: number | null = null, finals: FinalsWhen | null = null, waitsFor?: string[]): TimelineItem => ({
  key, waveKey, durationSec, endedAt, finals, ...(waitsFor ? { waitsFor } : {}),
});
const wave = (key: string, plannedStart: number | null, actualStart: number | null = null, finalsStart: number | null = null, finalsZoneId: string | null = null) => ({
  key, plannedStart, actualStart, finalsStart, finalsZoneId,
});
const input = (p: Partial<TimelineInput> & Pick<TimelineInput, 'waves' | 'zones'>): TimelineInput => ({
  now: null, changeoverSec: 60, ...p,
});

test('planned start drives the first wave', () => {
  const t = buildTimeline(input({ now: null, waves: [wave('s1', h(9, 30))], zones: [{ zoneId: 'z', items: [item('a', 's1', 300), item('b', 's1', 300)] }] }));
  expect(t.starts.get('a')).toBe(h(9, 30));
  expect(t.starts.get('b')).toBe(h(9, 36));
  expect(t.waveStarts.get('s1')).toBeNull();
});

test('actual start beats planned', () => {
  const t = buildTimeline(input({ now: null, waves: [wave('s1', h(9, 30), h(9, 41))], zones: [{ zoneId: 'z', items: [item('a', 's1', 300)] }] }));
  expect(t.starts.get('a')).toBe(h(9, 41));
});

test('first result estimates the start', () => {
  const t = buildTimeline(input({ now: null, waves: [wave('s1', null)], zones: [{ zoneId: 'z', items: [item('a', 's1', 300, h(9, 50)), item('b', 's1', 300)] }] }));
  expect(t.waveStarts.get('s1')).toEqual({ at: h(9, 45), estimated: true });
  expect(t.starts.get('b')).toBe(h(9, 51));
});

test('a fight in progress that overruns pushes the next ones', () => {
  // Combat en cours : sa fin estimée n'est jamais avant maintenant (départ ≥ maintenant − durée).
  const t = buildTimeline(input({ now: h(10, 20), waves: [wave('s1', null, h(9, 30))], zones: [{ zoneId: 'z', items: [item('a', 's1', 300), item('b', 's1', 300)] }] }));
  expect(t.starts.get('a')).toBe(h(10, 15));
  expect(t.starts.get('b')).toBe(h(10, 21));
});

test('on time mid-fight: no drift, next estimate steady while now moves inside the fight', () => {
  const at = (now: number) => input({ now, waves: [wave('s1', h(9, 30), h(9, 30))], zones: [{ zoneId: 'z', items: [item('a', 's1', 300), item('b', 's1', 300), item('c', 's1', 300)] }] });
  for (const now of [h(9, 30), h(9, 33), h(9, 35)]) {
    const t = buildTimeline(at(now));
    expect(t.starts.get('a')).toBe(h(9, 30));
    expect(t.starts.get('b')).toBe(h(9, 36));
    expect(t.starts.get('c')).toBe(h(9, 42));
    expect(zoneDrift(at(now), 'z')).toBe(0);
  }
  // Le combat déborde de 2 min : les suivants glissent d'autant.
  const late = buildTimeline(at(h(9, 37)));
  expect(late.starts.get('a')).toBe(h(9, 32));
  expect(late.starts.get('b')).toBe(h(9, 38));
  expect(zoneDrift(at(h(9, 37)), 'z')).toBe(120);
});

test('only the first unplayed passage after a result is in progress', () => {
  // Le n° 2 vient de finir à 10:00 : le n° 3 part au changement, le n° 4 s'enchaîne (pas de plancher à maintenant).
  const t = buildTimeline(input({
    now: h(10, 0) + 30,
    waves: [wave('s1', h(9, 0))],
    zones: [{ zoneId: 'z', items: [item('1', 's1', 300, h(9, 55)), item('2', 's1', 300, h(10, 0)), item('3', 's1', 300), item('4', 's1', 300)] }],
  }));
  expect(t.starts.get('3')).toBe(h(10, 1));
  expect(t.starts.get('4')).toBe(h(10, 7));
});

test('a passage entered late has no time and pushes nothing', () => {
  // Kata n° 1 pas encore noté, combat n° 2 joué à 9:47 : le n° 1 n'a pas d'heure, le n° 3 part à 9:47 + changement.
  const zones = [{ zoneId: 'z', items: [item('1', 's1', 300), item('2', 's1', 300, h(9, 47)), item('3', 's1', 300)] }];
  for (const now of [null, h(9, 48), h(9, 50)]) {
    const inp = input({ now, waves: [wave('s1', h(9, 36))], zones });
    const t = buildTimeline(inp);
    expect(t.starts.has('1')).toBe(false);
    expect(t.starts.get('3')).toBe(h(9, 48));
    expect(zoneDrift(inp, 'z')).toBe(0);
  }
  // Sur une autre zone, ce passage sans heure ne retarde pas les finales.
  const t = buildTimeline(input({
    now: h(10, 2),
    waves: [wave('s1', null, h(9, 0), null, 'f')],
    zones: [
      { zoneId: 'f', items: [item('f1', 's1', 300, h(9, 50)), item('fin1', 's1', 300, null, 'end')] },
      { zoneId: 'o', items: [item('o1', 's1', 300), item('o2', 's1', 300, h(10, 0))] },
    ],
  }));
  expect(t.starts.has('o1')).toBe(false);
  expect(t.starts.get('fin1')).toBe(h(10, 0));
});

test('drift skips passages entered late', () => {
  const inp = input({
    now: null,
    waves: [wave('s1', h(9, 0))],
    zones: [{ zoneId: 'z', items: [item('1', 's1', 300), item('2', 's1', 300, h(9, 20)), item('3', 's1', 300)] }],
  });
  // Calculé sur le n° 3 (prévu 9:12, estimé 9:21), pas sur le n° 1 sans heure.
  expect(zoneDrift(inp, 'z')).toBe(h(9, 21) - h(9, 12));
});

test('now does not move a wave not started', () => {
  const t = buildTimeline(input({ now: h(15, 0), waves: [wave('s1', h(14, 0))], zones: [{ zoneId: 'z', items: [item('a', 's1', 300), item('b', 's1', 300)] }] }));
  expect(t.starts.get('a')).toBe(h(14, 0));
  expect(t.starts.get('b')).toBe(h(14, 6));
});

test('out-of-order results never move the cursor back', () => {
  const t = buildTimeline(input({
    now: null,
    waves: [wave('s1', h(9, 30))],
    zones: [{ zoneId: 'z', items: [item('1', 's1', 300, h(10, 0)), item('2', 's1', 300, h(10, 10)), item('3', 's1', 300, h(10, 2)), item('4', 's1', 300)] }],
  }));
  expect(t.starts.get('4')).toBe(h(10, 11));
});

test('restart numbering keeps wave order', () => {
  const t = buildTimeline(input({
    now: null,
    waves: [wave('s1', h(9, 0)), wave('s2', h(13, 0))],
    // file triée par numéro : s2 (n° 1, 2) avant s1 (n° 3, 4)
    zones: [{ zoneId: 'z', items: [item('s2-1', 's2', 300), item('s2-2', 's2', 300), item('s1-3', 's1', 300), item('s1-4', 's1', 300)] }],
  }));
  expect(t.starts.get('s1-3')).toBe(h(9, 0));
  expect(t.starts.get('s1-4')).toBe(h(9, 6));
  expect(t.starts.get('s2-1')).toBe(h(13, 0));
  expect(t.starts.get('s1-3')!).toBeLessThan(t.starts.get('s2-1')!);
});

test('a late wave does not shift the next one', () => {
  const zones = [{ zoneId: 'z', items: [item('a', 's1', 3600), item('b', 's2', 300)] }];
  const planned = buildTimeline(input({ now: null, waves: [wave('s1', h(10, 30)), wave('s2', h(11, 0))], zones }));
  expect(planned.starts.get('a')).toBe(h(10, 30));
  expect(planned.starts.get('b')).toBe(h(11, 0));
  const noTime = buildTimeline(input({ now: null, waves: [wave('s1', h(10, 30)), wave('s2', null)], zones }));
  expect(noTime.starts.has('b')).toBe(false);
  expect(noTime.waveStarts.get('s2')).toBeNull();
});

test('finals wait for the other zones', () => {
  const t = buildTimeline(input({
    now: null,
    waves: [wave('s1', h(9, 0), null, null, 'f')],
    zones: [
      { zoneId: 'f', items: [item('f1', 's1', 300, h(10, 30)), item('fin1', 's1', 300, null, 'end'), item('fin2', 's1', 300, null, 'end')] },
      { zoneId: 'o', items: [item('o1', 's1', 300, h(11, 10))] },
    ],
  }));
  expect(t.starts.get('fin1')).toBe(h(11, 10));
  expect(t.starts.get('fin2')).toBe(h(11, 16));
  expect(t.finalsStarts.get('s1')).toBe(h(11, 10));
});

test('fixed finals time wins', () => {
  const t = buildTimeline(input({
    now: null,
    waves: [wave('s1', h(9, 0), null, h(12, 0), 'f')],
    zones: [
      { zoneId: 'f', items: [item('f1', 's1', 300, h(10, 30)), item('fin1', 's1', 300, null, 'end')] },
      { zoneId: 'o', items: [item('o1', 's1', 300, h(11, 0))] },
    ],
  }));
  expect(t.starts.get('fin1')).toBe(h(12, 0));
  expect(t.finalsStarts.get('s1')).toBe(h(12, 0));
});

test('finals already begun do not wait again for the finals time', () => {
  // « Finales à » 12:00, mais la première finale a fini à 11:35 : la suivante s'enchaîne, sans revenir à 12:00.
  const t = buildTimeline(input({
    now: null,
    waves: [wave('s1', h(9, 0), null, h(12, 0), 'f')],
    zones: [
      { zoneId: 'f', items: [item('f1', 's1', 300, h(10, 30)), item('fin1', 's1', 300, h(11, 35), 'end'), item('fin2', 's1', 300, null, 'end')] },
      { zoneId: 'o', items: [item('o1', 's1', 300, h(11, 0))] },
    ],
  }));
  expect(t.starts.get('fin2')).toBe(h(11, 36));
  expect(t.finalsStarts.get('s1')).toBe(h(11, 30));
});

test('no start known gives no times', () => {
  const inp = input({ now: null, waves: [wave('s1', null)], zones: [{ zoneId: 'z', items: [item('a', 's1', 300)] }] });
  const t = buildTimeline(inp);
  expect(t.starts.size).toBe(0);
  expect(t.waveStarts.get('s1')).toBeNull();
  expect(zoneDrift(inp, 'z')).toBeNull();
});

test('drift compares with planned times only', () => {
  const items = [item('a', 's1', 300, h(9, 50)), item('b', 's1', 300)];
  const withPlan = input({ now: null, waves: [wave('s1', h(9, 30))], zones: [{ zoneId: 'z', items }] });
  expect(zoneDrift(withPlan, 'z')).toBe(h(9, 51) - h(9, 36));
  expect(zoneDrift(input({ now: null, waves: [wave('s1', null)], zones: [{ zoneId: 'z', items }] }), 'z')).toBeNull();
  const done = input({ now: null, waves: [wave('s1', h(9, 30))], zones: [{ zoneId: 'z', items: [item('a', 's1', 300, h(9, 50))] }] });
  expect(zoneDrift(done, 'z')).toBeNull();
});

test('drift follows wave order, not queue order', () => {
  const inp = input({
    now: null,
    waves: [wave('s1', h(9, 0)), wave('s2', h(13, 0))],
    zones: [{ zoneId: 'z', items: [item('s2-1', 's2', 300), item('s2-2', 's2', 300), item('s1-3', 's1', 300, h(9, 20)), item('s1-4', 's1', 300)] }],
  });
  expect(zoneDrift(inp, 'z')).toBe(h(9, 21) - h(9, 6));
});

test('fin de session sur sa zone, sans « Finales à »', () => {
  // La finale « Fin de session » de t1 se joue à la suite de sa file, sans attendre la zone des finales ni les autres zones.
  for (const finalsZoneId of ['f', null]) {
    const t = buildTimeline(input({
      waves: [wave('s1', h(9, 0), null, null, finalsZoneId)],
      zones: [
        { zoneId: 'f', items: [item('f1', 's1', 3600)] },
        { zoneId: 't1', items: [item('a1', 's1', 300), item('a2', 's1', 300), item('finA', 's1', 300, null, 'end')] },
      ],
    }));
    expect(t.starts.get('finA')).toBe(h(9, 12));
  }
});

test('fin de session sur sa zone, avec « Finales à »', () => {
  // La première finale « Fin de session » de chaque zone attend « Finales à » ; la zone des finales aussi (règle gardée).
  const t = buildTimeline(input({
    waves: [wave('s1', h(9, 0), null, h(11, 0), 'f')],
    zones: [
      { zoneId: 'f', items: [item('f1', 's1', 300), item('finF', 's1', 300, null, 'end'), item('finF2', 's1', 300, null, 'end')] },
      { zoneId: 't1', items: [item('a1', 's1', 3600), item('finA', 's1', 300, null, 'end'), item('finA2', 's1', 300, null, 'end')] },
    ],
  }));
  expect(t.starts.get('finA')).toBe(h(11, 0));
  expect(t.starts.get('finA2')).toBe(h(11, 6));
  expect(t.starts.get('finF')).toBe(h(11, 0));
  expect(t.finalsStarts.get('s1')).toBe(h(11, 0));
  // Sans « Finales à » : sur la zone des finales, la première attend la fin des éliminatoires de la session (t1 à 10:00).
  const sans = buildTimeline(input({
    waves: [wave('s1', h(9, 0), null, null, 'f')],
    zones: [
      { zoneId: 'f', items: [item('f1', 's1', 300), item('finF', 's1', 300, null, 'end')] },
      { zoneId: 't1', items: [item('a1', 's1', 3600), item('finA', 's1', 300, null, 'end')] },
    ],
  }));
  expect(sans.starts.get('finF')).toBe(h(10, 0));
  // Les finales des autres zones ne sont pas des éliminatoires : la zone des finales ne les attend pas.
  expect(sans.starts.get('finA')).toBe(h(10, 1));
});

test('dès que finie sur la zone des finales', () => {
  // Finale de A (catégorie de t1) sur la zone des finales f : elle part après la fin estimée des combats de A sur t1.
  const zones = (a2End: number | null) => [
    { zoneId: 'f', items: [item('f1', 's1', 300), item('finA', 's1', 300, null, 'ready', ['A1', 'A2']), item('finB', 's1', 300, null, 'end')] },
    { zoneId: 't1', items: [item('A1', 's1', 300), item('A2', 's1', 300, a2End), item('x', 's1', 1800)] },
  ];
  const t = buildTimeline(input({ waves: [wave('s1', h(9, 0), null, null, 'f')], zones: zones(null) }));
  expect(t.starts.get('A2')).toBe(h(9, 6));
  expect(t.starts.get('finA')).toBe(h(9, 11));
  // La finale « Fin de session » attend tous les éliminatoires (x finit à 9:42).
  expect(t.starts.get('finB')).toBe(h(9, 42));
  // Combat de A saisi plus tard que prévu : la finale l'attend.
  const late = buildTimeline(input({ now: null, waves: [wave('s1', h(9, 0), h(9, 0), null, 'f')], zones: zones(h(9, 30)) }));
  expect(late.starts.get('finA')).toBe(h(9, 30));
});

test('finale jouée en avance', () => {
  // Sur t1, n° 0 joué à 9:05, n° 1–3 non joués, finale n° 4 jouée en avance (fin 10:20) : 1–3 restent « à venir ».
  const now = h(10, 20) + 30;
  const inp = input({
    now,
    waves: [wave('s1', h(9, 0), h(9, 0))],
    zones: [{ zoneId: 't1', items: [
      item('0', 's1', 300, h(9, 5)), item('1', 's1', 300), item('2', 's1', 300), item('3', 's1', 300),
      item('4', 's1', 300, h(10, 20), 'ready'), item('5', 's1', 300),
    ] }],
  });
  const t = buildTimeline(inp);
  expect(t.starts.get('1')).toBe(h(10, 21));
  expect(t.starts.get('2')).toBe(h(10, 27));
  expect(t.starts.get('3')).toBe(h(10, 33));
  expect(t.starts.get('5')).toBe(h(10, 39));
  for (const k of ['1', '2', '3', '5']) expect(t.starts.get(k)!).toBeGreaterThan(now);
  // « En cours » : le premier non joué (n° 1), pas celui d'après la finale ; c'est lui qui donne l'avance ou le retard.
  const later = buildTimeline({ ...inp, now: h(10, 30) });
  expect(later.starts.get('1')).toBe(h(10, 25));
  expect(later.starts.get('5')).toBe(h(10, 43));
  expect(zoneDrift(inp, 't1')).toBe(h(10, 21) - h(9, 6));
  // Un passage non joué avant un éliminatoire joué reste, lui, saisi en retard (sans heure).
  const mixed = buildTimeline(input({
    waves: [wave('s1', h(9, 0))],
    zones: [{ zoneId: 't1', items: [item('1', 's1', 300), item('2', 's1', 300, h(9, 20)), item('3', 's1', 300, h(9, 26), 'ready'), item('4', 's1', 300)] }],
  }));
  expect(mixed.starts.has('1')).toBe(false);
  expect(mixed.starts.get('4')).toBe(h(9, 27));
});

test('finale avancée puis effacée', () => {
  const zones = (finalEnd: number | null) => [{ zoneId: 't1', items: [
    item('0', 's1', 300, h(9, 5)), item('1', 's1', 300), item('2', 's1', 300), item('3', 's1', 300, finalEnd, 'ready'), item('4', 's1', 300),
  ] }];
  const early = buildTimeline(input({ waves: [wave('s1', h(9, 0))], zones: zones(h(10, 20)) }));
  expect(early.starts.get('1')).toBe(h(10, 21));
  // Résultat de la finale retiré : retour aux heures normales.
  const cleared = buildTimeline(input({ waves: [wave('s1', h(9, 0))], zones: zones(null) }));
  expect(['1', '2', '3', '4'].map((k) => cleared.starts.get(k))).toEqual([h(9, 6), h(9, 12), h(9, 18), h(9, 24)]);
});
