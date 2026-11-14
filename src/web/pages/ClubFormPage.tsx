import { Button, Group, Stack } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useState } from 'react';
import { useParams } from 'react-router';
import { useAuthMe, useClubChanges, useClubLines, useClubs, useGrid, useOrganiserLineOps, useReadClubForm, useReadFfkPdfOrganiser, useResolveClub } from '../api.js';
import { ClubPicker } from '../components/club-picker/ClubPicker.js';
import type { ClubChoice } from '../components/club-picker/choice.js';
import { CompetitionChangesBanner } from '../components/club-changes/ClubChangeBanners.js';
import { useClubChangeDialog } from '../components/club-changes/ClubChangeModal.js';
import { ClubFormImportWizard } from '../components/club-form-import/ClubFormImportWizard.js';
import { FfkImportWizard } from '../components/ffk-import/FfkImportWizard.js';
import { useOrganiserLineInputs } from '../components/club-line/organiserInputs.js';
import { HELP } from '../help.js';
import { SectionCard } from '../components/ui/SectionCard.js';
import { OnlineEntryPanel } from '../components/OnlineEntryPanel.js';
import { PaperEntryTable } from '../components/PaperEntryTable.js';

/** Import du PDF de la FFK par l'organisateur : le club se choisit en tête de la fenêtre, une fiche de l'annuaire n'entre dans la compétition qu'à « Commencer ». */
function FfkPdfImport({ competitionId }: { competitionId: string }) {
  const [opened, setOpened] = useState(false);
  const [choice, setChoice] = useState<ClubChoice | null>(null);
  // Club de la compétition visé par les étapes : le club choisi, ou celui que la fiche d'annuaire est devenue à « Commencer ».
  const [resolved, setResolved] = useState<string | null>(null);
  const clubId = resolved ?? (choice?.kind === 'club' ? choice.id : '');
  const resolveClub = useResolveClub(competitionId);
  const readPdf = useReadFfkPdfOrganiser(competitionId);
  const clubLines = useClubLines(competitionId, clubId);
  const ops = useOrganiserLineOps(competitionId, clubId);
  const inputs = useOrganiserLineInputs(competitionId);
  // Un club déjà dans la compétition : « Commencer » attend ses fiches, le plan en dépend. Une fiche d'annuaire n'a pas de fiches.
  const linesLoaded = clubLines.isSuccess && !clubLines.isFetching;
  const ready = choice !== null && (choice.kind === 'directory' && resolved === null ? true : linesLoaded);
  const close = (message?: string) => {
    setOpened(false);
    setChoice(null);
    setResolved(null);
    if (message) notifications.show({ color: 'green', message });
  };
  return (
    <>
      <Group>
        <Button variant="default" data-testid="ffk-import" onClick={() => setOpened(true)}>Importer le PDF de la FFK</Button>
      </Group>
      <FfkImportWizard opened={opened} mode="organiser" onClose={close} read={(file, discipline) => readPdf.mutateAsync({ file, discipline })}
        lines={clubId ? (clubLines.data ?? []) : []} ops={ops} {...inputs}
        before={<ClubPicker competitionId={competitionId} value={choice} onChange={(next) => { setChoice(next); setResolved(null); }} />}
        ready={ready}
        onBeforeStart={async () => {
          if (choice?.kind === 'directory' && resolved === null) setResolved((await resolveClub(choice)).id);
        }} />
    </>
  );
}

/**
 * Import d'une fiche renvoyée par l'organisateur : le club se choisit (jamais reconnu au nom du fichier), une fiche de l'annuaire
 * n'entre dans la compétition qu'à « Commencer ».
 */
function ClubFormImport({ competitionId }: { competitionId: string }) {
  const [opened, setOpened] = useState(false);
  const [choice, setChoice] = useState<ClubChoice | null>(null);
  // Club de la compétition visé par les étapes : le club choisi, ou celui que la fiche d'annuaire est devenue à « Commencer ».
  const [resolved, setResolved] = useState<string | null>(null);
  const clubId = resolved ?? (choice?.kind === 'club' ? choice.id : '');
  const resolveClub = useResolveClub(competitionId);
  const readForm = useReadClubForm(competitionId);
  const { data: clubs } = useClubs(competitionId);
  const clubLines = useClubLines(competitionId, clubId);
  const ops = useOrganiserLineOps(competitionId, clubId);
  const inputs = useOrganiserLineInputs(competitionId);
  // Un club déjà dans la compétition : « Commencer » attend ses fiches, le plan en dépend. Une fiche d'annuaire n'a pas de fiches.
  const linesLoaded = clubLines.isSuccess && !clubLines.isFetching;
  const ready = choice !== null && (choice.kind === 'directory' && resolved === null ? true : linesLoaded);
  const close = (message?: string) => {
    setOpened(false);
    setChoice(null);
    setResolved(null);
    if (message) notifications.show({ color: 'green', message });
  };
  return (
    <>
      <Group>
        <Button variant="default" data-testid="club-form-import-open" onClick={() => setOpened(true)}>Importer la fiche d’un club</Button>
      </Group>
      <ClubFormImportWizard opened={opened} onClose={close} competitionId={competitionId} read={(file) => readForm.mutateAsync(file)}
        lines={clubId ? (clubLines.data ?? []) : []} ops={ops} club={clubs?.find((c) => c.id === clubId)} {...inputs}
        // « Ajouter un club » : pré-rempli d'après l'en-tête de la fiche, si elle est déjà lue.
        picker={(header) => (
          <ClubPicker competitionId={competitionId} value={choice} onChange={(next) => { setChoice(next); setResolved(null); }}
            prefill={header ? { name: header.club, coachName: header.coachName, coachPhone: header.coachPhone, coachEmails: header.coachEmails } : undefined} />
        )}
        ready={ready}
        onBeforeStart={async () => {
          if (!choice) throw new Error('Choisissez le club.');
          // Relu dans tous les cas : l'étape « coordonnées » compare la fiche au club tel qu'il est maintenant.
          const club = await resolveClub(resolved ? { kind: 'club', id: resolved } : choice);
          setResolved(club.id);
          return club;
        }} />
    </>
  );
}

export function ClubFormPage() {
  const { id = '' } = useParams();
  const { data: grid } = useGrid(id);
  const { data: me } = useAuthMe();
  const { data: changes = [] } = useClubChanges(id);
  const comparison = useClubChangeDialog(changes);

  return (
    <Stack gap="lg">
      {/* Bandeaux hors du panneau en ligne : ils restent sur un PC, où ce panneau n'existe pas. */}
      <CompetitionChangesBanner competitionId={id} onOpen={(clubId) => (clubId ? comparison.open(clubId) : comparison.openFirst())} />
      {comparison.element}
      {/* Inscriptions en ligne et mails : serveur en ligne seulement ; rien tant que le rôle est inconnu. */}
      {me?.role === 'serveur' && <OnlineEntryPanel competitionId={id} />}

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
        <ClubFormImport competitionId={id} />
      </SectionCard>

      <SectionCard title={HELP['fiche-club.pdf-ffk'].title} help="fiche-club.pdf-ffk">
        <FfkPdfImport competitionId={id} />
      </SectionCard>

      <SectionCard title={HELP['fiche-club.saisir'].title} help="fiche-club.saisir">
        {grid && <PaperEntryTable competitionId={id} grid={grid} />}
      </SectionCard>
    </Stack>
  );
}
