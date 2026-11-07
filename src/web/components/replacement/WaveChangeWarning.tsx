import { Alert, Stack, Text } from '@mantine/core';
import type { Proposal } from '../../../domain/replacement/index.js';
import type { Wave } from '../../../domain/waves.js';

/**
 * Ce qu'entraîne un changement de vague : le combattant (et ceux que sa catégorie emmène) repasse « non pesé »
 * dans sa nouvelle vague ; vague d'arrivée déjà clôturée ou catégorie en attente signalées.
 */
export function WaveChangeWarning({ proposal, waves, name }: { proposal: Proposal | undefined; waves: Wave[]; name: (registrationId: string) => string }) {
  if (!proposal || (!proposal.waveChange && proposal.waveShifts.length === 0)) return null;
  const waveName = (w: string | null) => waves.find((x) => x.id === w)?.name ?? 'en attente';
  const where = (to: string | null) => (to === null ? 'dans une catégorie en attente (dans aucune session)' : `dans la session « ${waveName(to)} »`);
  const then = (to: string | null) =>
    to === null
      ? 'il n’apparaîtra dans aucune pesée tant qu’elle n’est pas placée dans une session (écran Sessions).'
      : waves.find((w) => w.id === to)?.weighInClosed
        ? 'la pesée de cette session est déjà clôturée : pointez-le à la main dans l’écran Pesée.'
        : 'à pointer (et à peser si besoin) dans cette session.';
  return (
    <Alert color="grape" data-testid="wave-change-warning">
      <Stack gap={4}>
        {proposal.waveChange && (
          <Text size="sm">
            {name(proposal.registrationId)} passera {where(proposal.waveChange.to)} : {then(proposal.waveChange.to)} Son poids déjà relevé est gardé.
          </Text>
        )}
        {proposal.waveShifts.map((x) => (
          <Text size="sm" key={x.registrationId}>
            {x.label}, dont la catégorie change de session, passera {where(x.to)} : {then(x.to)}
          </Text>
        ))}
      </Stack>
    </Alert>
  );
}
