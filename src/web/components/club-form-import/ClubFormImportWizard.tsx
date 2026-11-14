import { Button, FileButton, Group, Input, Loader, Modal, Paper, Stack, Text } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { useEffect, useReducer, useRef, useState, type ReactNode } from 'react';
import { clubHeaderDiff, hasHeaderDiff, planClubFormImport } from '../../../domain/club-form-plan.js';
import type { ClubFormItem, ClubFormRead, ClubFormReadHeader } from '../../../domain/club-form-read.js';
import type { Club } from '../../../domain/registration.js';
import type { ClubEntryView, ClubLine, LineOps } from '../../api.js';
import { SEX_LABELS } from '../../labels.js';
import { ApiErrorAlert } from '../ApiErrorAlert.js';
import { ClubLineForm } from '../ClubLineForm.js';
import { listFr } from '../club-line/ffkStep.js';
import { HomonymScreen } from '../ffk-import/HomonymScreen.js';
import { count, sameSaved, wizardReducer, type WizardState } from '../ffk-import/wizard.js';
import { ClubFormEndScreen } from './ClubFormEndScreen.js';
import { ClubHeaderStep } from './ClubHeaderStep.js';
import { clubFormStepView } from './steps.js';

export interface ClubFormImportWizardProps {
  opened: boolean;
  /** Fin ou abandon du parcours ; `message` : le résumé de fin (notification verte). */
  onClose: (message?: string) => void;
  competitionId: string;
  read: (file: File) => Promise<ClubFormRead>;
  /** Fiches du club, tenues à jour (rechargées après chaque écriture) : chaque étape les relit. */
  lines: ClubLine[];
  ops: LineOps;
  /** Le club visé tel que la liste des clubs le donne en ce moment (relu après une écriture ou un refus). */
  club: Club | undefined;
  multipleCombats: boolean;
  ageBands: ClubEntryView['ageBands'];
  weightClasses: ClubEntryView['weightClasses'];
  closed: string[];
  /** Le choix du club, en tête de la fenêtre de départ ; `header` : l'en-tête lu, pour pré-remplir « Ajouter un club ». */
  picker: (header: ClubFormReadHeader | null) => ReactNode;
  /** `false` : « Commencer » désactivé (club pas encore choisi, fiches pas encore chargées). */
  ready: boolean;
  /** Rend le club choisi effectif (une fiche de l'annuaire entre dans la compétition) et le renvoie, relu. */
  onBeforeStart: () => Promise<Club>;
}

/** Parcours d'import d'une fiche renvoyée par un club : départ, coordonnées du club, une fiche par combattant, fin (absents). */
export function ClubFormImportWizard(props: ClubFormImportWizardProps) {
  // Démonté à la fermeture : chaque ouverture repart du départ.
  return props.opened ? <Wizard {...props} /> : null;
}

const describeFile = (item: ClubFormItem, ageBands: ClubEntryView['ageBands']) => {
  const { lastName, firstName, sex, ageBandCode } = item.line;
  const parts = [sex ? SEX_LABELS[sex].toLowerCase() : null, ageBands.find((b) => b.code === ageBandCode)?.label ?? null].filter(Boolean);
  return `La fiche renvoyée inscrit « ${lastName.toUpperCase()} ${firstName} »${parts.length ? ` (${parts.join(', ')})` : ''}.`;
};

/**
 * Étape « coordonnées » : `counted` (décidé à « Commencer ») la compte dans la progression ; `club` : le club auquel l'étape
 * affichée compare la fiche (`null` : pas affichée) ; `round` la remonte.
 */
interface HeaderStage { counted: boolean; club: Club | null; round: number }

