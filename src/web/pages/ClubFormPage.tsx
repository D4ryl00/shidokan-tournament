import { Button, FileButton, Group, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useRef, useState } from 'react';
import { useParams } from 'react-router';
import { useGrid, useImportClubForm, usePreviewClubForm } from '../api.js';
import { ApiErrorAlert } from '../components/ApiErrorAlert.js';
import { ClubFormPreviewTable } from '../components/ClubFormPreviewTable.js';
import { HELP } from '../help.js';
import { SectionCard } from '../components/ui/SectionCard.js';
import { OnlineEntryPanel } from '../components/OnlineEntryPanel.js';
import { PaperEntryTable } from '../components/PaperEntryTable.js';

export function ClubFormPage() {
  const { id = '' } = useParams();
  const { data: grid } = useGrid(id);
  const preview = usePreviewClubForm(id);
  const importForm = useImportClubForm(id);
  const [file, setFile] = useState<File | null>(null);
  const resetFile = useRef<() => void>(null);
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
        resetFile.current?.();
      },
    });

  return (
    <Stack gap="lg">
      <OnlineEntryPanel competitionId={id} />

      <SectionCard title={HELP['fiche-club.envoyer'].title} help="fiche-club.envoyer">
        <Group gap="sm">
          <Button component="a" href={`/api/competitions/${id}/club-form.ods`} download data-testid="club-form-download" variant="default">
            Télécharger le modèle de fiche (.ods)
          </Button>
          <Button component="a" href={`/api/competitions/${id}/club-form.pdf`} download data-testid="paper-form-download" variant="default">
            Télécharger la fiche papier (PDF)
          </Button>
        </Group>
      </SectionCard>

      <SectionCard title={HELP['fiche-club.importer'].title} help="fiche-club.importer">
        <Group gap="sm">
          <FileButton onChange={onFile} accept=".ods,.xlsx,.xls,.csv" resetRef={resetFile} inputProps={{ 'data-testid': 'club-form-file' } as object}>
            {(props) => <Button variant="default" loading={preview.isPending} {...props}>Choisir le fichier du club</Button>}
          </FileButton>
          {file && <Text size="sm" c="dimmed" className="sk-ellipsis" title={file.name}>{file.name}</Text>}
        </Group>
        <ApiErrorAlert error={preview.error ?? importForm.error} />
        {parse && (
          <Stack>
            <ClubFormPreviewTable parse={parse} grid={grid} />
            <Group>
              <Button data-testid="club-form-import" onClick={doImport} loading={importForm.isPending} disabled={valid === 0}>
                Importer {valid} inscription(s) valide(s)
              </Button>
              <Text size="sm" c="dimmed">Réimporter la fiche d’un club remplace les inscriptions de sa fiche précédente.</Text>
            </Group>
          </Stack>
        )}
      </SectionCard>

      <SectionCard title={HELP['fiche-club.saisir'].title} help="fiche-club.saisir">
        {grid && <PaperEntryTable competitionId={id} grid={grid} />}
      </SectionCard>
    </Stack>
  );
}
