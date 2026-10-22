import { Alert, Badge, Button, Checkbox, Group, List, Modal, Stack, Table, Text } from '@mantine/core';
import { useState } from 'react';
import { Link } from 'react-router';
import { useLaunch, useLaunchStatus, useNumberPending, useNumberPreview, useReopen, useZones, type WaveState } from '../api.js';
import { ApiErrorAlert } from './ApiErrorAlert.js';

const STATES: Record<WaveState, { label: string; color: string }> = {
  preparation: { label: 'En préparation', color: 'gray' },
  launched: { label: 'Lancée', color: 'green' },
  reopened: { label: 'Rouverte', color: 'orange' },
  finished: { label: 'Terminée', color: 'blue' },
};

/**
 * Lancement d'une vague (null : vague implicite d'une compétition sans vague) : « Figer et imprimer la vague »,
 * « Rouvrir la vague », catégories à numéroter et « Numéroter à la suite » / « Refiger la vague ».
 */
export function WaveLaunchPanel({ competitionId, waveId }: { competitionId: string; waveId: string | null }) {
  const [dialog, setDialog] = useState<'launch' | 'reopen' | 'number' | null>(null);
  const [restart, setRestart] = useState(false);
  const { data: status } = useLaunchStatus(competitionId, waveId);
  const { data: preview } = useLaunchStatus(competitionId, waveId, restart, dialog === 'launch');
  const { data: zones = [] } = useZones(competitionId);
  const launch = useLaunch(competitionId);
  const reopen = useReopen(competitionId);
  const number = useNumberPending(competitionId);
  const numberPreview = useNumberPreview(competitionId);
  const printUrl = `/competitions/${competitionId}/impression?vague=${encodeURIComponent(waveId ?? '')}`;
  if (!status) return null;
  const zoneName = (zid: string) => zones.find((z) => z.id === zid)?.name ?? '?';
  const openNumber = () => {
    numberPreview.mutate({ waveId });
    setDialog('number');
  };
  const close = () => {
    setDialog(null);
    launch.reset();
  };

  return (
    <Stack gap="xs" data-testid="wave-launch">
      <Group gap="xs">
        <Badge color={STATES[status.state].color} data-testid="wave-state">{STATES[status.state].label}</Badge>
        {status.state === 'preparation' && <Button size="xs" data-testid="launch-open" onClick={() => { setRestart(false); setDialog('launch'); }}>Figer et imprimer la vague…</Button>}
        {(status.state === 'launched' || status.state === 'finished') && (
          <>
            <Button size="xs" variant="light" component={Link} to={printUrl} target="_blank" data-testid="wave-print">Imprimer la vague</Button>
            <Button size="xs" variant="subtle" color="orange" data-testid="reopen-open" onClick={() => setDialog('reopen')}>Rouvrir la vague</Button>
          </>
        )}
        {status.state === 'reopened' && <Button size="xs" data-testid="refreeze-open" onClick={openNumber}>Refiger la vague…</Button>}
      </Group>
      {status.pending.length > 0 && status.state !== 'reopened' && (
        <Alert color="orange" data-testid="pending-alert" title={`${status.pending.length} catégorie(s) à numéroter`}>
          <Text size="sm" mb={6}>{status.pending.map((p) => p.label).join(', ')} : sans numéro de passage (catégorie nouvelle ou régénérée).</Text>
          <Button size="xs" data-testid="number-open" onClick={openNumber}>Numéroter à la suite…</Button>
        </Alert>
      )}

      <Modal opened={dialog === 'launch'} onClose={close} title="Figer et imprimer la vague" size="lg">
        <Stack>
          {launch.isSuccess ? (
            <>
              <Alert color="green">Vague figée : ses numéros de passage ne changeront plus.</Alert>
              <Button component={Link} to={printUrl} target="_blank" data-testid="launch-print">Imprimer la vague</Button>
            </>
          ) : (
            <>
              <Text size="sm">Les zones et les numéros de passage de la vague sont enregistrés : ils ne changent plus (sauf réouverture). Imprimez ensuite les tableaux.</Text>
              {preview && preview.blocking.length > 0 && (
                <Alert color="red" title="Impossible de figer" data-testid="launch-blocking">
                  <List size="sm">{preview.blocking.map((b) => <List.Item key={b}>{b}</List.Item>)}</List>
                </Alert>
              )}
              <Checkbox label="Reprendre les numéros à 1 (nouveau jour)" checked={restart} onChange={(e) => setRestart(e.currentTarget.checked)} data-testid="launch-restart" />
              {preview && (
                <Table data-testid="launch-zones">
                  <Table.Tbody>
                    {preview.zones.filter((z) => z.first !== null).map((z) => (
                      <Table.Tr key={z.zoneId}><Table.Td>{zoneName(z.zoneId)}</Table.Td><Table.Td>n° {z.first} à {z.last}</Table.Td></Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              )}
              <ApiErrorAlert error={launch.error} />
              <Group justify="flex-end">
                <Button variant="default" onClick={close}>Annuler</Button>
                <Button data-testid="launch-confirm" loading={launch.isPending} disabled={!preview || preview.blocking.length > 0}
                  onClick={() => launch.mutate({ waveId, restart })}>Figer</Button>
              </Group>
            </>
          )}
        </Stack>
      </Modal>

      <Modal opened={dialog === 'reopen'} onClose={close} title="Rouvrir la vague ?">
        <Stack>
          <Text size="sm">Les catégories sans résultat redeviennent modifiables : des tableaux déjà affichés pourront changer. Les catégories commencées restent verrouillées.</Text>
          <ApiErrorAlert error={reopen.error} />
          <Group justify="flex-end">
            <Button variant="default" onClick={close}>Annuler</Button>
            <Button color="orange" data-testid="reopen-confirm" loading={reopen.isPending} onClick={() => reopen.mutate({ waveId }, { onSuccess: close })}>Rouvrir la vague</Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={dialog === 'number'} onClose={close} title={status.state === 'reopened' ? 'Refiger la vague' : 'Numéroter à la suite'} size="lg">
        <Stack>
          <Text size="sm">Seules les catégories modifiées reçoivent de nouveaux numéros, à la suite du dernier numéro de leur zone ; leurs tableaux sont à réimprimer (« mis à jour à … »).</Text>
          <div data-testid="number-preview">
            {numberPreview.data && numberPreview.data.changes.length === 0 && <Text size="sm">Aucun numéro ne change.</Text>}
            {numberPreview.data?.changes.map((c) => <Text size="sm" key={c.categoryId}>{c.label} : n° {c.numbers.join(', ')}</Text>)}
          </div>
          <ApiErrorAlert error={numberPreview.error ?? number.error} />
          <Group justify="flex-end">
            <Button variant="default" onClick={close}>Annuler</Button>
            <Button data-testid="number-confirm" loading={number.isPending} disabled={!numberPreview.data} onClick={() => number.mutate({ waveId }, { onSuccess: close })}>
              {status.state === 'reopened' ? 'Refiger la vague' : 'Numéroter à la suite'}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
