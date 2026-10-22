import { Alert, Button, Group, Modal, SegmentedControl, Stack, Table, Text } from '@mantine/core';
import { useState } from 'react';
import type { Zone } from '../../domain/zones.js';
import { useMoveCategory, useMovePreview, type RenumberMode } from '../api.js';
import { ApiErrorAlert } from './ApiErrorAlert.js';

/**
 * « Déplacer vers… » une catégorie d'une vague lancée : ses combats restants vont sur la zone choisie, « à la suite »
 * (seuls les tableaux déplacés sont à réimprimer) ou « mélangés » (toute la zone d'arrivée est renumérotée), avec aperçu.
 */
export function MoveDialog({ competitionId, category, zoneId, zones, onClose }: { competitionId: string; category: { id: string; label: string }; zoneId: string; zones: Zone[]; onClose: () => void }) {
  const [mode, setMode] = useState<RenumberMode>('append');
  const move = useMoveCategory(competitionId);
  const preview = useMovePreview(competitionId, category.id, zoneId, mode, move.isIdle);
  const zoneName = (zid: string) => zones.find((z) => z.id === zid)?.name ?? '?';
  const target = zoneName(zoneId);
  return (
    <Modal opened onClose={onClose} title={`Déplacer « ${category.label} » vers ${target}`} size="xl">
      <Stack data-testid="move-modal">
        <SegmentedControl data-testid="move-mode" value={mode} onChange={(v) => setMode(v as RenumberMode)}
          data={[{ value: 'append', label: 'À la suite' }, { value: 'shuffle', label: 'Mélangés' }]} />
        <Text size="sm">
          {mode === 'append'
            ? `À la suite : ses combats restants prennent les numéros après le dernier de ${target} ; seuls les tableaux déplacés sont à réimprimer. Les combats déjà joués gardent leur numéro.`
            : `Mélangés : tous les combats non joués de ${target} sont renumérotés avec la règle de repos ; réimprimez tous ses tableaux.`}
        </Text>
        {mode === 'shuffle' && (
          <Alert color="orange">Un combat en cours sur le tapis n’a pas encore de résultat : il serait renuméroté — préférez « À la suite ».</Alert>
        )}
        <ApiErrorAlert error={move.isIdle ? preview.error : move.error} />
        {preview.data && (
          <>
            <Table>
              <Table.Tbody>
                {preview.data.changes.map((c) => (
                  <Table.Tr key={`${c.categoryId}-${c.matchId}`} data-testid="move-change">
                    <Table.Td>{c.label}</Table.Td>
                    <Table.Td>{c.from ? `n° ${c.from.number} (${zoneName(c.from.zoneId)})` : 'sans numéro'}</Table.Td>
                    <Table.Td>→ n° {c.to.number} ({zoneName(c.to.zoneId)})</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
            <div>
              <Text size="sm" fw={600}>Tableaux à réimprimer :</Text>
              {preview.data.reprint.map((r) => <Text size="sm" key={r.categoryId} data-testid="move-reprint">{r.label}</Text>)}
            </div>
          </>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>Annuler</Button>
          <Button data-testid="move-confirm" loading={move.isPending} disabled={!preview.data || preview.isFetching}
            onClick={() => move.mutate({ cid: category.id, zoneId, mode }, { onSuccess: onClose })}>
            Déplacer
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
