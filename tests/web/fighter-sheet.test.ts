import { expect, test } from 'vitest';
import { ffkDefaultGrid } from '../../src/domain/grid-ffk.js';
import type { RegistrationRow } from '../../src/domain/registration.js';
import type { RecasementEntry } from '../../src/web/api.js';
import { sheetLines } from '../../src/web/components/replacement/sheetLines.js';

const grid = ffkDefaultGrid();
const row = (over: Partial<RegistrationRow> = {}, fighter: Partial<RegistrationRow['fighter']> = {}): RegistrationRow => ({
  id: 'r1', competitionId: 'c', fighterId: 'f1', discipline: 'karate', ruleset: 'jiyu', weightClassId: 'cadet:M:-57',
  approxWeightKg: 59, otherDisciplines: ['shido-boxing', 'shido-mix'], acceptsJiyuFirst: null, source: 'ffk', ffkConfirmed: true,
  withdrawn: false, createdAt: '', weighInKg: 58.4, publicNameHidden: false, rev: '',
  fighter: { id: 'f1', competitionId: 'c', clubId: 'k', lastName: 'MARTIN', firstName: 'Lucas', sex: 'M', ageBandCode: 'cadet', licence: '0987654', grade: '1er kyu', ...fighter },
  club: { id: 'k', competitionId: 'c', name: 'Karaté Club Rennes', coachName: 'Coach Secret', phone: '0600000000', email: 'secret@club.fr' },
  ...over,
} as unknown as RegistrationRow);
const ctx = { grid, presence: 'present' as const, others: [], recasement: undefined };
const get = (lines: { label: string; value: string }[], label: string) => lines.find((l) => l.label === label)?.value;

test('lignes dans l’ordre de la spec', () => {
  const lines = sheetLines(row(), { ...ctx, others: [{ label: 'Kata · Cadets M', session: 'Après-midi' }] });
  expect(lines.map((l) => l.label)).toEqual(['Sexe · âge', 'Licence', 'Grade', 'Présence', 'Discipline', 'Accepte aussi', 'Origine', 'Autres inscriptions']);
  expect(get(lines, 'Sexe · âge')).toBe('Homme · Cadets');
  expect(get(lines, 'Licence')).toBe('0987654');
  expect(get(lines, 'Présence')).toBe('présent · pesé 58,4 kg (déclaré ≈ 59 kg)');
  expect(get(lines, 'Discipline')).toBe('Karaté · Jiyu · -57 kg');
  expect(get(lines, 'Accepte aussi')).toBe('Shido-boxing, puis Shido-mix-martial');
  expect(get(lines, 'Origine')).toBe('FFK · confirmé FFK ✓');
  expect(get(lines, 'Autres inscriptions')).toBe('Kata · Cadets M (session Après-midi)');
});

test('valeurs absentes, présences, aucune autre inscription', () => {
  const lines = sheetLines(row({ weighInKg: null, approxWeightKg: null, otherDisciplines: [], ffkConfirmed: false, source: 'manual' }, { licence: null, grade: null }), { ...ctx, presence: 'unknown' });
  expect(get(lines, 'Licence')).toBe('—');
  expect(get(lines, 'Grade')).toBe('—');
  expect(get(lines, 'Présence')).toBe('non pointé');
  expect(get(lines, 'Accepte aussi')).toBe('—');
  expect(get(lines, 'Origine')).toBe('Manuelle');
  expect(get(lines, 'Autres inscriptions')).toBe('aucune');
  expect(get(sheetLines(row({ weighInKg: null, approxWeightKg: null }), { ...ctx, presence: 'absent' }), 'Présence')).toBe('absent');
});

test('shobu et jiyu en priorité, réaffecté, ne combat pas', () => {
  const rec = { fromLabel: 'Cadets M -55 kg' } as RecasementEntry;
  const lines = sheetLines(row({ ruleset: 'shobu', acceptsJiyuFirst: true, withdrawn: true }), { ...ctx, recasement: rec });
  expect(get(lines, 'Accepte aussi')).toBe('Shido-boxing, puis Shido-mix-martial · accepte le jiyu en priorité');
  expect(get(lines, 'Réaffecté')).toBe('venu de Cadets M -55 kg (validé)');
  expect(get(lines, 'Ne combat pas')).toBe('oui');
});

test('aucune donnée de contact du club', () => {
  const text = JSON.stringify(sheetLines(row(), ctx));
  for (const s of ['Coach Secret', '0600000000', 'secret@club.fr', 'Rennes']) expect(text).not.toContain(s);
});
