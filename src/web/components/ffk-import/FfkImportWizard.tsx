import { Box, Button, Checkbox, FileButton, Group, Input, Loader, Modal, Paper, Select, Stack, Text, Title, UnstyledButton } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { useEffect, useReducer, useRef, useState, type ReactNode } from 'react';
import { hasDiscipline, planFfkImport, withoutDiscipline, type FfkPdfRead } from '../../../domain/ffk-pdf-plan.js';
import type { DisciplineId } from '../../../domain/types.js';
import { ApiError, RELOAD_STATUSES, type ClubEntryView, type ClubLine, type LineOps } from '../../api.js';
import { DISCIPLINE_OPTIONS, disciplineLabel, SEX_LABELS } from '../../labels.js';
import { ApiErrorAlert } from '../ApiErrorAlert.js';
import { ClubLineForm } from '../ClubLineForm.js';
import { FfkProgress } from '../club-line/FfkProgress.js';
import { FfkPdfSource } from './FfkPdfSource.js';
import { listFr } from '../club-line/ffkStep.js';
import { absentRows, count, disciplinesOf, sameSaved, startCounts, stepView, summaryText, wizardReducer, wizardSummary, type WizardState } from './wizard.js';

export interface FfkImportWizardProps {
  opened: boolean;
  /** Fin ou abandon du parcours ; `message` : le résumé de fin (notification verte). */
  onClose: (message?: string) => void;
  mode: 'coach' | 'organiser';
  read: (file: File, discipline: DisciplineId) => Promise<FfkPdfRead>;
  /** Fiches du club, tenues à jour (rechargées après chaque écriture) : chaque étape les relit. */
  lines: ClubLine[];
  ops: LineOps;
  multipleCombats: boolean;
  ageBands: ClubEntryView['ageBands'];
  weightClasses: ClubEntryView['weightClasses'];
  closed: string[];
  /** Étape Club de l'organisateur, en tête de la fenêtre de départ. */
  before?: ReactNode;
  /** `false` : « Commencer » désactivé (club pas encore choisi, fiches pas encore chargées). */
  ready?: boolean;
  /** Organisateur : rend le club choisi effectif avant la première fiche. Le plan est calculé ensuite, sur `lines` du moment. */
  onBeforeStart?: () => Promise<void>;
}

/** Parcours d'import du PDF « État des inscriptions » de la FFK : départ, une fiche par combattant, fin (absents du PDF). */
export function FfkImportWizard(props: FfkImportWizardProps) {
  // Démonté à la fermeture : chaque ouverture repart du départ.
  return props.opened ? <Wizard {...props} /> : null;
}

const fighterName = (l: ClubLine) => `${l.line.lastName.toUpperCase()} ${l.line.firstName}`;

