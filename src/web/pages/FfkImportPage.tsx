import { Button, Card, Checkbox, FileButton, Group, List, Loader, Paper, Select, SimpleGrid, Stack, Text } from '@mantine/core';
import { useRef, useState, type ReactNode } from 'react';
import { useParams } from 'react-router';
import { FFK_FIELDS, FFK_FIELD_LABELS } from '../../domain/ffk-import.js';
import type { FfkCardsPlan } from '../../domain/ffk-plan/plan.js';
import { plural } from '../../domain/plural.js';
import { type FfkSheetSetup, useGrid, useUploadFfk } from '../api.js';
import { ApiErrorAlert } from '../components/ApiErrorAlert.js';
import { ClubCards } from '../components/ffk-import/ClubCards.js';
import { OrphansSection } from '../components/ffk-import/OrphansSection.js';
import { useFfkPreview } from '../components/ffk-import/useFfkPreview.js';
import { WeightClassesSection } from '../components/ffk-import/WeightClassesSection.js';
import { SectionCard } from '../components/ui/SectionCard.js';
import { StatusBadge } from '../components/ui/StatusBadge.js';

/** Titre d’une étape de la page : son numéro, puis son nom. */
const step = (n: number, title: string): ReactNode => <><span style={{ color: 'var(--sk-accent)' }}>{n}</span> {title}</>;

/** Résumé collé en haut, sous la barre de la compétition : ce qui reste à trancher, ce qui est déjà réglé. */
function PlanSummary({ summary, loading }: { summary: FfkCardsPlan['summary']; loading: boolean }) {
  const todo = summary.clubsTodo + summary.todo;
  return (
    <Paper withBorder radius="lg" px="md" py="xs" shadow="sm" data-testid="ffk-summary"
      style={{ position: 'sticky', top: 'var(--sk-bar-h, 56px)', zIndex: 50, background: 'var(--sk-bar)' }}>
      <Group gap="xs" wrap="wrap">
        <StatusBadge tone={todo ? 'warn' : 'ok'} wrap>
          {todo ? `${todo.toLocaleString('fr-FR')} à trancher : ${plural(summary.clubsTodo, 'club')} · ${plural(summary.todo, 'combattant')}` : 'Tout est tranché'}
        </StatusBadge>
        <Group gap="xs" ml="auto" wrap="nowrap">
          {loading && <Loader size="xs" aria-label="Aperçu en cours de calcul" />}
          <Text size="sm">{plural(summary.done, 'validée', 'validées')} · {summary.auto.toLocaleString('fr-FR')} sans problème</Text>
        </Group>
      </Group>
    </Paper>
  );
}

/**
 * Import FFK (étape 51) : déposer l’export, régler onglets et colonnes, puis trancher sur une seule page, dans l’ordre :
 * 1 catégories de poids, 2 clubs, 3 combattants de l’export, 4 fiches club sans inscription FFK. Chaque décision entre dans
 * `choices` et l’aperçu est recalculé par le serveur.
 */
