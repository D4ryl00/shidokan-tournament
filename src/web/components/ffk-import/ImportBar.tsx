import { Badge, Button, Group, List, Modal, Stack, Text, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useState } from 'react';
import type { FfkChoices } from '../../../domain/ffk-plan/plan.js';
import type { CategoryGrid } from '../../../domain/types.js';
import { ApiError, useClubs, useCommitFfk, type FfkPreview } from '../../api.js';
import { ApiErrorAlert } from '../ApiErrorAlert.js';
import type { PageCardState } from './cardState.js';
import { recap, resultMessage, type RecapItem } from './recap.js';
import type { FfkSource } from './useFfkPreview.js';

/** Une ligne du récapitulatif : son texte, la partie en gras, la marque « validée ». */
const Item = ({ item }: { item: RecapItem }) => (
  <>
    {item.text}
    {item.strong && <b>{item.strong}</b>}
    {item.validated && <Badge size="xs" color="green" variant="light" ml={6}>validée</Badge>}
  </>
);

/**
 * Barre collée en bas de la page : ce qui reste à trancher (laissé de côté si on importe maintenant) et « Importer… », jamais bloqué
 * par un point non tranché. Grisé seulement tant que l’aperçu ne suit pas les derniers choix (calcul en route ou en erreur) :
 * l’import n’envoie jamais un plan périmé.
 */
export function ImportBar({ competitionId, source, choices, plan, states, grid, stale, failed, onImported, onConflict }: {
  competitionId: string;
  source: FfkSource;
  choices: FfkChoices;
  plan: FfkPreview;
  states: Record<string, PageCardState>;
  grid: CategoryGrid | undefined;
  /** L’aperçu ne correspond pas encore aux derniers choix. */
  stale: boolean;
  /** Le dernier aperçu a échoué. */
  failed: boolean;
  onImported: () => void;
  /** Import refusé (inscriptions changées depuis l’aperçu) : un nouvel aperçu est demandé. */
  onConflict: () => void;
}) {
  const commit = useCommitFfk(competitionId);
  const { data: clubs = [] } = useClubs(competitionId);
  const [confirming, setConfirming] = useState(false);
  const todo = plan.summary.clubsTodo + plan.summary.todo;

  const open = () => {
    commit.reset();
    setConfirming(true);
  };
  const doImport = () =>
    commit.mutate(
      { uploadId: source.uploadId, sheets: source.sheets, choices, fingerprint: plan.fingerprint },
      {
        onSuccess: (r) => {
          setConfirming(false);
          notifications.show({ color: 'green', message: resultMessage(r) });
          onImported();
        },
        onError: (e) => {
          // Inscriptions changées ailleurs entre-temps : rien n’est écrit ; le message reste, l’aperçu est recalculé.
          if (e instanceof ApiError && e.status === 409) {
            setConfirming(false);
            notifications.show({ color: 'orange', message: e.message, autoClose: false });
            onConflict();
          }
        },
      },
    );

  const message = failed ? <Text size="sm" c="red">L’aperçu n’a pas pu être calculé : corrigez le problème ci-dessus avant d’importer.</Text>
    : todo ? (
      <Text size="sm" c="var(--sk-warn-text)" data-testid="ffk-bar-message">
        {todo > 1 ? `Vous pouvez importer maintenant : les ${todo.toLocaleString('fr-FR')} points non tranchés sont laissés de côté.`
          : 'Vous pouvez importer maintenant : le point non tranché est laissé de côté.'}
      </Text>
    ) : <Text size="sm" c="dimmed" data-testid="ffk-bar-message">Tout est tranché.</Text>;

  return (
    <>
      <Group justify="space-between" wrap="wrap" gap="sm" className="no-print" data-testid="ffk-import-bar"
        style={{ position: 'sticky', bottom: 0, zIndex: 50, padding: 'var(--mantine-spacing-sm) var(--mantine-spacing-md)', background: 'var(--sk-bar)', border: '1px solid var(--sk-card-line)', borderRadius: 'var(--mantine-radius-lg)' }}>
        <div style={{ minWidth: 0, flex: '1 1 240px' }}>{message}</div>
        {/* Grisé le temps que l’aperçu suive le dernier choix (le résumé en haut montre le calcul en cours). */}
        <Button data-testid="ffk-commit" disabled={stale || failed} onClick={open}>Importer…</Button>
      </Group>

      <Modal opened={confirming} onClose={() => setConfirming(false)} title="Confirmer l’import FFK" size="lg">
        <Stack gap="md" data-testid="ffk-recap">
          {confirming && recap(plan, states, grid, clubs).map((b) => (
            <Stack key={b.title} gap={4}>
              <Title order={4} fz="sm" c={b.aside ? 'var(--sk-warn-text)' : undefined}>{b.title}</Title>
              {b.items && <List size="sm" spacing={2}>{b.items.map((item, i) => <List.Item key={i}><Item item={item} /></List.Item>)}</List>}
              {b.note && <Text size="xs" c="dimmed">{b.note}</Text>}
            </Stack>
          ))}
          <ApiErrorAlert error={commit.error} />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setConfirming(false)}>Annuler</Button>
            <Button data-testid="ffk-commit-confirm" onClick={doImport} loading={commit.isPending}>Importer</Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
