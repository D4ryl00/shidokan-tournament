import { Alert } from '@mantine/core';
import { DISCIPLINES } from '../../domain/disciplines.js';
import type { PassagePlan } from '../../domain/passages/index.js';

/** Disciplines qu'aucune zone n'accepte : leurs catégories restent sans zone ni numéro. */
export function ZonesImpossibleAlert({ impossible }: { impossible: PassagePlan['impossible'] | undefined }) {
  if (!impossible?.length) return null;
  const counts = new Map<string, number>();
  for (const x of impossible) counts.set(x.discipline, (counts.get(x.discipline) ?? 0) + 1);
  const list = [...counts].map(([d, n]) => `${DISCIPLINES[d as keyof typeof DISCIPLINES].label} (${n} catégorie${n > 1 ? 's' : ''})`).join(', ');
  return (
    <Alert color="red" data-testid="zones-impossible" title="Catégories sans zone possible">
      Aucune zone n’accepte : {list}. Cochez la discipline sur au moins une zone (Réglages › Zones de combat) ou épinglez ces catégories à la main.
    </Alert>
  );
}
