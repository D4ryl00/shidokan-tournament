import { ActionIcon, Button, Group, Modal, Stack, Text } from '@mantine/core';
import { useEffect, useState } from 'react';
import { usePutTieBreak } from '../api.js';
import type { EntrantInfo } from './BracketView.js';

/** Départage par l'organisateur : il ordonne les ex-æquo. */
export function TieBreakDialog({ competitionId, categoryId, scope, group, entrants, onClose }: { competitionId: string; categoryId: string; scope: string; group: string[] | null; entrants: Map<string, EntrantInfo>; onClose: () => void }) {
  const put = usePutTieBreak(competitionId);
  const [order, setOrder] = useState<string[]>([]);
  useEffect(() => setOrder(group ?? []), [group]);
  if (!group) return null;
  const move = (i: number, d: -1 | 1) => {
    const next = [...order];
    [next[i], next[i + d]] = [next[i + d]!, next[i]!];
    setOrder(next);
  };
  return (
    <Modal opened onClose={onClose} title="Départager les ex-æquo">
      <Stack>
        <Text size="sm">Classez les combattants à égalité (du meilleur au moins bon) :</Text>
        {order.map((id, i) => (
          <Group key={id} justify="space-between" data-testid="tiebreak-item">
            <Text>{i + 1}. {entrants.get(id)?.name} <Text span size="xs" c="dimmed">{entrants.get(id)?.club}</Text></Text>
            <Group gap={4}>
              <ActionIcon variant="subtle" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Monter">↑</ActionIcon>
              <ActionIcon variant="subtle" disabled={i === order.length - 1} onClick={() => move(i, 1)} aria-label="Descendre">↓</ActionIcon>
            </Group>
          </Group>
        ))}
        <Group justify="flex-end">
          <Button data-testid="tiebreak-save" loading={put.isPending} onClick={() => put.mutate({ cid: categoryId, scope, order }, { onSuccess: onClose })}>Valider le classement</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
