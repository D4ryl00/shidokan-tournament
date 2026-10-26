import { Button, Group, Progress, Stack, Text } from '@mantine/core';
import { useEffect, useState } from 'react';
import type { LadderProgress } from '../../api.js';

/** Délai avant que la barre n'apparaisse : un calcul court ne fait pas clignoter l'écran. */
export const PROGRESS_DELAY_MS = 500;

/** Monté pendant un calcul du plan : après 500 ms, la barre d'avancement et « Annuler le calcul ». */
export function PlanProgress({ progress, onCancel }: { progress: LadderProgress | null; onCancel: () => void }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), PROGRESS_DELAY_MS);
    return () => clearTimeout(t);
  }, []);
  if (!visible) return null;
  return (
    <Stack gap={4} data-testid="plan-progress" role="status">
      <Group justify="space-between" wrap="wrap" gap="xs">
        <Text size="sm">{progress ? `Calcul du plan : ligne ${progress.done} sur ${progress.total}` : 'Calcul du plan…'}</Text>
        <Button size="compact-sm" variant="default" data-testid="plan-cancel" onClick={onCancel}>Annuler le calcul</Button>
      </Group>
      <Progress value={progress && progress.total > 0 ? (progress.done / progress.total) * 100 : 0} size="sm" aria-label="Avancement du calcul du plan" />
    </Stack>
  );
}