function Wizard({ onClose, mode, read, lines, ops, multipleCombats, ageBands, weightClasses, closed, before, ready = true, onBeforeStart }: FfkImportWizardProps) {
  const mobile = useMediaQuery('(max-width: 600px)');
  const [state, dispatch] = useReducer(wizardReducer, { stage: 'start' } as WizardState);
  const [discipline, setDiscipline] = useState<DisciplineId | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [pdf, setPdf] = useState<{ reading: boolean; read: FfkPdfRead | null; error: unknown }>({ reading: false, read: null, error: null });
  const [busy, setBusy] = useState<{ pending: boolean; error: unknown }>({ pending: false, error: null });
  const request = useRef(0);
  const resetFile = useRef<() => void>(null);
  // Le plan se calcule à « Commencer », après `onBeforeStart` : sur les fiches du dernier rendu.
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const opts = { multipleCombats, mode };

  // Lecture dès que la discipline et le fichier sont choisis ; une lecture dépassée par un nouveau choix est ignorée.
  const load = (f: File | null, d: DisciplineId | null) => {
    const id = ++request.current;
    if (!f || !d) return setPdf({ reading: false, read: null, error: null });
    setPdf({ reading: true, read: null, error: null });
    read(f, d).then(
      (r) => id === request.current && setPdf({ reading: false, read: r, error: null }),
      (error: unknown) => id === request.current && setPdf({ reading: false, read: null, error }),
    );
  };
  const chooseDiscipline = (d: DisciplineId | null) => { setDiscipline(d); load(file, d); };
  const chooseFile = (f: File | null) => { setFile(f); load(f, discipline); resetFile.current?.(); };

  const preview = pdf.read && discipline ? planFfkImport(pdf.read.fighters, lines, discipline, opts) : null;
  const begin = async () => {
    if (!pdf.read || !discipline) return;
    setBusy({ pending: true, error: null });
    try {
      await onBeforeStart?.();
    } catch (error) {
      return setBusy({ pending: false, error });
    }
    setBusy({ pending: false, error: null });
    dispatch({ type: 'start', plan: planFfkImport(pdf.read.fighters, linesRef.current, discipline, opts) });
  };

  if (state.stage === 'start' || !discipline) {
    const counts = preview && pdf.read ? startCounts(pdf.read, preview) : null;
    const steps = preview?.steps.length ?? 0;
    return (
      <Modal opened onClose={() => onClose()} fullScreen={mobile} title="Importer le PDF de la FFK">
        <Stack data-testid="ffk-start-form">
          <FfkPdfSource />
          {before}
          <Select data-testid="ffk-discipline" label="Discipline de ce PDF" required placeholder="Choisir la discipline" data={DISCIPLINE_OPTIONS}
            value={discipline} allowDeselect={false} onChange={(v) => chooseDiscipline(v as DisciplineId | null)} comboboxProps={{ withinPortal: true }} />
          <Input.Wrapper label="Fichier" required labelElement="div">
            <Group gap="sm" mt={4} wrap="nowrap">
              <FileButton resetRef={resetFile} accept=".pdf,application/pdf" onChange={chooseFile}>
                {(p) => <Button variant="default" data-testid="ffk-file" {...p}>{file ? 'Changer de fichier' : 'Choisir le PDF'}</Button>}
              </FileButton>
              {file && <Text size="sm" truncate data-testid="ffk-file-name">{file.name}</Text>}
            </Group>
          </Input.Wrapper>
          {pdf.reading && (
            <Group gap="xs"><Loader size="sm" /><Text size="sm" c="dimmed">Lecture du PDF…</Text></Group>
          )}
          <ApiErrorAlert error={pdf.error} />
          {counts && (
            <Paper withBorder p="sm" radius="md" style={{ background: 'var(--sk-bg)' }}>
              <Stack gap={6}>
                <Text data-testid="ffk-counts">
                  <b>{counts.fresh}</b> {counts.fresh <= 1 ? 'nouveau' : 'nouveaux'} · <b>{counts.review}</b> {counts.review <= 1 ? 'fiche existante à revoir' : 'fiches existantes à revoir'} · <b>{counts.upToDate}</b> déjà à jour
                </Text>
                {pdf.read!.duplicates.length > 0 && (
                  <Text size="sm" c="dimmed" data-testid="ffk-duplicates">
                    {count(pdf.read!.duplicates.length, 'ligne en double ignorée', 'lignes en double ignorées')} : {pdf.read!.duplicates.join(', ')}.
                  </Text>
                )}
                <Text size="sm" c="dimmed">
                  {steps
                    ? `Vous allez voir ${steps === 1 ? 'la fiche' : `les ${steps} fiches`} une par une. Chaque fiche est enregistrée quand vous passez à la suivante ; vous pouvez arrêter à tout moment et réimporter plus tard le même PDF pour finir.`
                    : 'Rien à revoir : toutes les fiches du PDF sont déjà à jour.'}
                </Text>
              </Stack>
            </Paper>
          )}
          <ApiErrorAlert error={busy.error} />
          <Group justify="flex-end" gap="xs">
            <Button variant="default" onClick={() => onClose()}>Annuler</Button>
            <Button data-testid="ffk-begin" disabled={!preview || !ready} loading={busy.pending} onClick={begin}>
              {!preview ? 'Commencer' : steps === 0 ? 'Continuer' : `Commencer (${count(steps, 'fiche', 'fiches')})`}
            </Button>
          </Group>
        </Stack>
      </Modal>
    );
  }

  if (state.stage === 'end') return <EndScreen state={state} discipline={discipline} lines={lines} ops={ops} ageBands={ageBands} weightClasses={weightClasses} mobile={!!mobile} onClose={onClose} toggle={(fighterId) => dispatch({ type: 'toggleAbsent', fighterId })} />;

  const view = stepView(state, { lines, discipline, multipleCombats, mode, weightClasses });
  const index = state.index;
  const progress = { index, total: state.plan.steps.length };
  const previous = state.index > 0 ? () => dispatch({ type: 'previous' }) : null;

  if (view.kind === 'homonym') {
    const ageOf = (code: string | null) => ageBands.find((b) => b.code === code)?.label ?? code ?? '—';
    return (
      <Modal opened onClose={() => onClose()} fullScreen={mobile} title="Plusieurs fiches portent ce nom : laquelle ?">
        <Stack data-testid="ffk-homonym">
          <FfkProgress {...progress} />
          <Text size="sm">La FFK inscrit « {view.ffk.fullName} » ({SEX_LABELS[view.ffk.sex].toLowerCase()}, {view.ffk.raw.age}).</Text>
          {view.candidates.map((l) => (
            <UnstyledButton key={l.fighterId} data-testid="ffk-homonym-choice" onClick={() => dispatch({ type: 'resolve', fighterId: l.fighterId })}>
              <Paper withBorder p="sm" radius="md">
                <Text fw={700}>{fighterName(l)}</Text>
                <Text size="sm" c="dimmed">{ageOf(l.line.ageBandCode)} · {listFr(disciplinesOf(l.line).map(disciplineLabel))}</Text>
              </Paper>
            </UnstyledButton>
          ))}
          <Group justify="space-between">
            <Button variant="subtle" data-testid="ffk-homonym-new" onClick={() => dispatch({ type: 'resolve', fighterId: null })}>C’est un autre combattant</Button>
            {previous && <Button variant="default" onClick={previous}>← Précédent</Button>}
          </Group>
        </Stack>
      </Modal>
    );
  }

  return (
    <ClubLineForm
      // Remontée à chaque étape, et quand la fiche relue a changé (409 : comparaison recalculée sur la nouvelle version).
      key={`${state.round}:${view.line?.version ?? 'new'}`}
      ops={ops} mode={mode} multipleCombats={multipleCombats} line={view.line} ageBands={ageBands} weightClasses={weightClasses} closed={closed} opened
      onClose={(message) => {
        // Un refus (fiche changée ou supprimée ailleurs, page fermée…) : la liste est rechargée, la même fiche est relue.
        if (message) {
          notifications.show({ color: 'orange', message });
          dispatch({ type: 'stale' });
        } else onClose();
      }}
      ffk={{
        ...view.ffk, progress, onPrevious: previous,
        onSkip: () => dispatch({ type: 'skipped', index }),
        // Sans ligne : fiche verrouillée passée avec « Suivant → », rien n'a été écrit ; fiche réenregistrée sans changement
        // (« Votre fiche » partout, champs gardés par le verrou) : laissée telle quelle. `index` : l'étape de ce rendu, même si
        // la réponse arrive plus tard.
        onSaved: (message, saved) => {
          if (message) notifications.show({ color: 'orange', message });
          const changed = saved && !(view.line && sameSaved(view.line, saved));
          dispatch(changed ? { type: 'saved', index, line: saved, created: view.line === null } : { type: 'skipped', index });
        },
      }} />
  );
}

