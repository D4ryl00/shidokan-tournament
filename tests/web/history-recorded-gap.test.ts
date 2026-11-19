import { expect, test } from 'vitest';
import { recordedGap } from '../../src/web/components/history/HistoryEntryCard.js';

test('« Détails » de l’historique : l’écart au dixième avec la virgule, sans « ,0 » inutile', () => {
  expect(recordedGap({ kg: 7.25, max: 5 })).toBe(' · écart 7,3 kg (max 5)');
  expect(recordedGap({ kg: 6.04, max: 5 })).toBe(' · écart 6 kg (max 5)');
  expect(recordedGap({ kg: 5.05, max: 4.5 })).toBe(' · écart 5,1 kg (max 4,5)');
});
