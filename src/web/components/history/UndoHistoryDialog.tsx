import { Alert, Button, Group, Loader, Modal, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useEffect, useMemo } from 'react';
import { entryHeadline, undoEffect } from '../../../domain/history/text.js';
import type { HistoryEntryView } from '../../../domain/history/types.js';
import { useCategories, useHistory, useUndoHistory } from '../../api.js';
import { ApiErrorAlert } from '../ApiErrorAlert.js';
import { useUndoHighlight } from './highlight.js';
import { hhmm, lotOf } from './lot.js';

const SESSION_KINDS = new Set(['plan', 'reaffectation', 'manual', 'exchange']);

/** Une action du lot : heure, ce qui a changé, étiquette « demandée » ou « annulée aussi », et ce qui revient. */
export function UndoLotLine({ entry, requested }: { entry: HistoryEntryView; requested: boolean }) {
  return (
    <Stack gap={2} p="xs" data-testid="undo-line" data-role={requested ? 'main' : 'also'}
      style={{ borderRadius: 8, border: `1px solid ${requested ? 'var(--mantine-color-red-6)' : 'var(--mantine-color-orange-6)'}`, ...(requested ? {} : { backgroundColor: 'var(--sk-warn)' }) }}>
      <Group gap="xs" wrap="wrap">
        <Text size="sm" fw={600} style={{ overflowWrap: 'anywhere' }} className="num">{hhmm(entry.createdAt)} · {entryHeadline(entry).what}</Text>
        {requested
          ? <Text size="xs" fw={700} c="red">demandée</Text>
          : <Text size="xs" fw={700} style={{ color: 'var(--sk-warn-text)' }}>annulée aussi</Text>}
      </Group>
      <Text size="sm" c="dimmed">{undoEffect(entry)}</Text>
    </Stack>
  );
}

/** Phrase de cascade : les actions « annulées aussi » sont plus récentes et touchent les mêmes tableaux. */
export const cascadeSentence = (n: number) =>
  n === 1
    ? 'L’action marquée « annulée aussi » est plus récente et touche les mêmes tableaux : elle part en premier. Elle est aussi surlignée dans l’historique.'
    : `Les ${n} actions marquées « annulées aussi » sont plus récentes et touchent les mêmes tableaux : elles partent en premier. Elles sont aussi surlignées dans l’historique.`;

/**
 * Confirmation d'annulation : les actions dans l'ordre où elles seront annulées, chacune avec ce qui revient. `targets` : les
 * actions demandées ; `staying` : celles du lot que leur blocage laisse en place. Envoie le lot affiché (`expect`).
 */
export function UndoHistoryDialog({ competitionId, targets, title, staying = [], onClose, onUndone }: {
  competitionId: string; targets: string[]; title: string; staying?: string[]; onClose: () => void; onUndone?: () => void;
}) {
  const { data } = useHistory(competitionId, null);
  const { data: categories = [] } = useCategories(competitionId);
  const undo = useUndoHistory(competitionId);
  const highlight = useUndoHighlight();
  const key = targets.join(',');
  useEffect(() => {
    highlight.pin(targets);
    return highlight.unpin;
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const lot = useMemo(() => (data ? lotOf(data.entries, targets) : []), [data, targets]);
  const asked = new Set(targets);
  const extra = lot.filter((e) => !asked.has(e.id));
  const stay = (data?.entries ?? []).filter((e) => staying.includes(e.id) && e.status === 'active');
  const blocked = lot.find((e) => e.blocked)?.blocked ?? null;
  // Un combattant qui revient dans une catégorie d'une autre session.
  const waveOf = (label: string | undefined) => (label ? categories.find((c) => c.label === label)?.waveId : undefined);
  const changesSession = lot.some((e) => SESSION_KINDS.has(e.kind) && waveOf(e.summary.fromLabel) !== undefined && waveOf(e.summary.toLabel) !== undefined && waveOf(e.summary.fromLabel) !== waveOf(e.summary.toLabel));

  const confirm = () =>
    undo.mutate({ ids: targets, expect: lot.map((e) => e.id) }, {
      onSuccess: ({ undone }) => {
        notifications.show({ color: 'green', message: undone.length > 1 ? `${undone.length} actions annulées.` : 'Action annulée.' });
        onUndone?.();
        onClose();
      },
    });

  return (
    <Modal opened onClose={onClose} title={title} size="lg">
      <Stack data-testid="undo-dialog">
        {!data && <Loader size="sm" />}
        {data && lot.length === 0 && <Text size="sm">Cette action n’est plus en place.</Text>}
        {lot.map((e) => <UndoLotLine key={e.id} entry={e} requested={asked.has(e.id)} />)}
        {extra.length > 0 && <Alert color="orange" data-testid="undo-cascade">{cascadeSentence(extra.length)}</Alert>}
        {stay.length > 0 && (
          <Alert color="gray" data-testid="undo-staying">
            Reste{stay.length > 1 ? 'nt' : ''} en place : {stay.map((e) => entryHeadline(e).what).join(', ')} ({stay[0]!.blocked})
          </Alert>
        )}
        {blocked && <Alert color="red" data-testid="undo-blocked">{blocked}</Alert>}
        {changesSession && <Alert color="blue">Un combattant change de session en revenant.</Alert>}
        <Alert color="gray">Les tableaux concernés sont remis comme avant ; s’ils étaient imprimés, réimprimez-les.</Alert>
        <ApiErrorAlert error={undo.error} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose} data-testid="undo-keep">Garder</Button>
          <Button color="red" data-testid="undo-confirm" loading={undo.isPending} disabled={lot.length === 0 || blocked !== null} onClick={confirm}>
            {lot.length > 1 ? `Annuler ces ${lot.length} actions` : 'Annuler cette action'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
