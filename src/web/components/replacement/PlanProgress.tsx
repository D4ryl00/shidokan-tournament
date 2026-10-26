import { Button, Group, Progress, Stack, Text } from '@mantine/core';
import { useEffect, useState } from 'react';
import type { LadderProgress } from '../../api.js';

/** Délai avant que la barre n'apparaisse : un calcul court ne fait pas clignoter l'écran. */
export const PROGRESS_DELAY_MS = 500;
/** Hauteur fixe de la progression (place gardée par l'écran : son arrivée ne décale rien). */
export const PROGRESS_HEIGHT = 52;

/** Monté pendant un calcul du plan, à droite du titre de la section (ne recouvre aucune commande) : après 500 ms, la barre d'avancement et « Annuler le calcul ». */
export function PlanProgress({ progress, onCancel }: { progress: LadderProgress | null; onCancel: () => void }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), PROGRESS_DELAY_MS);
    return () => clearTimeout(t);
  }, []);
  if (!visible) return null;
  return (
    <Stack gap={4} w={280} maw="100%" h={PROGRESS_HEIGHT} justify="center" data-testid="plan-progress" role="status">
      <Text size="sm" truncate>{progress ? `Calcul du plan : ligne ${progress.done} sur ${progress.total}` : 'Calcul du plan…'}</Text>
      <Group wrap="nowrap" gap="xs">
        <Progress style={{ flex: 1 }} value={progress && progress.total > 0 ? (progress.done / progress.total) * 100 : 0} size="sm" aria-label="Avancement du calcul du plan" />
        <Button size="compact-sm" variant="default" data-testid="plan-cancel" onClick={onCancel}>Annuler le calcul</Button>
      </Group>
    </Stack>
  );
}
