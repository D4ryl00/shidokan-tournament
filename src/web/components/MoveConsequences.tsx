import { Alert, Stack, Text } from '@mantine/core';
import type { Wave } from '../../domain/waves.js';
import type { PreviewData } from '../api.js';
import { ProposalPreview } from './ProposalPreview.js';
import { WaveChangeWarning, type WaveEffects } from './replacement/WaveChangeWarning.js';

/**
 * Ce qu'entraîne un déplacement ou un échange fait à la main, avant confirmation : règles enfreintes (orange), même club au
 * 1er tour (orange), changements de session, et l'aperçu des tableaux quand il y en a un.
 */
export function MoveConsequences({ pending, warnings = [], sameClub = [], waveEffects, waves, name, preview }: {
  pending: boolean;
  warnings?: string[];
  sameClub?: string[];
  waveEffects: (WaveEffects | undefined)[];
  waves: Wave[];
  name: (registrationId: string) => string;
  preview?: PreviewData;
}) {
  return (
    <>
      {pending && <Text size="sm">Calcul de l’aperçu…</Text>}
      {warnings.length > 0 && (
        <Alert color="orange" title="Règles enfreintes" data-testid="move-warnings">
          <Stack gap={2}>{warnings.map((w) => <Text key={w} size="sm">{w}</Text>)}</Stack>
        </Alert>
      )}
      {sameClub.map((s) => <Text key={s} size="sm" c="orange" data-testid="move-same-club">{s}</Text>)}
      {waveEffects.map((p, i) => <WaveChangeWarning key={p?.registrationId ?? i} proposal={p} waves={waves} name={name} />)}
      {preview && <ProposalPreview data={preview} />}
    </>
  );
}
