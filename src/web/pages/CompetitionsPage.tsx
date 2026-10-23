import { Anchor, Button, Group, Modal, NumberInput, Select, Stack, Table, Text, TextInput } from '@mantine/core';
import { useState } from 'react';
import { Link } from 'react-router';
import { useCompetitions, useCreateCompetition, useGridTemplates } from '../api.js';
import { ApiErrorAlert } from '../components/ApiErrorAlert.js';
import { SectionHeader } from '../components/Help.js';
import { ImportCompetitionButton, ServerCompetitionsButton } from '../components/SyncPanel.js';

export function CompetitionsPage() {
  const { data = [] } = useCompetitions();
  const create = useCreateCompetition();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', date: '2026-11-22', location: '', zoneCount: 2 });
  const { data: templates = [] } = useGridTemplates();
  const [templateId, setTemplateId] = useState<string | null>(null);

  const submit = () =>
    create.mutate(
      { name: form.name, date: form.date, location: form.location || null, zoneCount: form.zoneCount, ...(templateId ? { templateId } : {}) },
      { onSuccess: () => { setOpen(false); setForm({ ...form, name: '', location: '' }); } },
    );

  return (
    <Stack>
      <Group justify="space-between">
        <SectionHeader topic="competitions" order={2} />
        <Group>
          <ServerCompetitionsButton />
          <ImportCompetitionButton />
          <Button data-testid="new-competition" onClick={() => setOpen(true)}>
            Nouvelle compétition
          </Button>
        </Group>
      </Group>
      {data.length === 0 ? (
        <Text c="dimmed">Aucune compétition pour l'instant.</Text>
      ) : (
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Nom</Table.Th>
              <Table.Th>Date</Table.Th>
              <Table.Th>Lieu</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {data.map((c) => (
              <Table.Tr key={c.id} data-testid="competition-row">
                <Table.Td>
                  <Anchor component={Link} to={`/competitions/${c.id}/reglages`}>{c.name}</Anchor>
                </Table.Td>
                <Table.Td>{new Date(`${c.date}T12:00:00`).toLocaleDateString('fr-FR')}</Table.Td>
                <Table.Td>{c.location ?? '—'}</Table.Td>
                <Table.Td>
                  <Group gap="xs" justify="flex-end">
                    <Anchor component={Link} to={`/competitions/${c.id}/reglages`}>Réglages</Anchor>
                    <Anchor component={Link} to={`/competitions/${c.id}/grille`}>Grille</Anchor>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
      <Modal opened={open} onClose={() => setOpen(false)} title="Nouvelle compétition">
        <Stack>
          <TextInput data-testid="competition-name" label="Nom" required value={form.name}
            onChange={(e) => setForm({ ...form, name: e.currentTarget.value })} />
          <TextInput data-testid="competition-date" label="Date" type="date" required value={form.date}
            onChange={(e) => setForm({ ...form, date: e.currentTarget.value })} />
          <TextInput label="Lieu" value={form.location}
            onChange={(e) => setForm({ ...form, location: e.currentTarget.value })} />
          <NumberInput label="Nombre de zones de combat" description="Créées sous les noms « Tatami 1 », « Tatami 2 »… ; renommables dans les Réglages." min={1} max={20} value={form.zoneCount}
            onChange={(v) => setForm({ ...form, zoneCount: Number(v) || 1 })} />
          {templates.length > 0 && (
            <Select label="Grille âge / poids" placeholder="Grille FFK par défaut" clearable data={templates.map((t) => ({ value: t.id, label: t.name }))}
              value={templateId} onChange={setTemplateId} />
          )}
          <ApiErrorAlert error={create.error} />
          <Button data-testid="competition-submit" onClick={submit} loading={create.isPending}>
            Créer
          </Button>
        </Stack>
      </Modal>
    </Stack>
  );
}
