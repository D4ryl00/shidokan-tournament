import { Box, Button, Drawer, Group, Loader, SegmentedControl, Stack, Text } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { useState } from 'react';
import { filterOfKind, type HistoryFilter } from '../../../domain/history/types.js';
import type { HistoryEntryView } from '../../../domain/history/types.js';
import { useHistory } from '../../api.js';
import { StatusBadge } from '../ui/StatusBadge.js';
import { alsoText, HistoryEntryCard, useHoverTargets } from './HistoryEntryCard.js';
import { lotOf, hhmm } from './lot.js';
import { useUndoDialog } from './undo-dialog-context.js';

const FILTERS: { value: HistoryFilter; label: string }[] = [
  { value: 'all', label: 'Tout' }, { value: 'plan', label: 'Plan' }, { value: 'manual', label: 'À la main' }, { value: 'tab', label: 'Tableaux' },
];

/** Largeur du panneau en tiroir (px) : au-dessus de `lg`, la page se resserre d'autant. */
export const HISTORY_DRAWER_WIDTH = 400;

/** Un plan d'ensemble appliqué : ses déplacements dedans, et « Annuler tout le plan… ». */
function PlanBlock({ items, all, onSee }: { items: HistoryEntryView[]; all: HistoryEntryView[]; onSee?: (categoryIds: string[]) => void }) {
  const { requestUndoDialog } = useUndoDialog();
  const live = items.filter((e) => e.status === 'active');
  const undoable = live.filter((e) => !e.blocked);
  const ids = undoable.map((e) => e.id);
  const hover = useHoverTargets(ids);
  const groupId = items[0]!.groupId;
  const extra = lotOf(all, ids).filter((e) => e.groupId !== groupId);
  const newest = items.reduce((a, b) => (b.seq > a.seq ? b : a));
  return (
    <Box p="xs" data-testid="history-plan" data-plan={groupId ?? undefined} style={{ border: '1px solid var(--sk-line)', borderRadius: 8, backgroundColor: 'var(--sk-card)' }}>
      <Group gap={6} wrap="wrap" mb={2}>
        <Text size="xs" c="dimmed" className="num">{hhmm(newest.createdAt)}</Text>
        <StatusBadge tone="accent" size="sm">Plan</StatusBadge>
        {live.length === 0 && <StatusBadge tone="neutral" size="sm">Annulé</StatusBadge>}
      </Group>
      <Text size="sm" fw={600}>Plan d’ensemble appliqué · {items.length} déplacements</Text>
      {live.length > 0 && (
        <Group gap="xs" mt={6} wrap="wrap">
          {undoable.length < live.length && (
            <Text size="xs" c="red" style={{ flex: '1 1 100%' }}>{live.length - undoable.length} ne peut pas être annulé (catégorie lancée)</Text>
          )}
          {extra.length > 0 && <Text size="xs" style={{ color: 'var(--sk-warn-text)', overflowWrap: 'anywhere', flex: '1 1 100%' }} data-testid="history-also">{alsoText(extra)}</Text>}
          <Button size="compact-sm" variant="light" color="red" data-testid="history-undo-plan" disabled={undoable.length === 0} {...hover}
            onClick={() => requestUndoDialog(ids, { plan: true, staying: live.filter((e) => e.blocked).map((e) => e.id) })}>
            Annuler tout le plan…
          </Button>
        </Group>
      )}
      <Stack gap={6} mt="xs" pl="xs">
        {items.map((e) => <HistoryEntryCard key={e.id} entry={e} all={all} nested onSee={onSee} />)}
      </Stack>
    </Box>
  );
}

function HistoryList({ competitionId, waveId, onSee }: { competitionId: string; waveId: string | null; onSee?: (categoryIds: string[]) => void }) {
  const { data } = useHistory(competitionId, waveId);
  const { data: everything } = useHistory(competitionId, null);
  const [filter, setFilter] = useState<HistoryFilter>('all');
  if (!data) return <Loader size="sm" />;
  const all = everything?.entries ?? data.entries;
  const shown = data.entries.filter((e) => filter === 'all' || filterOfKind(e.kind) === filter);
  const seen = new Set<string>();
  return (
    <Stack gap="xs" data-testid="history-panel">
      <SegmentedControl size="xs" fullWidth data-testid="history-filter" value={filter} onChange={(v) => setFilter(v as HistoryFilter)} data={FILTERS} />
      {data.entries.length === 0 && <Text size="sm" c="dimmed">Aucune action pour l’instant.</Text>}
      {data.entries.length > 0 && shown.length === 0 && <Text size="sm" c="dimmed">Rien pour ce filtre.</Text>}
      {shown.map((e) => {
        if (e.kind === 'plan' && e.groupId) {
          if (seen.has(e.groupId)) return null;
          seen.add(e.groupId);
          return <PlanBlock key={e.groupId} items={shown.filter((x) => x.groupId === e.groupId)} all={all} onSee={onSee} />;
        }
        return <HistoryEntryCard key={e.id} entry={e} all={all} onSee={onSee} />;
      })}
    </Stack>
  );
}

/**
 * Historique annulable. `drawer` : tiroir à droite (400 px, plein écran sur téléphone), sans voile, la page reste utilisable ;
 * `inline` : la liste seule, dans une carte. « Voir » n'apparaît que si `onSee` est fourni.
 */
export function HistoryPanel({ competitionId, waveId, mode, opened = false, onClose, onSee }: {
  competitionId: string; waveId: string | null; mode: 'drawer' | 'inline'; opened?: boolean; onClose?: () => void; onSee?: (categoryIds: string[]) => void;
}) {
  const phone = useMediaQuery('(max-width: 48em)');
  if (mode === 'inline') return <HistoryList competitionId={competitionId} waveId={waveId} onSee={onSee} />;
  return (
    <Drawer opened={opened} onClose={onClose ?? (() => {})} position="right" size={phone ? '100%' : HISTORY_DRAWER_WIDTH} title="Historique"
      withOverlay={false} lockScroll={false} trapFocus={false} closeOnClickOutside={false} returnFocus={false} shadow="md">
      <HistoryList competitionId={competitionId} waveId={waveId} onSee={onSee} />
    </Drawer>
  );
}
