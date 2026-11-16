import { Badge, Button, Group, List, Modal, Stack, Text, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useState, type ReactNode } from 'react';
import type { FfkChoices, FfkImportResult } from '../../../domain/ffk-plan/plan.js';
import { plural } from '../../../domain/plural.js';
import type { CategoryGrid } from '../../../domain/types.js';
import { ApiError, useClubs, useCommitFfk, type FfkPreview } from '../../api.js';
import { ageBandLabel } from '../../labels.js';
import { ApiErrorAlert } from '../ApiErrorAlert.js';
import { lineDisciplines, type PageCardState } from './cardState.js';
import type { FfkSource } from './useFfkPreview.js';

/** Une rubrique du récapitulatif : titre, puis une liste ou une phrase. */
interface RecapBlock { title: string; items?: ReactNode[]; note?: string; aside?: boolean }

/** Récapitulatif de « Confirmer l’import FFK », tiré de l’aperçu (ce que l’import appliquera, et ce qu’il laisse de côté). */
function recap(plan: FfkPreview, states: Record<string, PageCardState>, grid: CategoryGrid | undefined, clubName: (id: string) => string): RecapBlock[] {
  const blocks: RecapBlock[] = [];
  const name = (l: { lastName: string; firstName: string }) => `${l.lastName} ${l.firstName}`;
  const fighterLabel = (id: string) => plan.fighters.find((f) => f.fighterId === id)?.label ?? '…';

  const created = plan.weightClasses.filter((w) => w.accepted);
  if (created.length) blocks.push({ title: 'Catégories de poids créées', items: created.map((w) => `${ageBandLabel(grid, w.ageBandCode)} ${w.sex} ${w.label}`) });
  const linked = plan.clubs.filter((c) => c.chosen && c.target);
  if (linked.length) blocks.push({ title: 'Clubs reliés ou créés', items: linked.map((c) => <>{c.clubName} → <b>{clubName(c.target!)}</b></>) });

  const imported = plan.cards.filter((c) => c.state === 'auto' || c.state === 'done');
  const updates = imported.filter((c) => c.fighterId !== 'new' && c.changes.length > 0);
  if (updates.length) {
    blocks.push({
      title: `Inscriptions mises à jour (${updates.length.toLocaleString('fr-FR')})`,
      items: updates.map((c) => (
        <>
          {fighterLabel(c.fighterId!)} — {lineDisciplines(c.value!.line)} : {c.changes.join(' ; ')}
          {c.state === 'done' && <Badge size="xs" color="green" variant="light" ml={6}>validée</Badge>}
        </>
      )),
    });
  }
  const confirmed = imported.filter((c) => c.fighterId !== 'new' && c.changes.length === 0).length;
  blocks.push({ title: `Confirmées sans changement (${confirmed.toLocaleString('fr-FR')})`, note: 'Marquées « confirmée FFK ».' });
  const creates = imported.filter((c) => c.fighterId === 'new');
  if (creates.length) {
    blocks.push({
      title: `Combattants créés (${creates.length.toLocaleString('fr-FR')})`,
      items: creates.map((c) => {
        const l = c.value!.line;
        const age = l.ageBandCode ? ageBandLabel(grid, l.ageBandCode) : '—';
        return `${name(l)} — ${lineDisciplines(l)}, ${age}${c.value!.clubId ? `, ${clubName(c.value!.clubId)}` : ''}`;
      }),
    });
  }
  const deleted = plan.orphans.filter((o) => o.action === 'delete');
  if (deleted.length) blocks.push({ title: `Inscriptions supprimées (${deleted.length.toLocaleString('fr-FR')})`, items: deleted.map((o) => `${o.label} — ${o.disciplines}`) });
  const kept = plan.orphans.length - deleted.length;
  if (kept) blocks.push({ title: `Fiches club sans inscription FFK gardées (${kept.toLocaleString('fr-FR')})`, note: 'Gardées telles quelles, sans la marque « confirmée FFK ».' });

  const clubsAside = plan.clubs.filter((c) => !c.target);
  const cardsAside = plan.cards.filter((c) => c.state === 'todo' || c.state === 'skip');
  if (clubsAside.length || cardsAside.length) {
    blocks.push({
      title: `Laissé de côté (${(clubsAside.length + cardsAside.length).toLocaleString('fr-FR')})`,
      aside: true,
      items: [
        ...clubsAside.map((c) => `Club ${c.clubName} : pas relié, ses nouveaux combattants ne sont pas créés`),
        ...cardsAside.map((c) => {
          const why = c.state === 'skip' ? 'écartée' : states[c.key] === 'pending' ? 'carte modifiée mais pas validée' : (c.reason ?? 'à trancher');
          return `${name(c.exportLine)} — ${lineDisciplines(c.exportLine)} : ${why}`;
        }),
      ],
      note: 'Rien ne change pour eux. Réimportez le même fichier plus tard pour les traiter.',
    });
  }
  return blocks;
}

const resultMessage = (r: FfkImportResult) =>
  `Import FFK : ${[
    plural(r.created, 'combattant créé', 'combattants créés'),
    plural(r.updated, 'mis à jour', 'mis à jour'),
    plural(r.deleted, 'supprimé', 'supprimés'),
    plural(r.weightClassesCreated, 'catégorie créée', 'catégories créées'),
    ...(r.leftAside ? [plural(r.leftAside, 'laissé de côté', 'laissés de côté')] : []),
  ].join(', ')}.`;

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
  const clubName = (id: string) => clubs.find((c) => c.id === id)?.name ?? '…';

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
          {confirming && recap(plan, states, grid, clubName).map((b) => (
            <Stack key={b.title} gap={4}>
              <Title order={4} fz="sm" c={b.aside ? 'var(--sk-warn-text)' : undefined}>{b.title}</Title>
              {b.items && <List size="sm" spacing={2}>{b.items.map((item, i) => <List.Item key={i}>{item}</List.Item>)}</List>}
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
