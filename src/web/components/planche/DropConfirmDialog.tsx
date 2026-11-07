import { Button, Group, Modal, Stack, Text } from '@mantine/core';
import { useEffect, useRef } from 'react';
import type { Category } from '../../../domain/categories.js';
import type { Wave } from '../../../domain/waves.js';
import { useExchange, useExchangePreview, useManualMove, usePreviewReplacement } from '../../api.js';
import { ApiErrorAlert } from '../ApiErrorAlert.js';
import type { EntrantInfo } from '../BracketView.js';
import { useUndoToast } from '../history/undoToast.js';
import { MoveConsequences } from '../MoveConsequences.js';
import type { WaveEffects } from '../replacement/WaveChangeWarning.js';

/** Dépôt à confirmer : échange avec un combattant d'une autre catégorie, ou déplacement vers une autre carte. */
export interface PendingDrop { kind: 'exchange' | 'move'; source: string; target?: string; from: string; to: string }

/**
 * Fenêtre « Échanger deux combattants » / « Déplacement manuel » de la planche : « De … ➜ Vers … » pour chacun, règles
 * enfreintes, même club au 1er tour, changements de session et (déplacement) l'aperçu des tableaux, comme « Déplacer vers… ».
 */
export function DropConfirmDialog({ competitionId, drop: asked, categories, entrants, waves, onClose }: {
  competitionId: string;
  drop: PendingDrop | null;
  categories: Category[];
  entrants: Map<string, EntrantInfo>;
  waves: Wave[];
  onClose: () => void;
}) {
  const movePreview = usePreviewReplacement(competitionId);
  const exchangePreview = useExchangePreview(competitionId);
  const move = useManualMove(competitionId);
  const exchange = useExchange(competitionId);
  const undoToast = useUndoToast(competitionId);
  const { mutate: previewMove, reset: resetMove } = movePreview;
  const { mutate: previewExchange, reset: resetExchange } = exchangePreview;
  const { reset: resetMoveAction } = move;
  const { reset: resetExchangeAction } = exchange;

  // Pendant la fermeture, la fenêtre garde son contenu.
  const last = useRef<PendingDrop | null>(null);
  if (asked) last.current = asked;
  const drop = asked ?? last.current;

  useEffect(() => {
    if (!asked) return;
    resetMove(); resetExchange(); resetMoveAction(); resetExchangeAction();
    if (asked.kind === 'move') previewMove({ move: { registrationId: asked.source, categoryId: asked.to } });
    if (asked.kind === 'exchange' && asked.target) previewExchange({ a: asked.source, b: asked.target });
  }, [asked, previewMove, previewExchange, resetMove, resetExchange, resetMoveAction, resetExchangeAction]);

  const name = (id: string) => entrants.get(id)?.name ?? '?';
  const label = (cid: string) => categories.find((c) => c.id === cid)?.label ?? '?';
  const isExchange = drop?.kind === 'exchange';
  const moves: [string, string, string][] = !drop ? [] : isExchange && drop.target ? [[drop.source, drop.from, drop.to], [drop.target, drop.to, drop.from]] : [[drop.source, drop.from, drop.to]];

  // Échange : chacun son changement de session ; ceux que leur catégorie emmène sont signalés avec le premier.
  const exchangeWaves = (): WaveEffects[] => {
    const all = exchangePreview.data?.waveMoves ?? [];
    const own = (rid: string) => all.find((x) => x.registrationId === rid);
    const change = (rid: string) => { const x = own(rid); return x ? { from: x.from, to: x.to } : null; };
    const others = all.filter((x) => !moves.some(([rid]) => rid === x.registrationId));
    return moves.map(([rid], i) => ({ registrationId: rid, waveChange: change(rid), waveShifts: i === 0 ? others : [] }));
  };

  const pending = isExchange ? exchangePreview.isPending : movePreview.isPending;
  const ready = isExchange ? !!exchangePreview.data : !!movePreview.data;
  const confirm = () => {
    if (!drop) return;
    if (drop.kind === 'exchange' && drop.target) {
      const [a, b] = [drop.source, drop.target];
      void exchange.mutateAsync({ a, b }).then((r) => { onClose(); undoToast(`Échangés : ${name(a)} ↔ ${name(b)}`, r.historyId, r.sameClub); }, () => {});
      return;
    }
    const sameClub = movePreview.data?.sameClub ?? [];
    void move.mutateAsync({ registrationId: drop.source, categoryId: drop.to })
      .then((r) => { onClose(); undoToast(`Déplacement de ${name(drop.source)} vers ${label(drop.to)}`, r.historyId ?? null, sameClub); }, () => {});
  };

  return (
    <Modal opened={asked !== null} onClose={onClose} size={isExchange ? 'lg' : 'xl'} title={isExchange ? 'Échanger deux combattants' : 'Déplacement manuel'}>
      <Stack data-testid="drop-dialog">
        {moves.map(([rid, from, to]) => (
          <Stack key={rid} gap={0} data-testid="drop-move">
            <Text size="sm" fw={600}>{name(rid)}</Text>
            <Text size="sm">De {label(from)} ➜ Vers {label(to)}</Text>
          </Stack>
        ))}
        <ApiErrorAlert error={isExchange ? exchangePreview.error ?? exchange.error : movePreview.error ?? move.error} />
        {isExchange ? (
          <MoveConsequences pending={pending} warnings={exchangePreview.data?.warnings} sameClub={exchangePreview.data?.sameClub}
            waveEffects={exchangePreview.data ? exchangeWaves() : []} waves={waves} name={name} />
        ) : (
          <MoveConsequences pending={pending} warnings={movePreview.data?.warnings} sameClub={movePreview.data?.sameClub}
            waveEffects={[movePreview.data?.steps[0]?.proposal]} waves={waves} name={name} preview={movePreview.data} />
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>Annuler</Button>
          <Button data-testid="drop-confirm" loading={move.isPending || exchange.isPending} disabled={!ready} onClick={confirm}>
            {isExchange ? 'Confirmer l’échange' : 'Confirmer le déplacement'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
