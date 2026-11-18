import { Box, Button, Stack } from '@mantine/core';
import type { MoveDetailsBody } from '../../../domain/replacement/move-details.js';
import { useMoveDetails } from '../../api.js';
import { ApiErrorAlert } from '../ApiErrorAlert.js';
import { CategoryColumn, LoadingColumn } from './CategoryColumn.js';

/**
 * Dépliant « Détails » d'un déplacement : De (juste avant) et Vers (juste après), calculés à blanc par le serveur à l'ouverture.
 * Côte à côte, l'une sous l'autre sur un écran étroit.
 */
export function MoveDetails({ competitionId, waveId, body, fingerprint, sex }: {
  competitionId: string;
  waveId: string | null;
  body: MoveDetailsBody;
  fingerprint: string;
  sex: 'F' | 'M';
}) {
  const { data, error, refetch, isFetching } = useMoveDetails(competitionId, body, fingerprint, true);
  // Un nouveau calcul en arrière-plan qui échoue (données changées par un autre poste, plan pas encore recalculé) ne cache pas
  // les détails déjà affichés : l'erreur ne s'affiche que s'il n'y a rien à montrer.
  if (error && !data) {
    return (
      <Stack gap={6} align="flex-start" data-testid="move-details">
        <ApiErrorAlert error={error} />
        <Button size="compact-xs" variant="default" loading={isFetching} onClick={() => void refetch()}>Réessayer</Button>
      </Stack>
    );
  }
  return (
    <Box data-testid="move-details" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-start' }}>
      {data ? (
        <>
          <CategoryColumn side="from" category={data.from} movers={data.movers} competitionId={competitionId} waveId={waveId} sex={sex} />
          <CategoryColumn side="to" category={data.to} movers={data.movers} competitionId={competitionId} waveId={waveId} sex={sex} />
        </>
      ) : (
        <>
          <LoadingColumn side="from" />
          <LoadingColumn side="to" />
        </>
      )}
    </Box>
  );
}

/** Bouton « Détails ▾ / ▴ » qui ouvre ou ferme le dépliant. */
export function DetailsToggle({ open, onToggle, size = 'xs' }: { open: boolean; onToggle: () => void; size?: 'xs' | 'compact-xs' }) {
  return (
    <Button size={size} variant={open ? 'light' : 'default'} data-testid="move-details-toggle" aria-expanded={open} onClick={onToggle}>
      {open ? 'Détails ▴' : 'Détails ▾'}
    </Button>
  );
}
