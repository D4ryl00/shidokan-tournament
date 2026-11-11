import { Button, Group, Loader, Modal, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useState } from 'react';
import type { Club } from '../../domain/registration.js';
import { useClubs, useFighterLine, useOrganiserLineOps, useResolveClub } from '../api.js';
import type { ClubLine } from '../api.js';
import { ApiErrorAlert } from './ApiErrorAlert.js';
import { ClubLineForm, type SavedThen } from './ClubLineForm.js';
import { ClubPicker } from './club-picker/ClubPicker.js';
import type { ClubChoice } from './club-picker/choice.js';
import { useOrganiserLineInputs } from './club-line/organiserInputs.js';

export type FighterWindowMode = { kind: 'add' } | { kind: 'edit'; fighterId: string };

/**
 * Fenêtre de l'écran Inscriptions : l'étape « Club » (ajout, changement de club, combattant sans club), puis la fenêtre du
 * combattant du coach en mode organisateur. Le club d'un choix est résolu à « Suivant » : la fenêtre du coach reçoit un club réel.
 */
export function FighterWindow({ competitionId, opened, mode, onClose }: {
  competitionId: string;
  opened: boolean;
  mode: FighterWindowMode;
  onClose: () => void;
}) {
  return opened ? <OpenWindow competitionId={competitionId} mode={mode} onClose={onClose} /> : null;
}

function OpenWindow({ competitionId, mode, onClose }: { competitionId: string; mode: FighterWindowMode; onClose: () => void }) {
  const fighterId = mode.kind === 'edit' ? mode.fighterId : '';
  const fighter = useFighterLine(competitionId, fighterId);
  const loading = mode.kind === 'edit' && fighter.isLoading;
  if (loading || (mode.kind === 'edit' && !fighter.data)) {
    return (
      <Modal opened onClose={onClose} title="Modifier le combattant">
        {fighter.error ? <Stack><ApiErrorAlert error={fighter.error} /><Button variant="default" onClick={onClose}>Fermer</Button></Stack>
          : <Group justify="center" p="md"><Loader /></Group>}
      </Modal>
    );
  }
  return <Steps competitionId={competitionId} mode={mode} line={mode.kind === 'edit' ? (fighter.data ?? null) : null} onClose={onClose} />;
}

function Steps({ competitionId, mode, line, onClose }: {
  competitionId: string;
  mode: FighterWindowMode;
  line: ClubLine | null;
  onClose: () => void;
}) {
  const inputs = useOrganiserLineInputs(competitionId);
  const resolve = useResolveClub(competitionId);
  // Club de la ligne : celui du combattant tant qu'on n'en choisit pas un autre ; sans club, l'étape club vient d'abord.
  const [club, setClub] = useState<{ id: string; name: string } | null>(null);
  const [step, setStep] = useState<'club' | 'line'>(mode.kind === 'edit' && line?.clubId ? 'line' : 'club');
  const [choice, setChoice] = useState<ClubChoice | null>(mode.kind === 'edit' && line?.clubId ? { kind: 'club', id: line.clubId } : null);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [round, setRound] = useState(0); // « Enregistrer et ajouter un autre » : fenêtre vide, même club
  const chosenClubId = club?.id ?? line?.clubId ?? '';
  const ops = useOrganiserLineOps(competitionId, chosenClubId);
  const { data: clubs = [] } = useClubs(competitionId);
  const clubName = club?.name ?? clubs.find((c) => c.id === chosenClubId)?.name;

  const next = () => {
    if (!choice) return;
    setResolving(true);
    setError(null);
    resolve(choice).then(
      (c: Club) => { setClub({ id: c.id, name: c.name }); setResolving(false); setStep('line'); },
      (e: unknown) => { setResolving(false); setError(e); },
    );
  };
  const done = (message?: string) => {
    if (message) notifications.show({ color: 'yellow', message, autoClose: false });
    onClose();
  };
  // « Enregistrer et ajouter un autre » (bouton ou Entrée) : une notification passagère confirme, la fenêtre repart à vide sur le même club.
  const savedThenNext: SavedThen = (message, saved) => {
    notifications.show({ color: 'green', message: saved ? `${saved.line.lastName} ${saved.line.firstName} : enregistré.` : 'Combattant enregistré.' });
    if (message) notifications.show({ color: 'yellow', message, autoClose: false });
    setRound((n) => n + 1);
  };

  // Un combattant sans club n'est pas « verrouillé » : une fois son club choisi, sa fenêtre est éditable (sauf combats commencés).
  const formLine = line && !line.editable && !line.reason && chosenClubId ? { ...line, editable: true } : line;
  const clubStep = (
      <Modal opened onClose={onClose} title={mode.kind === 'add' ? 'Ajouter un combattant' : line?.clubId ? 'Changer de club' : 'Choisir le club'}>
        <Stack>
          <Text size="sm" c="dimmed">Choisissez le club du combattant, puis saisissez sa fiche.</Text>
          <ClubPicker competitionId={competitionId} value={choice} onChange={(c) => { setChoice(c); setError(null); }} />
          <ApiErrorAlert error={error} />
          <Group justify="flex-end">
            {/* En modification, « Annuler » revient à la fenêtre du combattant (le brouillon y est gardé) ; sans club choisi, il n'y en a pas. */}
            <Button variant="default" onClick={mode.kind === 'edit' && chosenClubId ? () => { setError(null); setStep('line'); } : onClose}>Annuler</Button>
            <Button data-testid="fighter-next" disabled={!choice} loading={resolving} onClick={next}>Suivant</Button>
          </Group>
        </Stack>
      </Modal>
  );

  // Le formulaire reste monté pendant l'étape « Club » (fenêtre fermée) : le brouillon est gardé quand on y va et revient.
  return (
    <>
    {step === 'club' && clubStep}
    <ClubLineForm
      key={mode.kind === 'add' ? `add-${round}` : mode.fighterId}
      ops={ops} mode="organiser" {...inputs}
      line={formLine} opened={step === 'line'} onClose={done}
      title={mode.kind === 'add' ? `Ajouter un combattant · ${clubName ?? ''}` : clubName ? `${line?.line.lastName} ${line?.line.firstName} · ${clubName}` : undefined}
      // Entrée : en ajout, « Enregistrer et ajouter un autre » ; en modification, « Enregistrer ».
      onEnter={(saveThen) => (mode.kind === 'add' ? saveThen(savedThenNext) : saveThen())}
      footerExtra={(saveThen) => (
        <>
          {mode.kind === 'edit' && (
            <Button variant="subtle" data-testid="fighter-change-club" onClick={() => { setChoice(club ? { kind: 'club', id: club.id } : choice); setStep('club'); }}>Changer de club</Button>
          )}
          {mode.kind === 'add' && (
            <Button variant="default" data-testid="line-save-next" loading={ops.pending} title="Entrée"
              onClick={() => saveThen(savedThenNext)}>Enregistrer et ajouter un autre</Button>
          )}
        </>
      )}
    />
    </>
  );
}
