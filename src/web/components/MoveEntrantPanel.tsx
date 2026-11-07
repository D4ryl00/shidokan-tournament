import { Alert, Button, Card, Group, Modal, Select, Stack, Switch, Text } from '@mantine/core';
import { useState } from 'react';
import { plural } from '../../domain/plural.js';
import { useCategories, useManualMove, useMoveTargets, usePreviewReplacement, useWaves } from '../api.js';
import { useUndoToast } from './history/undoToast.js';
import { ApiErrorAlert } from './ApiErrorAlert.js';
import { useRequestMoveUndo } from './history/useRequestMoveUndo.js';
import { ProposalPreview } from './ProposalPreview.js';
import { WaveChangeWarning } from './replacement/WaveChangeWarning.js';

/**
 * Sous le tableau, pour l'inscrit choisi : le déplacer à la main vers une autre catégorie ou un tableau libre (avec aperçu avant
 * confirmation), ou annuler son déplacement manuel.
 */
export function MoveEntrantPanel({ competitionId, registrationId, name, manual, onDone }: { competitionId: string; registrationId: string; name: string; manual: boolean; onDone?: () => void }) {
  const { data: categories = [] } = useCategories(competitionId);
  const { data } = useMoveTargets(competitionId, registrationId);
  const { data: waves = [] } = useWaves(competitionId);
  const [target, setTarget] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState(false);
  const preview = usePreviewReplacement(competitionId);
  const move = useManualMove(competitionId);
  const undoToast = useUndoToast(competitionId);
  const requestUndo = useRequestMoveUndo(competitionId);

  const size = (categoryId: string) => {
    const c = categories.find((x) => x.id === categoryId);
    return c ? c.registrationIds.length - c.absentIds.length : 0;
  };
  // Comme sur les cartes de la Réaffectation : une cible d'une autre session (ou en attente) le dit.
  const current = categories.find((x) => x.registrationIds.includes(registrationId));
  const waveName = (w: string | null) => (w === null ? 'en attente' : (waves.find((x) => x.id === w)?.name ?? '?'));
  const session = (categoryId: string) => {
    const x = categories.find((k) => k.id === categoryId);
    return waves.length > 0 && current && x && x.waveId !== current.waveId ? ` · session ${waveName(x.waveId)}` : '';
  };
  const option = (t: { categoryId: string; label: string; warnings: string[] }) => ({
    value: t.categoryId,
    label: `${t.label} (${size(t.categoryId)})${session(t.categoryId)}${t.warnings.length ? ` ⚠ ${plural(t.warnings.length, 'règle enfreinte', 'règles enfreintes')}` : ''}`,
  });
  const targets = (data?.targets ?? []).filter((t) => all || t.warnings.length === 0);
  const groups = [
    { group: 'Catégories', items: targets.filter((t) => !t.free).map(option) },
    { group: 'Tableaux libres', items: targets.filter((t) => t.free).map(option) },
  ].filter((g) => g.items.length > 0);
  const chosen = targets.find((t) => t.categoryId === target) ? target : null;

  const close = () => { setOpen(false); preview.reset(); };
  return (
    <Card withBorder padding="sm" data-testid="move-entrant-panel">
      <Stack gap="xs">
        <Text size="sm" fw={600}>{name}</Text>
        <Group align="flex-end" gap="sm">
          <Select data-testid="move-entrant-select" size="sm" w={380} label="Déplacer vers…" placeholder="Choisir une catégorie ou un tableau libre" searchable clearable
            nothingFoundMessage={all ? 'Aucune catégorie' : 'Aucune catégorie compatible : cochez « Toutes les catégories »'}
            data={groups} value={chosen} onChange={setTarget} />
          <Switch size="sm" label="Toutes les catégories (règles enfreintes)" data-testid="move-entrant-all" checked={all} onChange={(e) => setAll(e.currentTarget.checked)} />
          <Button variant="default" disabled={!chosen} data-testid="move-entrant-start"
            onClick={() => { setOpen(true); preview.mutate({ move: { registrationId, categoryId: chosen! } }); }}>
            Déplacer…
          </Button>
          {manual && (
            <Button variant="subtle" color="orange" data-testid="move-entrant-undo" onClick={() => requestUndo(registrationId, onDone)}>
              Annuler son déplacement manuel
            </Button>
          )}
        </Group>
      </Stack>
      <Modal opened={open} onClose={close} size="xl" title="Déplacement manuel">
        <Stack>
          {preview.isPending && <Text size="sm">Calcul de l’aperçu…</Text>}
          <ApiErrorAlert error={preview.error ?? move.error} />
          {preview.data?.warnings && preview.data.warnings.length > 0 && (
            <Alert color="orange" title="Règles enfreintes" data-testid="move-warnings">{preview.data.warnings.join(' ')}</Alert>
          )}
          {preview.data?.sameClub?.map((s) => <Text key={s} size="sm" c="orange" data-testid="move-same-club">{s}</Text>)}
          <WaveChangeWarning proposal={preview.data?.steps[0]?.proposal} waves={waves} name={() => name} />
          {preview.data && <ProposalPreview data={preview.data} />}
          <Group justify="flex-end">
            <Button variant="default" onClick={close}>Annuler</Button>
            <Button data-testid="move-entrant-confirm" loading={move.isPending} disabled={!preview.data}
              onClick={() => {
                const label = targets.find((t) => t.categoryId === chosen)?.label ?? '';
                const sameClub = preview.data?.sameClub ?? [];
                void move.mutateAsync({ registrationId, categoryId: chosen! }).then((r) => { close(); setTarget(null); onDone?.(); undoToast(`${name} déplacé(e) vers ${label}`, r.historyId ?? null, sameClub); }, () => {});
              }}>
              Confirmer le déplacement
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Card>
  );
}
