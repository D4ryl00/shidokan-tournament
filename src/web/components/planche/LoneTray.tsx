import { Card, Stack, Text } from '@mantine/core';
import type { HTMLAttributes } from 'react';
import type { Category } from '../../../domain/categories.js';
import type { ProposalType } from '../../../domain/replacement/index.js';
import type { RecasementEntry } from '../../api.js';
import type { EntrantInfo } from '../BracketView.js';
import { FighterChip } from './FighterChip.js';
import { isLockedCategory } from './model.js';

export interface LoneItem { category: Category; registrationId: string; /** Session de la catégorie quand ce n'est pas celle affichée. */ sessionName: string | null }

/** Bac « Sans adversaire » : le seul présent de chaque catégorie qui n'en a qu'un. */
export function LoneTray({ items, entrants, badges, badgeDetails, chipProps, selectedChip = null }: {
  items: LoneItem[];
  entrants: Map<string, EntrantInfo>;
  badges: Map<string, ProposalType>;
  badgeDetails: Map<string, RecasementEntry>;
  chipProps?: (registrationId: string, category: Category) => HTMLAttributes<HTMLDivElement>;
  /** Pastille choisie (clic-clic). */
  selectedChip?: string | null;
}) {
  return (
    <Card withBorder padding="sm" data-testid="planche-tray" style={{ borderColor: 'var(--sk-card-line)' }}>
      <Stack gap="xs">
        <Text fw={700} size="sm">Sans adversaire ({items.length})</Text>
        <Text size="xs" c="dimmed">À glisser vers une catégorie, ou sur un combattant pour échanger.</Text>
        {items.length === 0 && <Text size="sm" c="dimmed" data-testid="planche-tray-empty">Tout le monde a un adversaire.</Text>}
        {items.map((it) => (
          <Stack key={it.category.id} gap={2} data-category-of={it.category.id}>
            <Text size="xs" c="dimmed" lh={1.25}>{it.category.label}{it.sessionName ? ` · ${it.sessionName}` : ''}</Text>
            <FighterChip id={it.registrationId} info={entrants.get(it.registrationId)} badge={badges.get(it.registrationId)} badgeDetail={badgeDetails.get(it.registrationId)}
              locked={!chipProps || isLockedCategory(it.category)} selected={selectedChip === it.registrationId} extra={chipProps?.(it.registrationId, it.category)} />
          </Stack>
        ))}
      </Stack>
    </Card>
  );
}
