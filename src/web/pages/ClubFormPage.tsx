import { Anchor, Button, Group, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useState } from 'react';
import { useParams } from 'react-router';
import { useGrid, useImportClubForm, usePreviewClubForm } from '../api.js';
import { ApiErrorAlert } from '../components/ApiErrorAlert.js';
import { ClubFormPreviewTable } from '../components/ClubFormPreviewTable.js';
import { SectionHeader } from '../components/Help.js';
import { OnlineEntryPanel } from '../components/OnlineEntryPanel.js';
import { PaperEntryTable } from '../components/PaperEntryTable.js';

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
    <Stack>
      <OnlineEntryPanel competitionId={id} />

      <SectionHeader topic="fiche-club.envoyer" />
      <Group>
        <Anchor href={`/api/competitions/${id}/club-form.ods`} download data-testid="club-form-download">
          <Button component="span" variant="light">Télécharger le modèle de fiche (.ods)</Button>
        </Anchor>
        <Anchor href={`/api/competitions/${id}/club-form.pdf`} download data-testid="paper-form-download">
          <Button component="span" variant="light">Télécharger la fiche papier (PDF)</Button>
        </Anchor>
      </Group>

      <SectionHeader topic="fiche-club.importer" />
      <input data-testid="club-form-file" type="file" accept=".ods,.xlsx,.xls,.csv"
        onChange={(e) => onFile(e.currentTarget.files?.[0] ?? null)} key={file ? 'f' : 'empty'} />
      <ApiErrorAlert error={preview.error ?? importForm.error} />

      {parse && (
        <Stack>
          <ClubFormPreviewTable parse={parse} grid={grid} />
          <Group>
            <Button data-testid="club-form-import" onClick={doImport} loading={importForm.isPending} disabled={valid === 0}>
              Importer {valid} inscription(s) valide(s)
            </Button>
            <Text size="sm" c="dimmed">Réimporter la fiche d'un club remplace les inscriptions de sa fiche précédente.</Text>
          </Group>
        </Stack>
      )}

      <SectionHeader topic="fiche-club.saisir" />
      {grid && <PaperEntryTable competitionId={id} grid={grid} />}
    </Stack>
  );
}
