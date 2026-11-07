import { Box, Button, Group, Text } from '@mantine/core';
import { entryHeadline } from '../../../domain/history/text.js';
import { HISTORY_KIND_LABELS, type HistoryEntryView } from '../../../domain/history/types.js';
import { StatusBadge } from '../ui/StatusBadge.js';
import { useUndoHighlight } from './highlight.js';
import { hhmm } from './lot.js';
import { useUndoDialog } from './undo-dialog-context.js';

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** « Annule aussi : 09:52 · BLANC Zoé ↔ GUERIN Emma (places), … » : les actions plus récentes emportées, de la plus ancienne à la plus récente. */
export function alsoText(entries: HistoryEntryView[]): string {
  return `Annule aussi : ${[...entries].sort((a, b) => a.seq - b.seq).map((x) => `${hhmm(x.createdAt)} · ${entryHeadline(x).what} (${lower(HISTORY_KIND_LABELS[x.kind])})`).join(', ')}`;
}

/** Survol et focus d'un bouton d'annulation : la cascade est mise en évidence dans le panneau (et sur la planche). */
export function useHoverTargets(targets: string[]) {
  const h = useUndoHighlight();
  return { onMouseEnter: () => h.show(targets), onMouseLeave: h.clear, onFocus: () => h.show(targets), onBlur: h.clear };
}

/** Une action de l'historique : heure, type, ce qui a changé, détail, raison, puis Voir et Annuler… (ou le motif du blocage). */
export function HistoryEntryCard({ entry, all, nested = false, onSee }: { entry: HistoryEntryView; all: HistoryEntryView[]; nested?: boolean; onSee?: (categoryIds: string[]) => void }) {
  const h = useUndoHighlight();
  const { requestUndoDialog } = useUndoDialog();
  const hover = useHoverTargets([entry.id]);
  const undone = entry.status === 'undone';
  const { what, detail } = entryHeadline(entry);
  const mark = h.main.has(entry.id) ? 'main' : h.also.has(entry.id) ? 'also' : undefined;
  const cascade = all.filter((x) => entry.cascade.includes(x.id));
  return (
    <Box p="xs" data-testid="history-entry" data-entry={entry.id} data-highlight={mark}
      style={{
        position: 'relative',
        borderRadius: 8,
        border: `1px solid ${mark === 'main' ? 'var(--mantine-color-red-6)' : mark === 'also' ? 'var(--mantine-color-orange-6)' : 'var(--sk-line)'}`,
        ...(mark === 'main' ? { borderLeft: '4px solid var(--mantine-color-red-6)' } : {}),
        backgroundColor: mark === 'also' ? 'var(--sk-warn)' : 'var(--sk-row)',
      }}>
      <Group gap={6} wrap="wrap" mb={2}>
        {!nested && <Text size="xs" c="dimmed" className="num">{hhmm(entry.createdAt)}</Text>}
        {!nested && <StatusBadge tone={entry.kind === 'plan' || entry.kind === 'reaffectation' ? 'accent' : 'neutral'} size="sm">{HISTORY_KIND_LABELS[entry.kind]}</StatusBadge>}
        {undone && entry.undoneAt && <StatusBadge tone="neutral" size="sm">Annulée à {hhmm(entry.undoneAt)}</StatusBadge>}
      </Group>
      {/* Posée sur le bord de la carte : la faire apparaître au survol ne décale rien (le bouton survolé ne bouge pas sous le doigt). */}
      {mark && (
        <Box style={{ position: 'absolute', top: -9, right: 8 }}>
          {mark === 'main' ? <StatusBadge tone="danger" size="sm">Sera annulée</StatusBadge> : <StatusBadge tone="warn" size="sm">Sera annulée aussi</StatusBadge>}
        </Box>
      )}
      <Box style={undone ? { opacity: 0.6, textDecoration: 'line-through' } : undefined}>
        <Text size="sm" fw={600} style={{ overflowWrap: 'anywhere' }}>{what}</Text>
        {detail && <Text size="sm" c="dimmed" style={{ overflowWrap: 'anywhere' }}>{detail}</Text>}
        {entry.summary.reason && entry.kind !== 'withdraw' && <Text size="xs" c="dimmed" style={{ overflowWrap: 'anywhere' }}>{entry.summary.reason}</Text>}
      </Box>
      {!undone && (
        <Group gap="xs" mt={6} wrap="wrap" align="center">
          {entry.blocked
            ? <Text size="xs" c="red" data-testid="history-blocked" style={{ overflowWrap: 'anywhere', flex: '1 1 100%' }}>{entry.blocked}</Text>
            : cascade.length > 0 && <Text size="xs" style={{ color: 'var(--sk-warn-text)', overflowWrap: 'anywhere', flex: '1 1 100%' }} data-testid="history-also">{alsoText(cascade)}</Text>}
          {onSee && <Button size="compact-sm" variant="subtle" data-testid="history-see" onClick={() => onSee(entry.categoryIds)}>Voir</Button>}
          <Button size="compact-sm" variant="light" color="red" data-testid="history-undo" disabled={entry.blocked !== null} {...hover}
            onClick={() => requestUndoDialog([entry.id])}>
            Annuler…
          </Button>
        </Group>
      )}
    </Box>
  );
}

