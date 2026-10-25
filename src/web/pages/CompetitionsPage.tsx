import { Anchor, Button, Group, Modal, NumberInput, Select, Stack, Table, Text, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useState } from 'react';
import { Link, Navigate } from 'react-router';
import { useAuthMe, useCompetitions, useCreateCompetition, useDeleteCompetition, useGridTemplates, isOrganiser } from '../api.js';
import { useDocumentTitle } from '../documentTitle.js';
import { ApiErrorAlert } from '../components/ApiErrorAlert.js';
import { plural } from '../../domain/plural.js';
import { DateField } from '../components/ui/DateField.js';
import { EmptyState } from '../components/ui/EmptyState.js';
import { PageHeader } from '../components/ui/PageHeader.js';
import { StatusBadge } from '../components/ui/StatusBadge.js';
import { ImportCompetitionButton, ServerCompetitionsButton } from '../components/SyncPanel.js';
import { TableCard } from '../components/ui/TableCard.js';

export function CompetitionsPage() {
  useDocumentTitle('Compétitions');
  const { data = [], isLoading } = useCompetitions();
  const { data: me } = useAuthMe();
  const organiser = isOrganiser(me);
  const create = useCreateCompetition();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', date: '2026-11-22', location: '', zoneCount: 2 });
  const { data: templates = [] } = useGridTemplates(organiser);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const remove = useDeleteCompetition();
  const [deleting, setDeleting] = useState<{ id: string; name: string; copyOf: string | null } | null>(null);
  const [typed, setTyped] = useState('');
  const closeDelete = () => {
    setDeleting(null);
    setTyped('');
    remove.reset();
  };

  const submit = () =>
    create.mutate(
      { name: form.name, date: form.date, location: form.location || null, zoneCount: form.zoneCount, ...(templateId ? { templateId } : {}) },
      { onSuccess: () => { setOpen(false); setForm({ ...form, name: '', location: '' }); } },
    );

  // Un compte Zone n'a qu'une compétition : il va directement à ses combats.
  if (me?.user?.role === 'zone' && me.user.competitionId) return <Navigate to={`/competitions/${me.user.competitionId}/combats`} replace />;

  const actions = organiser && (
    <>
      <ServerCompetitionsButton />
      <ImportCompetitionButton />
      <Button data-testid="new-competition" onClick={() => setOpen(true)}>Nouvelle compétition</Button>
    </>
  );

  return (
    <Stack gap="lg">
      <PageHeader title="Compétitions" help="competitions" summary={data.length > 0 ? plural(data.length, 'compétition') : undefined} actions={actions} />
      {isLoading ? null : data.length === 0 ? (
        <EmptyState title="Aucune compétition pour l’instant"
          text={organiser ? 'Créez la première avec « Nouvelle compétition » : nom, date, lieu et nombre de zones de combat. Ou importez une compétition reçue d’une autre installation.' : 'Aucune compétition n’est encore ouverte à votre compte.'} />
      ) : (
        <TableCard>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Nom</Table.Th>
                <Table.Th>Date</Table.Th>
                <Table.Th>Lieu</Table.Th>
                <Table.Th ta="right">Inscriptions</Table.Th>
                <Table.Th>Main</Table.Th>
                {organiser && <Table.Th />}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data.map((c) => (
                <Table.Tr key={c.id} data-testid="competition-row">
                  <Table.Td maw={420}>
                    <Anchor component={Link} to={`/competitions/${c.id}/reglages`} fw={600} className="sk-ellipsis" display="block" title={c.name}>{c.name}</Anchor>
                  </Table.Td>
                  <Table.Td className="num" style={{ whiteSpace: 'nowrap' }}>{new Date(`${c.date}T12:00:00`).toLocaleDateString('fr-FR')}</Table.Td>
                  <Table.Td c={c.location ? undefined : 'dimmed'}>{c.location ?? '—'}</Table.Td>
                  <Table.Td ta="right" className="num">{c.registrationCount.toLocaleString('fr-FR')}</Table.Td>
                  <Table.Td>
                    {c.management.managedHere
                      ? <StatusBadge tone="ok">Gérée ici</StatusBadge>
                      : <StatusBadge tone="warn" title={`Gérée par ${c.management.ownerName ?? 'une autre installation'} : lecture seule ici`} maw={220}>
                          Gérée par {c.management.ownerName ?? 'une autre installation'}
                        </StatusBadge>}
                  </Table.Td>
                  {organiser && (
                    <Table.Td>
                      <Group gap="xs" justify="flex-end" wrap="nowrap">
                        <Button component={Link} to={`/competitions/${c.id}/reglages`} size="compact-sm" variant="subtle">Réglages</Button>
                        <Button component={Link} to={`/competitions/${c.id}/grille`} size="compact-sm" variant="subtle">Grille</Button>
                        <Button size="compact-sm" variant="subtle" color="red" data-testid="competition-delete" disabled={!c.management.deletable}
                          title={c.management.deletable ? undefined : 'Un PC a la main sur cette compétition : rendez ou reprenez d’abord la main.'}
                          onClick={() => setDeleting({ id: c.id, name: c.name, copyOf: c.management.managedHere ? null : (c.management.ownerName ?? 'une autre installation') })}>
                          Supprimer
                        </Button>
                      </Group>
                    </Table.Td>
                  )}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </TableCard>
      )}
      <Modal opened={deleting !== null} onClose={closeDelete} title="Supprimer la compétition ?">
        {deleting && (
          <Stack>
            <Text size="sm">
              {deleting.copyOf
                ? <>« {deleting.name} » n’est ici qu’une copie : elle est supprimée de cette installation, et sa mise à jour s’arrête. La version de {deleting.copyOf} n’est pas touchée.</>
                : <>« {deleting.name} » et tout ce qu’elle contient (inscriptions, tableaux, résultats, liens d’inscription des clubs) seront supprimés de cette installation. La version d’une autre installation (serveur ou PC) n’est pas touchée.</>}
              {' '}Une sauvegarde est faite juste avant.
            </Text>
            <TextInput data-testid="competition-delete-name" label="Pour confirmer, tapez le nom de la compétition" placeholder={deleting.name}
              value={typed} onChange={(e) => setTyped(e.currentTarget.value)} />
            <ApiErrorAlert error={remove.error} />
            <Group justify="flex-end">
              <Button variant="default" onClick={closeDelete}>Annuler</Button>
              <Button color="red" data-testid="competition-delete-confirm" loading={remove.isPending} disabled={typed.trim() !== deleting.name.trim()}
                onClick={() => remove.mutate({ id: deleting.id, name: typed }, {
                  onSuccess: () => {
                    closeDelete();
                    notifications.show({ color: 'green', message: 'Compétition supprimée (une sauvegarde a été faite juste avant).' });
                  },
                })}>
                Supprimer définitivement
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
      <Modal opened={open} onClose={() => setOpen(false)} title="Nouvelle compétition">
        <Stack>
          <TextInput data-testid="competition-name" label="Nom" required value={form.name}
            onChange={(e) => setForm({ ...form, name: e.currentTarget.value })} />
          <DateField data-testid="competition-date" label="Date" required value={form.date}
            onChange={(v) => setForm({ ...form, date: v ?? '' })} />
          <TextInput label="Lieu" value={form.location}
            onChange={(e) => setForm({ ...form, location: e.currentTarget.value })} />
          <NumberInput label="Nombre de zones de combat" description="Créées sous les noms « Tatami 1 », « Tatami 2 »… ; renommables dans les Réglages." min={1} max={20} value={form.zoneCount}
            onChange={(v) => setForm({ ...form, zoneCount: Number(v) || 1 })} />
          {templates.length > 0 && (
            <Select label="Grille âge / poids" placeholder="Grille FFK par défaut" clearable data={templates.map((t) => ({ value: t.id, label: t.name }))}
              value={templateId} onChange={setTemplateId} />
          )}
          <ApiErrorAlert error={create.error} />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setOpen(false)}>Annuler</Button>
            <Button data-testid="competition-submit" onClick={submit} loading={create.isPending}>Créer</Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
