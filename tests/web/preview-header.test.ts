import { expect, test } from 'vitest';
import { previewHeader } from '../../src/web/components/previewHeader.js';

const header = { club: 'Tani Dojo', coachName: null, coachPhone: null, coachEmails: [], preApproval: true };

test('fiche papier : le club choisi, sans ligne de coach', () => {
  expect(previewHeader(header, { paper: true })).toEqual({ title: 'Club : Tani Dojo', showCoach: false });
});

test('fichier : le nom du fichier n’est rappelé que s’il diffère du club choisi ou reconnu', () => {
  expect(previewHeader(header, {})).toEqual({ title: 'Club : Tani Dojo', showCoach: true });
  expect(previewHeader(header, { clubName: 'TANI  dojo' }).title).toBe('Club : TANI  dojo');
  expect(previewHeader(header, { clubName: 'Autre Club' }).title).toBe('Club : Autre Club (nom dans le fichier : Tani Dojo)');
});
