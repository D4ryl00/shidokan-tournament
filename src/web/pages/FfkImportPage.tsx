import { Alert, Button, Card, Checkbox, FileButton, Group, List, Select, SimpleGrid, Stack, Text } from '@mantine/core';
import { useRef, useState } from 'react';
import { useParams } from 'react-router';
import { FFK_FIELDS, FFK_FIELD_LABELS } from '../../domain/ffk-import.js';
import { type FfkSheetSetup, useGrid, usePreviewFfk, useUploadFfk } from '../api.js';
import { ApiErrorAlert } from '../components/ApiErrorAlert.js';
import { SectionCard } from '../components/ui/SectionCard.js';
import { ageBandLabel } from '../labels.js';
import { plural } from '../../domain/plural.js';

/**
 * Import FFK (étape 51) : page temporairement réduite au dépôt du fichier, aux onglets et colonnes et à un aperçu brut du
 * plan par cartes ; les étapes (catégories, clubs, cartes, fiches sans inscription FFK) et l'import reviennent aux Tasks 8–9.
 */
export function FfkImportPage() {
  const { id = '' } = useParams();
  const { data: grid } = useGrid(id);
  const upload = useUploadFfk(id);
  const preview = usePreviewFfk(id);
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [sheets, setSheets] = useState<FfkSheetSetup[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const resetFile = useRef<() => void>(null);
  const plan = preview.data;

  const refresh = (s = sheets) => uploadId && preview.mutate({ uploadId, sheets: s, choices: {} });

  const onFile = (file: File | null) => {
    setFileName(file?.name ?? null);
    preview.reset();
    if (!file) return;
    // Fichier envoyé : le champ est vidé pour qu'un nouveau choix du même fichier soit relu.
    resetFile.current?.();
    upload.mutate(file, {
      onSuccess: (r) => {
        setUploadId(r.uploadId);
        setSheets(r.sheets);
        preview.mutate({ uploadId: r.uploadId, sheets: r.sheets, choices: {} });
      },
    });
  };
  const setSheet = (i: number, patch: Partial<FfkSheetSetup>) => setSheets(sheets.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  return (
    <Stack gap="lg">
      <SectionCard title="Déposer l’export FFK"
        description="Fichier .xlsx, .xlsm, .ods ou .csv. Rien n’est enregistré avant « Importer ». L’export FFK fait foi pour l’âge, le poids et le club ; un règlement vide ne remplace pas celui de la fiche club.">
        <Group gap="sm">
          <FileButton onChange={onFile} accept=".xlsx,.xlsm,.xls,.ods,.csv" resetRef={resetFile} inputProps={{ 'data-testid': 'ffk-file' } as object}>
            {(props) => <Button variant={uploadId ? 'default' : 'filled'} loading={upload.isPending} {...props}>Choisir l’export FFK</Button>}
          </FileButton>
          {fileName && <Text size="sm" c="dimmed" className="sk-ellipsis" title={fileName}>{fileName}</Text>}
        </Group>
        <ApiErrorAlert error={upload.error ?? preview.error} />
      </SectionCard>

      {sheets.length > 0 && (
        <SectionCard title="Onglets et colonnes" description="Les onglets à importer, et la colonne de l’export qui correspond à chaque information."
          actions={<Button variant="default" onClick={() => refresh()} loading={preview.isPending}>Recalculer l’aperçu</Button>}>
          <SimpleGrid cols={{ base: 1, md: Math.min(sheets.length, 3) }}>
            {sheets.map((s, i) => (
              <Card key={s.name} withBorder data-testid="ffk-sheet" style={{ backgroundColor: 'var(--sk-bg)' }}>
                <Checkbox data-testid="ffk-sheet-include" label={<b>{s.name}</b>} checked={s.include} onChange={(e) => setSheet(i, { include: e.currentTarget.checked })} />
                {s.include && (
                  <SimpleGrid cols={2} spacing="xs" verticalSpacing={4} mt="xs">
                    {FFK_FIELDS.map((f) => (
                      <Select key={f} data-testid={`ffk-map-${f}`} size="xs" label={FFK_FIELD_LABELS[f]} allowDeselect={false}
                        data={[{ value: '-1', label: '(aucune)' }, ...s.headers.map((h, j) => ({ value: String(j), label: h || `Colonne ${j + 1}` }))]}
                        value={String(s.mapping[f] ?? -1)}
                        onChange={(v) => setSheet(i, { mapping: { ...s.mapping, [f]: v === null || v === '-1' ? null : Number(v) } })} />
                    ))}
                  </SimpleGrid>
                )}
              </Card>
            ))}
          </SimpleGrid>
        </SectionCard>
      )}

      {plan && (
        <SectionCard title="Aperçu de l’import" data-testid="ffk-preview">
          <Alert data-testid="ffk-summary" color={plan.summary.todo || plan.summary.clubsTodo ? 'orange' : 'blue'} title="Résumé">
            {plural(plan.summary.todo, 'carte à trancher', 'cartes à trancher')} · {plural(plan.summary.auto, 'sans problème', 'sans problème')} ·{' '}
            {plural(plan.summary.creates, 'création')} · {plural(plan.summary.updates, 'mise à jour', 'mises à jour')} ·{' '}
            {plural(plan.summary.clubsTodo, 'club non relié', 'clubs non reliés')} · {plural(plan.orphans.length, 'fiche sans inscription FFK', 'fiches sans inscription FFK')}
          </Alert>
          {plan.weightClasses.length > 0 && (
            <Text size="sm">
              Catégories de poids absentes de la grille :{' '}
              {plan.weightClasses.map((w) => `${ageBandLabel(grid, w.ageBandCode)} ${w.sex} ${w.label} (${w.rows})`).join(' · ')}
            </Text>
          )}
          <List size="sm">
            {plan.cards.filter((c) => c.state === 'todo').map((c) => (
              <List.Item key={c.key}>{c.exportLine.lastName} {c.exportLine.firstName} : {c.reason}</List.Item>
            ))}
          </List>
          <Text size="sm" c="dimmed">L’import FFK est en cours de refonte : seul l’aperçu est disponible pour l’instant.</Text>
        </SectionCard>
      )}
    </Stack>
  );
}