function Wizard({ onClose, competitionId, read, lines, ops, club: liveClub, multipleCombats, ageBands, weightClasses, closed, picker, ready, onBeforeStart }: ClubFormImportWizardProps) {
  const mobile = useMediaQuery('(max-width: 600px)');
  const [state, dispatch] = useReducer(wizardReducer<ClubFormItem>, { stage: 'start' } as WizardState<ClubFormItem>);
  const [file, setFile] = useState<File | null>(null);
  const [form, setForm] = useState<{ reading: boolean; read: ClubFormRead | null; error: unknown }>({ reading: false, read: null, error: null });
  const [busy, setBusy] = useState<{ pending: boolean; error: unknown }>({ pending: false, error: null });
  const [header, setHeader] = useState<HeaderStage>({ counted: false, club: null, round: 0 });
  // Le club renvoyé à « Commencer » : sert tant que la liste des clubs ne le contient pas encore (fiche d'annuaire à l'instant).
  const [startClub, setStartClub] = useState<Club | null>(null);
  const club = liveClub && liveClub.id === startClub?.id ? liveClub : startClub;
  const request = useRef(0);
  const resetFile = useRef<() => void>(null);
  // Le plan se calcule à « Commencer », après `onBeforeStart` : sur les fiches du dernier rendu.
  const linesRef = useRef(lines);
  linesRef.current = lines;

  const differs = (c: Club | null) => !!form.read && !!c && hasHeaderDiff(clubHeaderDiff(form.read.header, c));
  // Rien de différent (plus rien, après un refus) : l'étape est sautée.
  const onHeader = differs(header.club);
  useEffect(() => {
    if (header.club && !onHeader) setHeader((h) => ({ ...h, club: null }));
  }, [header.club, onHeader]);

  // Lecture dès le choix du fichier ; une lecture dépassée par un nouveau choix est ignorée.
  const chooseFile = (f: File | null) => {
    setFile(f);
    resetFile.current?.();
    const id = ++request.current;
    if (!f) return setForm({ reading: false, read: null, error: null });
    setForm({ reading: true, read: null, error: null });
    read(f).then(
      (r) => id === request.current && setForm({ reading: false, read: r, error: null }),
      (error: unknown) => id === request.current && setForm({ reading: false, read: null, error }),
    );
  };

  const preview = form.read ? planClubFormImport(form.read.items, lines) : null;
  const begin = async () => {
    if (!form.read) return;
    setBusy({ pending: true, error: null });
    let resolved: Club;
    try {
      resolved = await onBeforeStart();
    } catch (error) {
      return setBusy({ pending: false, error });
    }
    setBusy({ pending: false, error: null });
    setStartClub(resolved);
    const counted = differs(resolved);
    setHeader({ counted, club: counted ? resolved : null, round: 0 });
    dispatch({ type: 'start', plan: planClubFormImport(form.read.items, linesRef.current) });
  };

  if (state.stage === 'start' || !form.read || !club) {
    const steps = preview?.steps.length ?? 0;
    const fresh = preview?.steps.filter((s) => s.kind === 'new').length ?? 0;
    const merged = form.read?.merged ?? [];
    return (
      <Modal opened onClose={() => onClose()} fullScreen={mobile} title="Importer une fiche renvoyée">
        <Stack data-testid="club-form-start">
          {picker(form.read?.header ?? null)}
          <Input.Wrapper label="Fichier" required labelElement="div">
            <Group gap="sm" mt={4} wrap="nowrap">
              <FileButton resetRef={resetFile} accept=".ods,.xlsx,.xls,.csv" onChange={chooseFile} inputProps={{ 'data-testid': 'club-form-file' } as object}>
                {(p) => <Button variant="default" {...p}>{file ? 'Changer de fichier' : 'Choisir le fichier du club'}</Button>}
              </FileButton>
              {file && <Text size="sm" truncate data-testid="club-form-file-name">{file.name}</Text>}
            </Group>
          </Input.Wrapper>
          {form.reading && (
            <Group gap="xs"><Loader size="sm" /><Text size="sm" c="dimmed">Lecture de la fiche…</Text></Group>
          )}
          <ApiErrorAlert error={form.error} />
          {form.read && <Text size="sm" data-testid="club-form-club">La fiche indique le club « {form.read.header.club} ».</Text>}
          {preview && form.read && (
            <Paper withBorder p="sm" radius="md" style={{ background: 'var(--sk-bg)' }}>
              <Stack gap={6}>
                <Text data-testid="club-form-counts">
                  <b>{fresh}</b> {fresh <= 1 ? 'nouveau' : 'nouveaux'} · <b>{steps - fresh}</b> {steps - fresh <= 1 ? 'fiche existante à revoir' : 'fiches existantes à revoir'} · <b>{preview.upToDate}</b> déjà à jour
                </Text>
                {merged.length > 0 && (
                  <Text size="sm" c="dimmed" data-testid="club-form-merged">
                    {count(merged.reduce((n, m) => n + m.rows.length, 0), 'ligne réunie', 'lignes réunies')} : {merged.map((m) => `${m.label} (lignes ${listFr(m.rows.map(String))})`).join(', ')}.
                  </Text>
                )}
                <Text size="sm" c="dimmed">
                  {steps
                    ? `Vous allez voir ${steps === 1 ? 'la fiche' : `les ${steps} fiches`} une par une. Chaque fiche est enregistrée quand vous passez à la suivante ; vous pouvez arrêter à tout moment et réimporter plus tard la même fiche pour finir.`
                    : form.read.items.length ? 'Rien à revoir : tous les combattants de la fiche sont déjà à jour.' : 'La fiche ne contient aucun combattant.'}
                </Text>
              </Stack>
            </Paper>
          )}
          <ApiErrorAlert error={busy.error} />
          <Group justify="flex-end" gap="xs">
            <Button variant="default" onClick={() => onClose()}>Annuler</Button>
            <Button data-testid="club-form-begin" disabled={!preview || !ready} loading={busy.pending} onClick={begin}>
              {!preview ? 'Commencer' : steps === 0 ? 'Continuer' : `Commencer (${count(steps, 'fiche', 'fiches')})`}
            </Button>
          </Group>
        </Stack>
      </Modal>
    );
  }

  // Coordonnées d'abord, comptées comme la première fiche.
  const offset = header.counted ? 1 : 0;
  const total = state.plan.steps.length + offset;
  if (onHeader) {
    return (
      <ClubHeaderStep key={header.round} competitionId={competitionId} club={header.club!} header={form.read.header} progress={{ index: 0, total }} mobile={!!mobile}
        onDone={() => setHeader((h) => ({ ...h, club: null }))} onStale={(fresh) => setHeader((h) => ({ ...h, club: fresh, round: h.round + 1 }))} onClose={() => onClose()} />
    );
  }

  if (state.stage === 'end') {
    return <ClubFormEndScreen state={state} lines={lines} ops={ops} ageBands={ageBands} weightClasses={weightClasses} mobile={!!mobile} onClose={onClose}
      toggle={(fighterId) => dispatch({ type: 'toggleAbsent', fighterId })} />;
  }

  const view = clubFormStepView(state, { lines, ageBands, weightClasses });
  const index = state.index;
  const progress = { index: index + offset, total };
  // Depuis la première fiche : retour aux coordonnées, tant qu'elles diffèrent encore du club (celui du moment).
  const previous = index > 0 ? () => dispatch({ type: 'previous' })
    : header.counted && differs(club) ? () => setHeader((h) => ({ ...h, club, round: h.round + 1 })) : null;

  if (view.kind === 'homonym') {
    return (
      <HomonymScreen intro={describeFile(view.ffk, ageBands)} candidates={view.candidates} ageBands={ageBands} progress={progress} mobile={!!mobile}
        onResolve={(fighterId) => dispatch({ type: 'resolve', fighterId })} onPrevious={previous} onClose={() => onClose()} />
    );
  }

  // Une inscription créée par ce parcours a l'origine « Fiche club ».
  const fileOps: LineOps = { ...ops, save: (args) => ops.save({ ...args, source: 'club_form' }) };
  return (
    <ClubLineForm
      // Remontée à chaque étape, et quand la fiche relue a changé (409 : comparaison recalculée sur la nouvelle version).
      key={`${state.round}:${view.line?.version ?? 'new'}`}
      ops={fileOps} mode="organiser" multipleCombats={multipleCombats} line={view.line} ageBands={ageBands} weightClasses={weightClasses} closed={closed} opened
      onClose={(message) => {
        // Un refus (fiche changée ou supprimée ailleurs…) : la liste est rechargée, la même fiche est relue.
        if (message) {
          notifications.show({ color: 'orange', message });
          dispatch({ type: 'stale' });
        } else onClose();
      }}
      ffk={{
        ...view.ffk, progress, onPrevious: previous,
        onSkip: () => dispatch({ type: 'skipped', index }),
        // Fiche verrouillée passée, ou réenregistrée sans changement : laissée telle quelle. `index` : l'étape de ce rendu.
        onSaved: (message, saved) => {
          if (message) notifications.show({ color: 'orange', message });
          const changed = saved && !(view.line && sameSaved(view.line, saved));
          dispatch(changed ? { type: 'saved', index, line: saved, created: view.line === null } : { type: 'skipped', index });
        },
      }} />
  );
}