export function FfkImportPage() {
  const { id = '' } = useParams();
  const { data: grid } = useGrid(id);
  const upload = useUploadFfk(id);
  const ffk = useFfkPreview(id);
  const [sheets, setSheets] = useState<FfkSheetSetup[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  // « Rapprocher… » d’une fiche sans inscription FFK : la carte choisie doit s’ouvrir liée à ce combattant (section 3, Task 9).
  const [matchRequest, setMatchRequest] = useState<{ cardKey: string; fighterId: string } | null>(null);
  const resetFile = useRef<() => void>(null);
  const { plan, choices, updateChoices } = ffk;

  const onFile = (file: File | null) => {
    setFileName(file?.name ?? null);
    ffk.reset();
    setMatchRequest(null);
    if (!file) return;
    // Fichier envoyé : le champ est vidé pour qu’un nouveau choix du même fichier soit relu.
    resetFile.current?.();
    upload.mutate(file, {
      onSuccess: (r) => {
        setSheets(r.sheets);
        ffk.start(r.uploadId, r.sheets);
      },
    });
  };
  const setSheet = (i: number, patch: Partial<FfkSheetSetup>) => setSheets(sheets.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  const toggleWeightClass = (weightClassId: string, on: boolean) => updateChoices((c) => {
    const rest = (c.acceptedWeightClasses ?? []).filter((x) => x !== weightClassId);
    return { ...c, acceptedWeightClasses: on ? [...rest, weightClassId] : rest };
  });
  const linkClub = (clubEntity: string, target: string | 'none') => updateChoices((c) => ({ ...c, clubLinks: { ...c.clubLinks, [clubEntity]: target } }));
  const setOrphan = (fighterId: string, action: 'keep' | 'delete') => updateChoices((c) => ({ ...c, orphans: { ...c.orphans, [fighterId]: action } }));

  return (
    <Stack gap="lg">
      <SectionCard title="Déposer l’export FFK"
        description="Fichier .xlsx, .xlsm, .ods ou .csv. Rien n’est enregistré avant « Importer… », et rien ne change sur une fiche sans votre accord : tranchez ce que vous pouvez, importez le reste tel quel. Ce qui n’est pas tranché revient au prochain import du fichier.">
        <Group gap="sm">
          <FileButton onChange={onFile} accept=".xlsx,.xlsm,.xls,.ods,.csv" resetRef={resetFile} inputProps={{ 'data-testid': 'ffk-file' } as object}>
            {(props) => <Button variant={ffk.source ? 'default' : 'filled'} loading={upload.isPending} {...props}>Choisir l’export FFK</Button>}
          </FileButton>
          {fileName && <Text size="sm" c="dimmed" className="sk-ellipsis" title={fileName}>{fileName}</Text>}
        </Group>
        <ApiErrorAlert error={upload.error ?? ffk.error} />
      </SectionCard>

      {sheets.length > 0 && (
        <SectionCard title="Onglets et colonnes" description="Les onglets à importer, et la colonne de l’export qui correspond à chaque information."
          actions={<Button variant="default" onClick={() => ffk.recalc(sheets)} loading={ffk.loading}>Recalculer l’aperçu</Button>}>
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
        <>
          <PlanSummary summary={plan.summary} loading={ffk.loading} />

          <SectionCard title={step(1, 'Catégories de poids absentes de la grille')} data-testid="ffk-weight-classes"
            description="Rien n’est créé sans votre accord. Cochez une catégorie pour la créer : ses combattants sont alors importés dedans. Sinon, choisissez pour chacun une catégorie existante dans sa carte.">
            <WeightClassesSection grid={grid} weightClasses={plan.weightClasses} accepted={choices.acceptedWeightClasses ?? []} onToggle={toggleWeightClass} />
          </SectionCard>

          <SectionCard title={step(2, 'Clubs')} data-testid="ffk-clubs"
            description="Reliez chaque club de l’export à un club de la compétition, ou créez-le. Le lien vaut pour tous ses combattants de cet import.">
            <ClubCards competitionId={id} links={plan.clubs} choices={choices.clubLinks} onLink={linkClub} />
          </SectionCard>

          {/* 3. Combattants de l’export : les cartes (Task 9) ; en attendant, la liste brute des cartes à trancher. */}
          <SectionCard title={step(3, 'Combattants de l’export')} data-testid="ffk-cards">
            <List size="sm">
              {plan.cards.filter((c) => c.state === 'todo').map((c) => (
                <List.Item key={c.key}>{c.exportLine.lastName} {c.exportLine.firstName} : {c.reason}</List.Item>
              ))}
            </List>
          </SectionCard>

          <SectionCard title={step(4, 'Fiches club sans inscription FFK')} data-testid="ffk-orphans"
            description="Inscrits de la compétition absents de l’export. Sans action de votre part, ils sont gardés tels quels.">
            <OrphansSection orphans={plan.orphans} cards={plan.cards} grid={grid} actions={choices.orphans} matched={matchRequest}
              onAction={setOrphan} onMatch={(cardKey, fighterId) => setMatchRequest({ cardKey, fighterId })} />
          </SectionCard>
        </>
      )}
    </Stack>
  );
}
