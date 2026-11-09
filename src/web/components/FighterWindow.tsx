import { Button, Group, Loader, Modal, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useState } from 'react';
import { entryKey } from '../../domain/closed-categories.js';
import { ageRangeText } from '../../domain/grid.js';
import type { Club } from '../../domain/registration.js';
import { useClosedCategories, useClubs, useCompetition, useFighterLine, useGrid, useOrganiserLineOps, useResolveClub } from '../api.js';
import type { ClubLine } from '../api.js';
import { ApiErrorAlert } from './ApiErrorAlert.js';
import { ClubLineForm } from './ClubLineForm.js';
import { ClubPicker } from './club-picker/ClubPicker.js';
import type { ClubChoice } from './club-picker/choice.js';

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
  const { data: grid } = useGrid(competitionId);
  const { data: closedView } = useClosedCategories(competitionId);
  const { data: competition } = useCompetition(competitionId);
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

  if (step === 'club') {
    return (
      <Modal opened onClose={onClose} title={mode.kind === 'add' ? 'Ajouter un combattant' : 'Changer de club'}>
        <Stack>
          <Text size="sm" c="dimmed">Choisissez le club du combattant, puis saisissez sa fiche.</Text>
          <ClubPicker competitionId={competitionId} value={choice} onChange={(c) => { setChoice(c); setError(null); }} />
          <ApiErrorAlert error={error} />
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>Annuler</Button>
            <Button data-testid="fighter-next" disabled={!choice} loading={resolving} onClick={next}>Suivant</Button>
          </Group>
        </Stack>
      </Modal>
    );
  }

  const ageBands = (grid?.ageBands ?? []).map((b) => ({ code: b.code, label: b.label, ages: ageRangeText(b), isMinor: b.isMinor }));
  const weightClasses = [...(grid?.weightClasses ?? [])]
    .sort((a, b) => (a.maxKg ?? Infinity) - (b.maxKg ?? Infinity))
    .map(({ id, ageBandCode, sex, label, maxKg }) => ({ id, ageBandCode, sex, label, maxKg }));
  const closed = (closedView?.closed ?? []).map(entryKey);
  return (
    <ClubLineForm
      key={mode.kind === 'add' ? `add-${round}` : mode.fighterId}
      ops={ops} mode="organiser" multipleCombats={competition?.settings.multipleCombatDisciplinesPerDay ?? false}
      line={line} ageBands={ageBands} weightClasses={weightClasses} closed={closed} opened onClose={done}
      title={mode.kind === 'add' ? `Ajouter un combattant · ${clubName ?? ''}` : clubName ? `${line?.line.lastName} ${line?.line.firstName} · ${clubName}` : undefined}
      footerExtra={(saveThen) => (
        <>
          {mode.kind === 'edit' && (
            <Button variant="subtle" data-testid="fighter-change-club" onClick={() => { setChoice(club ? { kind: 'club', id: club.id } : choice); setStep('club'); }}>Changer de club</Button>
          )}
          {mode.kind === 'add' && (
            <Button variant="default" data-testid="line-save-next" loading={ops.pending}
              onClick={() => saveThen((message) => {
                if (message) notifications.show({ color: 'yellow', message, autoClose: false });
                setRound((n) => n + 1);
              })}>Enregistrer et ajouter un autre</Button>
          )}
        </>
      )}
    />
  );
}
