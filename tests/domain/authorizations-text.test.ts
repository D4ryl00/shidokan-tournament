import { describe, expect, test } from 'vitest';
import { MISSING_WEIGHT_BULLET } from '../../src/domain/authorizations.js';
import { allClubsMessage, clubMessage, messageRows, type MessageRequest } from '../../src/domain/authorizations-text.js';

const AGE = 'Passage des benjamines à un groupe commun Benjamines–Minimes en karaté.';
const WEIGHT = 'Écart de poids estimé avec ses adversaires : 7 kg maximum.';
const MIX = 'Groupe mixte filles et garçons.';

const req = (over: Partial<MessageRequest>): MessageRequest => ({
  fighterId: 'f1', label: 'DUPONT Léa', status: 'pending', bullet: AGE, current: 'Karaté Jiyu · Benjamines −40', ...over,
});

describe('messageRows', () => {
  test('deux combattants : demande accordée exclue, poids manquant inclus, ordre gardé', () => {
    const rows = messageRows([
      req({ bullet: AGE }),
      req({ bullet: WEIGHT, status: 'granted' }),
      req({ fighterId: 'f2', label: 'MARTIN Hugo', bullet: MISSING_WEIGHT_BULLET, status: 'info' }),
    ]);
    expect(rows).toEqual([
      { label: 'DUPONT Léa', bullets: [AGE] },
      { label: 'MARTIN Hugo', bullets: [MISSING_WEIGHT_BULLET] },
    ]);
  });

  test('combattant dont tout est accordé : absent', () => {
    expect(messageRows([req({ status: 'granted' }), req({ fighterId: 'f2', label: 'B', bullet: MIX })])).toEqual([{ label: 'B', bullets: [MIX] }]);
  });

  test('inscrit dans deux disciplines : un seul combattant, la discipline devant chaque puce', () => {
    const rows = messageRows([
      req({ bullet: AGE }),
      req({ bullet: MIX, current: 'Shido-boxing · Benjamines −40' }),
    ]);
    expect(rows).toEqual([{ label: 'DUPONT Léa', bullets: [`Karaté Jiyu : ${AGE}`, `Shido-boxing : ${MIX}`] }]);
  });
});

describe('clubMessage', () => {
  test('salutation, combattants numérotés, puces, demande des accords et des poids', () => {
    const text = clubMessage({ name: 'Karaté Lyon' }, [
      { label: 'DUPONT Léa', bullets: [AGE, WEIGHT] },
      { label: 'MARTIN Hugo', bullets: [MISSING_WEIGHT_BULLET] },
    ]);
    expect(text).toBe([
      'Bonjour,',
      '',
      'Voici les points à valider pour vos combattants (Karaté Lyon) :',
      '',
      '1. DUPONT Léa',
      `   - ${AGE}`,
      `   - ${WEIGHT}`,
      '2. MARTIN Hugo',
      `   - ${MISSING_WEIGHT_BULLET}`,
      '',
      'Merci de nous confirmer votre accord pour ces changements et de nous indiquer les poids demandés.',
    ].join('\n'));
  });

  test('accords seulement / poids seulement : la demande s’adapte', () => {
    expect(clubMessage({ name: 'A' }, [{ label: 'X', bullets: [AGE] }])).toMatch(/\nMerci de nous confirmer votre accord pour ces changements\.$/);
    expect(clubMessage({ name: 'A' }, [{ label: 'X', bullets: [`Karaté Jiyu : ${MISSING_WEIGHT_BULLET}`] }])).toMatch(/\nMerci de nous indiquer les poids demandés\.$/);
  });

  test('sans nom de club : pas de parenthèse vide', () => {
    const text = clubMessage({ name: '' }, [{ label: 'X', bullets: [AGE] }]);
    expect(text).toContain('Voici les points à valider pour vos combattants :');
    expect(text).not.toContain('()');
  });

  test('rien à demander : texte vide', () => {
    expect(clubMessage({ name: 'A' }, [])).toBe('');
  });
});

describe('allClubsMessage', () => {
  test('un bloc par club qui a quelque chose à demander, nommé, « Sans club » pour le nom vide', () => {
    const text = allClubsMessage([
      { name: 'Alpha', rows: [{ label: 'X', bullets: [AGE] }] },
      { name: 'Beta', rows: [] },
      { name: '', rows: [{ label: 'Y', bullets: [MIX] }] },
    ]);
    const blocks = text.split('\n\n\n');
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toBe(`=== Alpha ===\n${clubMessage({ name: 'Alpha' }, [{ label: 'X', bullets: [AGE] }])}`);
    expect(blocks[1]).toBe(`=== Sans club ===\n${clubMessage({ name: '' }, [{ label: 'Y', bullets: [MIX] }])}`);
    expect(text).not.toContain('Beta');
  });
});