/** Fin : récapitulatif, absents du PDF (cases décochées), « Terminer » applique les retraits cochés. */
function EndScreen({ state, discipline, lines, ops, ageBands, weightClasses, mobile, onClose, toggle }: {
  state: Extract<WizardState, { stage: 'end' }>;
  ageBands: ClubEntryView['ageBands'];
  weightClasses: ClubEntryView['weightClasses'];
  discipline: DisciplineId;
  lines: ClubLine[];
  ops: LineOps;
  mobile: boolean;
  onClose: (message?: string) => void;
  toggle: (fighterId: string) => void;
}) {
  const [finishing, setFinishing] = useState(false);
  // Fenêtre fermée pendant « Terminer » : les retraits suivants ne sont pas faits.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true; // remonté (mode strict)
    return () => { mounted.current = false; };
  }, []);
  const sum = wizardSummary(state);
  const rows = absentRows(state.plan, lines, discipline);
  const name = disciplineLabel(discipline).toLowerCase();
  // « Pupilles · -30 kg · aussi en Shido-boxing » ; sans autre discipline, cocher supprime la fiche.
  const describe = (l: ClubLine, others: DisciplineId[]) => {
    const age = ageBands.find((b) => b.code === l.line.ageBandCode)?.label;
    const weight = weightClasses.find((w) => w.id === l.line.weightClassId)?.label;
    const rest = others.length ? `aussi en ${listFr(others.map(disciplineLabel))}` : `seulement en ${name} : cocher supprime sa fiche`;
    return [age, weight ? `${weight} kg` : null, rest].filter(Boolean).join(' · ');
  };

  const finish = async () => {
    setFinishing(true);
    const removed = { withdrawn: 0, deleted: 0 };
    const failed: string[] = [];
    // Page close, lien remplacé… : inutile d'essayer les suivants, la page est rechargée.
    let stopped: string | null = null;
    for (const { line: l } of rows.filter((r) => r.checkable && state.remove.includes(r.line.fighterId))) {
      if (!mounted.current) return;
      if (!hasDiscipline(l.line, discipline)) continue;
      const next = withoutDiscipline(l.line, discipline);
      try {
        if (next) {
          await ops.save({ fighterId: l.fighterId, line: next, version: l.version, publicNameHidden: l.publicNameHidden });
          removed.withdrawn++;
        } else {
          await ops.remove({ fighterId: l.fighterId, version: l.version });
          removed.deleted++;
        }
      } catch (e) {
        if (e instanceof ApiError && RELOAD_STATUSES.has(e.status) && e.status !== 409) {
          stopped = e.message;
          break;
        }
        failed.push(`${fighterName(l)} (${e instanceof Error ? e.message : 'erreur'})`);
      }
    }
    if (!mounted.current) return;
    setFinishing(false);
    if (stopped) {
      notifications.show({ color: 'orange', message: stopped });
      return onClose();
    }
    if (failed.length) notifications.show({ color: 'orange', message: `${disciplineLabel(discipline)} non retiré : ${failed.join(', ')}.` });
    onClose(summaryText(sum, removed, discipline));
  };

  return (
    <Modal opened onClose={() => onClose()} fullScreen={mobile} title="Importer le PDF de la FFK">
      <Stack data-testid="ffk-end">
        <Title order={3} fz="md">Terminé</Title>
        <Text data-testid="ffk-summary">
          <b>{sum.added}</b> {sum.added <= 1 ? 'ajouté' : 'ajoutés'}{sum.notAdded > 0 && <> · <b>{sum.notAdded}</b> {sum.notAdded <= 1 ? 'non ajouté' : 'non ajoutés'}</>} · <b>{sum.updated}</b> mis à jour · <b>{sum.left}</b> {sum.left <= 1 ? 'laissé tel quel' : 'laissés tels quels'}
        </Text>
        {rows.length > 0 && (
          <Paper withBorder p="sm" radius="md" data-testid="ffk-absents">
            <Stack gap="sm">
              <div>
                <Text fw={700}>Inscrits en {name} chez nous, absents du PDF</Text>
                <Text size="sm" c="dimmed" mt={2}>Normal s’ils ne sont pas inscrits à la FFK en {name}. Cochez seulement ceux qui ne viendront pas en {name}.</Text>
              </div>
              {rows.map(({ line: l, checkable, others }) => checkable ? (
                <Checkbox key={l.fighterId} data-testid="ffk-absent" label={fighterName(l)} description={describe(l, others)}
                  checked={state.remove.includes(l.fighterId)} onChange={() => toggle(l.fighterId)} />
              ) : (
                <Box key={l.fighterId} data-testid="ffk-absent-locked">
                  <Text size="sm">{fighterName(l)}</Text>
                  <Text size="xs" c="dimmed">Verrouillé{l.reason ? ` : ${l.reason}` : ''}</Text>
                </Box>
              ))}
            </Stack>
          </Paper>
        )}
        <Group justify="flex-end">
          <Button data-testid="ffk-finish" loading={finishing || ops.pending} onClick={finish}>Terminer</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
