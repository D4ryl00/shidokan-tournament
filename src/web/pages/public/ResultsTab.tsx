import { Text } from '@mantine/core';
import type { PublicTabProps } from './tabProps.js';

/** Onglet « Résultats » : emplacement, rempli plus tard (Task 8). */
export function ResultsTab(_props: PublicTabProps) {
  return <Text c="dimmed" size="sm" data-testid="tab-ResultsTab">Résultats : bientôt disponible.</Text>;
}
