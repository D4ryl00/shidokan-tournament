import { Stack, Text } from '@mantine/core';
import { useEffect } from 'react';
import { useHistory } from '../../api.js';
import { useUndoHighlight } from './highlight.js';
import { UndoLotLine } from './UndoHistoryDialog.js';

/** « Repartir de zéro » : les actions Places / Tirage / Format plus récentes qui partent avec, mises en évidence (« annulée aussi »). */
export function ResetCascade({ competitionId, ids, active }: { competitionId: string; ids: string[]; active: boolean }) {
  const { data } = useHistory(competitionId, null);
  const highlight = useUndoHighlight();
  const key = ids.join(',');
  useEffect(() => {
    if (!active || ids.length === 0) return;
    highlight.pin(ids, true);
    return highlight.unpin;
  }, [active, key]); // eslint-disable-line react-hooks/exhaustive-deps
  const entries = (data?.entries ?? []).filter((e) => ids.includes(e.id));
  if (entries.length === 0) return null;
  return (
    <Stack gap={6} data-testid="replacement-reset-cascade">
      <Text size="sm" fw={600}>Partent aussi, car plus récentes et sur les mêmes tableaux :</Text>
      {entries.map((e) => <UndoLotLine key={e.id} entry={e} requested={false} />)}
    </Stack>
  );
}
