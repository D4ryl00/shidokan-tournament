import { expect, test } from 'vitest';
import { clubFormLineSchema } from '../../src/server/routes/registrations.js';

const line = {
  lastName: 'MARTIN', firstName: 'Léa', sex: 'F', ageBandCode: 'cadet', weightClassId: null, weightKg: 52,
  combats: ['karate'], kata: false, grade: null, ruleset: 'jiyu', prefs: {}, shobuKeep: null,
};

test('licence de 20 caractères tapée avec des espaces : acceptée', () => {
  expect(clubFormLineSchema.safeParse({ ...line, licence: '1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0' }).success).toBe(true);
});
test('licence au-delà de 60 caractères : refusée', () => {
  expect(clubFormLineSchema.safeParse({ ...line, licence: 'X'.repeat(61) }).success).toBe(false);
});
