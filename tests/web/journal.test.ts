import { expect, test } from 'vitest';
import type { JournalEntryView, JournalType } from '../../src/domain/journal/types.js';
import { groupByDay, highlight, hhmm, receivedNote, toggleType } from '../../src/web/journal.js';

let seq = 0;
const e = (at: string, extra: Partial<JournalEntryView> = {}): JournalEntryView => ({
  id: `e${++seq}`, seq, type: 'inscription', action: 'fighter-added', at: new Date(at).toISOString(), clientAt: null,
  actor: { kind: 'poste', poste: 'organisation' }, via: 'sur-place', data: { subject: 'DUPONT Léa (Tani Dojo)' }, children: [], open: false, ...extra,
});

test('groupByDay : jours décroissants, libellé français', () => {
  expect(groupByDay([e('2026-11-22T10:42:00'), e('2026-11-22T09:58:00'), e('2026-11-18T18:30:00')]).map((g) => g.day))
    .toEqual(['Dimanche 22 novembre', 'Mercredi 18 novembre']); // le 22 novembre 2026 est un dimanche;
});

test('groupByDay : chaque jour garde ses entrées dans l’ordre reçu ; rien → aucun jour', () => {
  const [a, b, c] = [e('2026-11-22T10:42:00'), e('2026-11-22T09:58:00'), e('2026-11-18T18:30:00')];
  expect(groupByDay([a!, b!, c!]).map((g) => g.entries.map((x) => x.id))).toEqual([[a!.id, b!.id], [c!.id]]);
  expect(groupByDay([])).toEqual([]);
});

test('highlight sans accents', () => expect(highlight('DUPONT Léa', 'lea').filter((p) => p.hit).map((p) => p.text)).toEqual(['Léa']));

test('highlight : tous les mots, sans casse, chaque occurrence ; morceaux recollés au texte d’origine', () => {
  const parts = highlight('Léa DUPONT (Shidokan Lyon) · Léa', 'dupont LEA');
  expect(parts.filter((p) => p.hit).map((p) => p.text)).toEqual(['Léa', 'DUPONT', 'Léa']);
  expect(parts.map((p) => p.text).join('')).toBe('Léa DUPONT (Shidokan Lyon) · Léa');
});

test('highlight : recherche vide ou absente → un seul morceau non surligné', () => {
  expect(highlight('DUPONT Léa', '')).toEqual([{ text: 'DUPONT Léa', hit: false }]);
  expect(highlight('DUPONT Léa', '  ')).toEqual([{ text: 'DUPONT Léa', hit: false }]);
  expect(highlight('DUPONT Léa', 'martin')).toEqual([{ text: 'DUPONT Léa', hit: false }]);
});

test('highlight : texte déjà décomposé (accent séparé) et apostrophes', () => {
  expect(highlight('Léa', 'lea')).toEqual([{ text: 'Léa', hit: true }]);
  expect(highlight('Dojo de l’Est', 'l est').filter((p) => p.hit).map((p) => p.text)).toEqual(['l', 'Est']);
});

test('hhmm : heure locale sur deux chiffres', () => {
  expect(hhmm(new Date('2026-11-22T09:05:00').toISOString())).toBe('09:05');
});

test('receivedNote : seulement pour une saisie faite sur un portable', () => {
  expect(receivedNote(e('2026-11-22T15:14:00'))).toBeNull();
  expect(receivedNote(e('2026-11-22T15:14:00', { clientAt: new Date('2026-11-22T15:12:00').toISOString() })))
    .toBe('saisi 15:12 sur le portable, reçu 15:14');
});

test('toggleType : ajoute ou retire, dans l’ordre du filtre', () => {
  const t: JournalType[] = [];
  expect(toggleType(t, 'pesee')).toEqual(['pesee']);
  expect(toggleType(['pesee'], 'inscription')).toEqual(['inscription', 'pesee']);
  expect(toggleType(['inscription', 'pesee'], 'inscription')).toEqual(['pesee']);
});
