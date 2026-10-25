import { Card } from '@mantine/core';
import type { ReactNode } from 'react';

/** Tableau dans une carte : sur un écran étroit, il défile de côté au lieu d'être coupé par le bord de la carte. */
export function TableCard({ children }: { children: ReactNode }) {
  return <Card padding={0} style={{ overflowX: 'auto' }}>{children}</Card>;
}
