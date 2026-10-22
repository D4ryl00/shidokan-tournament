import { Alert, Anchor, Badge, Button, Group, List, Stack, Table, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useState } from 'react';
import { useParams } from 'react-router';
import { useGrid, useImportClubForm, usePreviewClubForm } from '../api.js';
import { ApiErrorAlert } from '../components/ApiErrorAlert.js';
import { SectionHeader } from '../components/Help.js';
import { ageBandLabel, disciplineLabel, prefsLabel, rulesetShort, weightLabel } from '../labels.js';

export function ClubFormPage() {
  const { id = '' } = useParams();
  const { data: grid } = useGrid(id);
  const preview = usePreviewClubForm(id);
  const importForm = useImportClubForm(id);
  const [file, setFile] = useState<File | null>(null);
  const parse = preview.data;
  const valid = parse?.rows.filter((r) => r.input).length ?? 0;

  const onFile = (f: File | null) => {
    setFile(f);
    importForm.reset();
    if (f) preview.mutate(f);
  };
  const doImport = () =>
    file &&
    importForm.mutate(file, {
      onSuccess: (r) => {
        notifications.show({
          color: 'green',
          message: `${r.club.name} : ${r.imported} inscription(s) importée(s), ${r.replaced} remplacée(s), ${r.skipped} ignorée(s).`,
        });
        preview.reset();
        setFile(null);
      },
    });

  return (
    <Stack maw={1200}>
      <SectionHeader topic="fiche-club.envoyer" />
      <Group>
        <Anchor href={`/api/competitions/${id}/club-form.ods`} download data-testid="club-form-download">
          <Button component="span" variant="light">Télécharger le modèle de fiche (.ods)</Button>
        </Anchor>
        <Button component="a" href={`/competitions/${id}/impression/fiche-club`} target="_blank" variant="light" data-testid="paper-form-open">
          Fiche papier (PDF)
        </Button>
      </Group>

      <SectionHeader topic="fiche-club.importer" />
      <input data-testid="club-form-file" type="file" accept=".ods,.xlsx,.xls,.csv"
        onChange={(e) => onFile(e.currentTarget.files?.[0] ?? null)} key={file ? 'f' : 'empty'} />
      <ApiErrorAlert error={preview.error ?? importForm.error} />

      {parse && (
        <Stack>
          <Alert title={`Club : ${parse.header.club}`} color="blue">
            Coach : {parse.header.coachName ?? '—'} · {parse.header.coachPhone ?? '—'} · {parse.header.coachEmail ?? '—'} · Pré-accord :{' '}
            {parse.header.preApproval ? 'oui' : 'non'}
          </Alert>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Ligne</Table.Th><Table.Th>Combattant</Table.Th><Table.Th>Âge</Table.Th><Table.Th>Discipline</Table.Th>
                <Table.Th>Règlement</Table.Th><Table.Th>Poids</Table.Th><Table.Th>Préférences</Table.Th><Table.Th>Remarques</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {parse.rows.map((r) => (
                <Table.Tr key={r.line} data-testid="club-form-preview-row"
                  style={r.input ? undefined : { backgroundColor: 'var(--mantine-color-red-light)' }}>
                  <Table.Td>{r.line}</Table.Td>
                  <Table.Td>{r.input ? `${r.input.lastName} ${r.input.firstName}` : <><Badge color="red" mr={4}>Erreur</Badge>{r.label}</>}</Table.Td>
                  <Table.Td>{r.input ? ageBandLabel(grid, r.input.ageBandCode) : ''}</Table.Td>
                  <Table.Td>{r.input ? disciplineLabel(r.input.discipline) : ''}</Table.Td>
                  <Table.Td>{r.input ? rulesetShort(r.input.ruleset) : ''}</Table.Td>
                  <Table.Td>{r.input ? weightLabel(grid, r.input.weightClassId) : ''}</Table.Td>
                  <Table.Td>{r.input ? prefsLabel(r.input.otherDisciplines ?? []) : ''}</Table.Td>
                  <Table.Td>
                    {(r.errors.length > 0 || r.warnings.length > 0) && (
                      <List size="xs">
                        {r.errors.map((e) => <List.Item key={e} c="red" data-testid="club-form-row-error">{e}</List.Item>)}
                        {r.warnings.map((w) => <List.Item key={w} c="orange">{w}</List.Item>)}
                      </List>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          {parse.removals.length > 0 && (
            <Alert color="orange" title={`Ce réimport retirera ${parse.removals.length} inscription(s) de la fiche précédente`} data-testid="club-form-removals">
              {parse.removals.map((r) => r.label).join(' · ')}
            </Alert>
          )}
          <Group>
            <Button data-testid="club-form-import" onClick={doImport} loading={importForm.isPending} disabled={valid === 0}>
              Importer {valid} inscription(s) valide(s)
            </Button>
            <Text size="sm" c="dimmed">Réimporter la fiche d'un club remplace les inscriptions de sa fiche précédente.</Text>
          </Group>
        </Stack>
      )}
    </Stack>
  );
}
