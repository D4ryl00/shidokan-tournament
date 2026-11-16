import { Button, Card, Checkbox, FileButton, Group, Loader, Paper, Select, SimpleGrid, Stack, Text } from '@mantine/core';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useParams } from 'react-router';
import { FFK_FIELDS, FFK_FIELD_LABELS } from '../../domain/ffk-import.js';
import type { FfkCardsPlan } from '../../domain/ffk-plan/plan.js';
import { plural } from '../../domain/plural.js';
import { type FfkSheetSetup, useGrid, useUploadFfk } from '../api.js';
import { ApiErrorAlert } from '../components/ApiErrorAlert.js';
import { chosenFighter, pageState, type CardDraft } from '../components/ffk-import/cardState.js';
import { ClubCards } from '../components/ffk-import/ClubCards.js';
import { FighterCards } from '../components/ffk-import/FighterCards.js';
import { ImportBar } from '../components/ffk-import/ImportBar.js';
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
  // « Rapprocher… » d’une fiche sans inscription FFK : la section 3 ouvre la carte choisie, liée à ce combattant.
  const [matchRequest, setMatchRequest] = useState<{ cardKey: string; fighterId: string } | null>(null);
  // Cartes en cours (choisies ou modifiées, pas encore validées) : restent dans la page jusqu’à « Valider la carte ».
  const [drafts, setDrafts] = useState<Record<string, CardDraft>>({});
  const resetFile = useRef<() => void>(null);
  const { plan, choices, updateChoices } = ffk;
  const states = useMemo(
    () => Object.fromEntries((plan?.cards ?? []).map((c) => [c.key, pageState(c, drafts[c.key], choices.cards?.[c.key])])),
    [plan, drafts, choices.cards],
  );
  // « Rapproché de la ligne FFK … » tant que la carte a encore ce combattant (pas après « Annuler », « Ne pas lier » ou un autre choix).
  const matchedCard = matchRequest && plan?.cards.find((c) => c.key === matchRequest.cardKey);
  const matched = matchedCard && chosenFighter(matchedCard, drafts[matchedCard.key], choices.cards?.[matchedCard.key]) === matchRequest.fighterId ? matchRequest : null;

  /** Nouveau fichier, ou import fait : la page repart de zéro. */
  const clear = () => {
    ffk.reset();
    setDrafts({});
    setMatchRequest(null);
  };
  const onFile = (file: File | null) => {
    setFileName(file?.name ?? null);
    clear();
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

          <SectionCard title={step(1, 'Catégories de poids absentes de la grille')} data-testid="ffk-weight-classes" help="import-ffk.categories">
            <WeightClassesSection grid={grid} weightClasses={plan.weightClasses} accepted={choices.acceptedWeightClasses ?? []} onToggle={toggleWeightClass} />
          </SectionCard>

          <SectionCard title={step(2, 'Clubs')} data-testid="ffk-clubs" help="import-ffk.clubs">
            <ClubCards competitionId={id} links={plan.clubs} choices={choices.clubLinks} onLink={linkClub} />
          </SectionCard>

          <SectionCard title={step(3, 'Combattants de l’export')} data-testid="ffk-cards" help="import-ffk.cartes">
            {/* Remontée à chaque fichier : filtre, carte ouverte et cartes vues repartent de zéro. */}
            <FighterCards key={ffk.source?.uploadId} competitionId={id} plan={plan} grid={grid} choices={choices} updateChoices={updateChoices}
              drafts={drafts} setDrafts={setDrafts} states={states} stale={ffk.stale} matchRequest={matchRequest} />
          </SectionCard>

          <SectionCard title={step(4, 'Fiches club sans inscription FFK')} data-testid="ffk-orphans" help="import-ffk.sans-ffk">
            <OrphansSection orphans={plan.orphans} cards={plan.cards} grid={grid} actions={choices.orphans} matched={matched}
              onAction={setOrphan} onMatch={(cardKey, fighterId) => setMatchRequest({ cardKey, fighterId })} />
          </SectionCard>

          {ffk.source && (
            <ImportBar competitionId={id} source={ffk.source} choices={choices} plan={plan} states={states} grid={grid}
              stale={ffk.stale} failed={!!ffk.error} onConflict={ffk.refresh}
              onImported={() => {
                setFileName(null);
                setSheets([]);
                clear();
              }} />
          )}
        </>
      )}
    </Stack>
  );
}
