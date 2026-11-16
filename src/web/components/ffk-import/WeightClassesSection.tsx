import { Checkbox, Paper, SimpleGrid, Text } from '@mantine/core';
import type { FfkCardsPlan } from '../../../domain/ffk-plan/plan.js';
import { plural } from '../../../domain/plural.js';
import type { CategoryGrid } from '../../../domain/types.js';
import { weightClassTitle } from '../../labels.js';

/**
 * 1. Catégories de poids que l’export utilise et que la grille n’a pas : une case par catégorie, décochée par défaut.
 * Cochée, elle sera créée à l’import et ses combattants y sont placés.
 */
export function WeightClassesSection({ grid, weightClasses, accepted, onToggle }: {
  grid: CategoryGrid | undefined;
  weightClasses: FfkCardsPlan['weightClasses'];
  /** Catégories cochées (`choices.acceptedWeightClasses`) : la case suit le clic sans attendre l’aperçu. */
  accepted: string[];
  onToggle: (weightClassId: string, accepted: boolean) => void;
}) {
  if (weightClasses.length === 0) return <Text size="sm" c="dimmed">Toutes les catégories de poids de l’export sont dans la grille.</Text>;
  return (
    <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="xs">
      {weightClasses.map((w) => {
        const on = accepted.includes(w.id);
        return (
          <Paper key={w.id} withBorder p="sm" radius="md" data-testid="ffk-weight-class" style={{ backgroundColor: 'var(--sk-bg)' }}>
            <Checkbox checked={on} onChange={(e) => onToggle(w.id, e.currentTarget.checked)}
              label={<b>{weightClassTitle(grid, w)}</b>}
              description={`${plural(w.fighters, 'combattant')} · ${on ? 'sera créée' : 'pas créée'}`} />
          </Paper>
        );
      })}
    </SimpleGrid>
  );
}
