import { describe, expect, it } from 'vitest';
import { defaultFinalsChoice, resolveFinals, type WaveFinals } from '../../../src/domain/passages/finals-choice.js';

const wave = (o: Partial<WaveFinals> = {}): WaveFinals => ({
  waveKey: 'w',
  finalsZoneId: 'F',
  whereDefault: null,
  whenDefault: null,
  ...o,
});
const base = {
  kata: false,
  entrants: 8,
  zoneId: 'A',
  stored: { where: null, when: null },
  wave: wave(),
  mode: 'rounds' as const,
  accepts: () => true,
};

describe('défauts', () => {
  it('sans zone des finales', () => {
    expect(defaultFinalsChoice({ kata: false, mode: 'rounds', hasFinalsZone: false })).toEqual({ where: 'own', when: 'end' });
    expect(defaultFinalsChoice({ kata: false, mode: 'categories', hasFinalsZone: false })).toEqual({ where: 'own', when: 'ready' });
    expect(defaultFinalsChoice({ kata: true, mode: 'rounds', hasFinalsZone: false })).toEqual({ where: 'own', when: 'ready' });
  });
  it('avec zone des finales', () => {
    expect(defaultFinalsChoice({ kata: false, mode: 'rounds', hasFinalsZone: true })).toEqual({ where: 'finals', when: 'end' });
    expect(defaultFinalsChoice({ kata: true, mode: 'categories', hasFinalsZone: true })).toEqual({ where: 'finals', when: 'end' });
  });
});

describe('résolution', () => {
  it('stocké > « Tout… » > défaut', () => {
    const w = wave({ whereDefault: 'finals', whenDefault: 'ready' });
    expect(resolveFinals({ ...base, wave: w, stored: { where: 'own', when: null } })).toMatchObject({ finalZoneId: 'A', when: 'ready' });
    expect(resolveFinals({ ...base, wave: w }).finalZoneId).toBe('F');
    expect(resolveFinals({ ...base })).toMatchObject({ finalZoneId: 'F', when: 'end' });
    expect(resolveFinals({ ...base, wave: wave({ finalsZoneId: null }) })).toMatchObject({ finalZoneId: 'A', when: 'end' });
  });
  it('sans zone des finales : Où ignoré', () => {
    const r = resolveFinals({ ...base, stored: { where: 'finals', when: null }, wave: wave({ finalsZoneId: null }) });
    expect(r.finalZoneId).toBe('A');
    expect(r.onFinalsZone).toBe(false);
  });
  it('sans zone propre', () => {
    expect(resolveFinals({ ...base, zoneId: null }).finalZoneId).toBeNull();
  });
  it('catégorie de la zone des finales', () => {
    const r = resolveFinals({ ...base, kata: true, entrants: 3, zoneId: 'F', stored: { where: 'own', when: 'ready' } });
    expect(r).toMatchObject({ fixed: 'finals-zone', onFinalsZone: true, kataSplit: true, finalZoneId: 'F' });
  });
  it('zone qui n’accueille pas la discipline', () => {
    const r = resolveFinals({ ...base, stored: { where: 'finals', when: null }, accepts: () => false });
    expect(r).toMatchObject({ fixed: 'not-accepted', finalZoneId: 'A', onFinalsZone: false });
  });
  it('kata : bloc unique seulement sur sa zone et dès que finie', () => {
    const k = { ...base, kata: true, entrants: 5 };
    expect(resolveFinals({ ...k, stored: { where: 'own', when: 'ready' } }).kataSplit).toBe(false);
    expect(resolveFinals({ ...k, stored: { where: 'own', when: 'end' } }).kataSplit).toBe(true);
    expect(resolveFinals({ ...k, stored: { where: 'finals', when: 'ready' } }).kataSplit).toBe(true);
    expect(resolveFinals({ ...base, stored: { where: 'own', when: 'end' } }).kataSplit).toBe(false);
  });
  it('« Quand » par défaut suit le « Où » résolu', () => {
    const own = { where: 'own' as const, when: null };
    expect(resolveFinals({ ...base, kata: true, entrants: 5, stored: own })).toMatchObject({ when: 'ready', kataSplit: false });
    expect(resolveFinals({ ...base, mode: 'categories', stored: own }).when).toBe('ready');
    expect(resolveFinals({ ...base, mode: 'rounds', stored: own }).when).toBe('end');
    expect(resolveFinals({ ...base, kata: true, entrants: 5, accepts: () => false })).toMatchObject({
      fixed: 'not-accepted',
      when: 'ready',
      kataSplit: false,
    });
    expect(resolveFinals({ ...base, mode: 'categories', zoneId: 'F' }).when).toBe('end');
  });
  it('signature', () => {
    const a = resolveFinals({ ...base });
    expect(a.signature).toBe('F|end');
    expect(resolveFinals({ ...base, wave: wave({ finalsZoneId: 'G' }) }).signature).toBe('G|end');
  });
});
