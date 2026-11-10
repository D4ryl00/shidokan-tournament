import { Button, FileButton, Group, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useRef, useState } from 'react';
import { useParams } from 'react-router';
import { useAuthMe, useClubChanges, useDirectoryClubs, useGrid, useImportClubForm, usePreviewClubForm, useResolveClub, type ClubFormPreview } from '../api.js';
import { ClubPicker } from '../components/club-picker/ClubPicker.js';
import type { ClubChoice } from '../components/club-picker/choice.js';
import { ApiErrorAlert } from '../components/ApiErrorAlert.js';
import { CompetitionChangesBanner } from '../components/club-changes/ClubChangeBanners.js';
import { useClubChangeDialog } from '../components/club-changes/ClubChangeModal.js';
import { ClubFormPreviewTable } from '../components/ClubFormPreviewTable.js';
import { HELP } from '../help.js';
import { SectionCard } from '../components/ui/SectionCard.js';
import { OnlineEntryPanel } from '../components/OnlineEntryPanel.js';
import { PaperEntryTable } from '../components/PaperEntryTable.js';
import { plural } from '../../domain/plural.js';

export function ClubFormPage() {
  const { id = '' } = useParams();
  const { data: grid } = useGrid(id);
  const { data: me } = useAuthMe();
  const { data: changes = [] } = useClubChanges(id);
  const comparison = useClubChangeDialog(changes);
  const preview = usePreviewClubForm(id);
  const importForm = useImportClubForm(id);
  const resolveClub = useResolveClub(id);
  const { data: directory = [] } = useDirectoryClubs(id);
  const [file, setFile] = useState<File | null>(null);
  // Aperçu gardé ici : il reste affiché (avec le choix du club) pendant qu'il est relu avec le club choisi.
  const [parse, setParse] = useState<ClubFormPreview | null>(null);
  // Le nom de la fiche ne désigne aucun club de la compétition : l'organisateur choisit le club (résolu seulement à « Importer »).
  const [unmatched, setUnmatched] = useState(false);
  const [choice, setChoice] = useState<ClubChoice | null>(null);
  const [resolveError, setResolveError] = useState<Error | null>(null);
  const resetFile = useRef<() => void>(null);
  const valid = parse?.rows.filter((r) => r.input).length ?? 0;
  const clubKnown = !unmatched || choice !== null;
  // Club de l'aperçu : celui que le serveur a reconnu (nom, alias) ou relu pour le choix, sinon la fiche d'annuaire choisie.
  const clubName = parse?.club?.name ?? (choice?.kind === 'directory' ? directory.find((d) => d.id === choice.id)?.name : undefined);

  const clear = () => {
    preview.reset();
    setParse(null);
    setUnmatched(false);
    setChoice(null);
    setResolveError(null);
  };
  const onFile = (f: File | null) => {
    setFile(f);
    importForm.reset();
    clear();
    if (f) {
      preview.mutate({ file: f }, { onSuccess: (p) => { setParse(p); setUnmatched(p.club === null); } });
      // Fichier gardé en mémoire : le champ est vidé pour qu'un nouveau choix du même fichier (corrigé entre-temps) soit relu.
      resetFile.current?.();
    }
  };
  // Un club de la compétition choisi : l'aperçu est relu pour lui, afin de montrer les inscriptions qui seraient retirées.
  // Une fiche de l'annuaire n'a pas encore de club (donc rien à retirer) : rien n'est écrit avant « Importer ».
  const pick = (next: ClubChoice | null) => {
    setChoice(next);
    setResolveError(null);
    if (file) preview.mutate({ file, clubId: next?.kind === 'club' ? next.id : undefined }, { onSuccess: setParse });
  };
  const doImport = async () => {
    if (!file) return;
    let clubId = parse?.club?.id;
    if (unmatched) {
      try {
        clubId = (await resolveClub(choice!)).id;
      } catch (e) {
        setResolveError(e as Error);
        return;
      }
    }
    importForm.mutate({ file, clubId }, {
      onSuccess: (r) => {
        notifications.show({
          color: 'green',
          message: `${r.club.name} : ${plural(r.imported, 'inscription importée', 'inscriptions importées')}, ${plural(r.replaced, 'remplacée', 'remplacées')}, ${plural(r.skipped, 'ignorée', 'ignorées')}.`,
        });
        clear();
        setFile(null);
        resetFile.current?.();
      },
    });
  };

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
        <Group gap="sm">
          <FileButton onChange={onFile} accept=".ods,.xlsx,.xls,.csv" resetRef={resetFile} inputProps={{ 'data-testid': 'club-form-file' } as object}>
            {(props) => <Button variant="default" loading={preview.isPending} {...props}>Choisir le fichier du club</Button>}
          </FileButton>
          {file && <Text size="sm" c="dimmed" className="sk-ellipsis" title={file.name}>{file.name}</Text>}
        </Group>
        <ApiErrorAlert error={preview.error ?? resolveError ?? importForm.error} />
        {parse && (
          <Stack>
            {unmatched && (
              <Stack gap="xs" data-testid="club-form-club-step">
                <Text size="sm" fw={600}>Club de la fiche : « {parse.header.club} »</Text>
                <Text size="sm" c="dimmed">Ce nom ne correspond à aucun club de la compétition : choisissez le club, ou ajoutez-le.</Text>
                <ClubPicker competitionId={id} value={choice} onChange={pick}
                  prefill={{ name: parse.header.club, coachName: parse.header.coachName, coachPhone: parse.header.coachPhone, coachEmails: parse.header.coachEmails }} />
              </Stack>
            )}
            {clubKnown && <ClubFormPreviewTable parse={parse} grid={grid} clubName={clubName} />}
            <Group>
              <Button data-testid="club-form-import" onClick={doImport} loading={importForm.isPending} disabled={valid === 0 || !clubKnown || preview.isPending || preview.isError}>
                Importer {plural(valid, 'inscription valide', 'inscriptions valides')}
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
