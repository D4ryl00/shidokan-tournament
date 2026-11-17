import { expect, test } from 'vitest';
import { journalSearchText, journalText } from '../../src/domain/journal/text.js';
import { actorLabel } from '../../src/domain/journal/types.js';

test('combattant modifié : titre, changements', () => {
  const t = journalText({ action: 'fighter-changed', data: { subject: 'DUPONT Léa (Shidokan Lyon)', changes: [{ label: 'Grade', before: '2e kyu', after: '1er kyu' }] } });
  expect(t.title).toBe('DUPONT Léa (Shidokan Lyon) · modifié');
  expect(t.changes).toEqual([{ label: 'Grade', before: '2e kyu', after: '1er kyu' }]);
});
test.each([
  ['fighter-added', 'DUPONT Léa (Shidokan Lyon) · ajouté'],
  ['fighter-removed', 'DUPONT Léa (Shidokan Lyon) · supprimé'],
  ['presence', 'DUPONT Léa (Shidokan Lyon) · présence'],
])('titre de %s', (action, title) => expect(journalText({ action, data: { subject: 'DUPONT Léa (Shidokan Lyon)' } } as never).title).toBe(title));
test('poids : saisi ou corrigé selon l’avant', () => {
  expect(journalText({ action: 'weigh-in', data: { subject: 'MARTIN Hugo', changes: [{ label: 'Poids', before: null, after: '53,1 kg' }] } }).title).toBe('MARTIN Hugo · poids saisi');
  expect(journalText({ action: 'weigh-in', data: { subject: 'MARTIN Hugo', changes: [{ label: 'Poids', before: '52,4 kg', after: '53,1 kg' }] } }).title).toBe('MARTIN Hugo · poids corrigé');
});
test('entrée brute', () => expect(journalText({ action: 'raw', data: { method: 'PUT', route: '/api/competitions/:id/wave-schedules' } }).title)
  .toBe('Opération non détaillée : PUT /api/competitions/:id/wave-schedules'));
test('autres actions', () => {
  expect(journalText({ action: 'competition-created', data: {} }).title).toBe('Compétition créée');
  expect(journalText({ action: 'journal-opened', data: {} })).toEqual({ title: 'Journal ouvert', detail: 'Ce qui a été fait avant n’y figure pas.', changes: [] });
  expect(journalText({ action: 'weigh-in-closed', data: {} }).title).toBe('Pesée close');
  expect(journalText({ action: 'weigh-in-closed', data: { subject: 'Zone 1', detail: 'x' } })).toEqual({ title: 'Pesée close · Zone 1', detail: 'x', changes: [] });
});
test('qui', () => {
  expect(actorLabel({ kind: 'poste', poste: 'zone', zoneName: 'Zone 2' })).toBe('poste Zone 2');
  expect(actorLabel({ kind: 'poste', poste: 'table' })).toBe('poste Table centrale');
  expect(actorLabel({ kind: 'poste', poste: 'organisation' })).toBe('poste Organisation');
  expect(actorLabel({ kind: 'poste', poste: 'inconnu' })).toBe('poste inconnu');
  expect(actorLabel({ kind: 'club', clubName: 'Shidokan Lyon' })).toBe('Shidokan Lyon · lien du club');
  expect(actorLabel({ kind: 'account', email: 'orga@exemple.fr', role: 'organisateur' })).toBe('orga@exemple.fr');
  expect(actorLabel({ kind: 'app' })).toBe('l’appli');
});
test('texte de recherche : sans accents, majuscules, qui et comment compris', () => {
  const s = journalSearchText({ action: 'fighter-added', data: { subject: 'DUPONT Léa (Shidokan Lyon)' }, actor: { kind: 'poste', poste: 'table' }, via: 'sur-place' });
  expect(s).toContain('LEA'); expect(s).toContain('LYON'); expect(s).toContain('TABLE CENTRALE'); expect(s).toContain('INSCRIPTION SUR PLACE');
});
