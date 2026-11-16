import { Alert, Button, FocusTrap, Group, Modal, Stack, Text } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { ClubFormLine } from '../../domain/club-form.js';
import type { FfkCardValue } from '../../domain/ffk-plan/values.js';
import { ApiError, RELOAD_STATUSES, type ClubEntryView, type ClubLine, type LineOps } from '../api.js';
import { ApiErrorAlert } from './ApiErrorAlert.js';
import { ClubLineFields } from './ClubLineFields.js';
import type { LineFormContext } from './club-line/lineForm.js';
import { FfkProgress } from './club-line/FfkProgress.js';
import type { FfkFormStep } from './club-line/ffkStep.js';

/** Suite d'un enregistrement : l'avis éventuel du serveur et la ligne enregistrée. */
export type SavedThen = (message?: string, saved?: ClubLine) => void;

export const EMPTY_LINE: ClubFormLine = {
  lastName: '', firstName: '', sex: null, ageBandCode: null, weightClassId: null, weightKg: null, combats: [], kata: false, grade: null, ruleset: null, prefs: {}, shobuKeep: null,
};

/** Fenêtre d'un combattant, pour le coach (page du club) et pour l'organisateur (création : `line` null). */
export function ClubLineForm({ ops, mode, multipleCombats, line, ageBands, weightClasses, closed, opened, onClose, title, footerExtra, onEnter, ffk }: {
  ops: LineOps;
  mode: 'coach' | 'organiser';
  multipleCombats: boolean;
  line: ClubLine | null;
  ageBands: ClubEntryView['ageBands'];
  weightClasses: ClubEntryView['weightClasses'];
  /** Cases fermées (`entryKey`) : ces choix ne sont pas proposés au coach, sauf la valeur déjà enregistrée. */
  closed: string[];
  opened: boolean;
  onClose: (message?: string) => void;
  /** Remplace le titre par défaut. */
  title?: string;
  /**
   * Boutons de plus, à côté de « Enregistrer ». Une fonction reçoit `saveThen` : il enregistre la ligne puis appelle `then`
   * (avec l'avis éventuel du serveur) au lieu de fermer la fenêtre.
   */
  footerExtra?: ReactNode | ((saveThen: (then: SavedThen) => void) => ReactNode);
  /** Touche Entrée dans un champ (hors liste déroulante) : reçoit `saveThen`, comme `footerExtra`. Sans elle, Entrée ne fait rien. */
  onEnter?: (saveThen: (then?: SavedThen) => void) => void;
  /** Mode import du PDF de la FFK : valeurs de départ, comparaison, pied « Enregistrer · suivant → ». Sans lui, rien ne change. */
  ffk?: FfkFormStep;
}) {
  const mobile = useMediaQuery('(max-width: 600px)');
  // Le parent remonte le formulaire (key) pour chaque combattant : l'état part de la ligne ouverte.
  // Le club n'est pas un champ de la fenêtre (`clubId` reste nul) : la ligne est enregistrée dans le club ouvert.
  const [value, setValue] = useState<FfkCardValue>({ line: ffk?.initial ?? line?.line ?? EMPTY_LINE, clubId: null, publicNameHidden: line?.publicNameHidden ?? false });
  const [confirmDelete, setConfirmDelete] = useState(false);
  // L'erreur de `ops` est partagée par toutes les fenêtres (et les étapes de l'import) : seule celle d'un essai fait ici s'affiche.
  const [tried, setTried] = useState(false);

  // Ligne verrouillée (combats commencés…) : elle s'ouvre en lecture seule, avec la raison. L'organisateur y corrige encore
  // le nom, le prénom, le grade, le nom masqué et les disciplines qui n'ont pas commencé (`partly`) ; sans combat commencé
  // (kata seul), aussi le poids, le règlement et le reclassement.
  const locked = !!line && !line.editable;
  const partly = locked && !!line?.partlyEditable;
  const frozen = locked && !partly;
  const lastNameRef = useRef<HTMLInputElement>(null);
  // Fenêtre remontée à vide (« Enregistrer et ajouter un autre ») : le curseur revient sur le nom.
  useEffect(() => {
    // Import FFK : fiches préremplies, pas de curseur (le clavier du téléphone masquerait le formulaire).
    if (opened && !line && !ffk) lastNameRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- au montage seulement
  }, []);
  const saved = line?.line ?? null;
  // L'organisateur coche plusieurs combats même si le réglage ne le prévoit pas (un avis le rappelle).
  const ctx: LineFormContext = { mode, multipleCombats: multipleCombats || mode === 'organiser', closed: new Set(closed), ageBands, weightClasses, saved };
  // Un refus parce que la ligne a changé ou disparu entre-temps (ou que les inscriptions sont closes) ferme le formulaire : la liste est rechargée.
  const onError = (e: unknown) => {
    if (e instanceof ApiError && RELOAD_STATUSES.has(e.status)) onClose(e.message);
  };
  const submit = (then: SavedThen = onClose) => {
    setTried(true);
    return ops.save({ fighterId: line?.fighterId ?? null, line: value.line, version: line?.version ?? null, publicNameHidden: value.publicNameHidden })
      // L'organisateur peut choisir une catégorie fermée : le serveur l'enregistre avec un avis, qu'on lui montre.
      .then((done) => then(mode === 'organiser' && done.notices.length ? done.notices.join(' ') : undefined, done), onError);
  };
  // Entrée dans un champ : pas dans une liste déroulante (elle choisit), ni sur un bouton (il se clique), ni pendant une saisie IME.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Enter' || (!onEnter && !ffk) || ops.pending || e.nativeEvent.isComposing || (frozen && !ffk)) return;
    const target = e.target as HTMLElement;
    if (target.closest('button, select, textarea, [aria-haspopup], [role="combobox"], [role="option"]')) return;
    e.preventDefault();
    if (ffk) {
      if (frozen) ffk.onSaved();
      else submit(ffk.onSaved);
    } else onEnter!(submit);
  };
  const doDelete = () => line && (setTried(true), ops.remove({ fighterId: line.fighterId, version: line.version }).then(() => onClose(), onError));

  return (
    <Modal opened={opened} onClose={() => onClose()} fullScreen={mobile} title={title ?? (ffk ? (line ? `${line.line.lastName.toUpperCase()} ${line.line.firstName}` : 'Nouveau combattant') : line ? `${line.line.lastName} ${line.line.firstName}` : 'Ajouter un combattant')}>
      <Stack data-testid="club-line-form" onKeyDown={onKeyDown}>
        {/* Import FFK : le piège à focus de la fenêtre prend cet élément caché (ni champ ni clavier) au lieu du premier champ. */}
        {ffk && <FocusTrap.InitialFocus />}
        {ffk && <FfkProgress {...ffk.progress} />}
        {ffk?.notes && (
          <Alert color="yellow" data-testid="import-notes">
            <Stack gap={4}><Text fw={700} size="sm">{ffk.notes.title}</Text>{ffk.notes.lines.map((l, i) => <Text key={i} size="sm">{l}</Text>)}</Stack>
          </Alert>
        )}
        {ffk?.banner && <Alert color="blue" data-testid="ffk-banner"><BannerText text={ffk.banner} /></Alert>}
        {locked && line && <Alert color="orange" data-testid="line-locked">{line.reason ?? 'Cette ligne n’est pas modifiable.'}</Alert>}
        {/* Avant d'enregistrer : inscriptions qui ne tiennent pas sur la ligne, catégorie non ouverte… */}
        {!frozen && line && line.notices.length > 0 && (
          <Alert color="yellow" data-testid="line-notices"><Stack gap={4}>{line.notices.map((n) => <Text key={n} size="sm">{n}</Text>)}</Stack></Alert>
        )}
        <ClubLineFields value={value} onChange={setValue} ctx={ctx} diffs={ffk?.diffs ?? []} showLicenceHint={!!line?.line.licence} oneCombatPerDay={!multipleCombats}
          disabled={locked ? { locked, partly, started: line!.startedDisciplines } : undefined} step={ffk} lastNameRef={lastNameRef} autoFocus={!line && !ffk} />
        <ApiErrorAlert error={tried ? ops.error : null} />
        {ffk ? (
          <Group justify="space-between">
            {ffk.skipLabel ? <Button variant="subtle" color="gray" data-testid="ffk-skip" disabled={ops.pending} onClick={ffk.onSkip}>{ffk.skipLabel}</Button> : <span />}
            <Group gap="xs">
              {ffk.onPrevious && <Button variant="default" data-testid="ffk-previous" disabled={ops.pending} onClick={ffk.onPrevious}>← Précédent</Button>}
              {frozen
                ? <Button data-testid="line-save" onClick={() => ffk.onSaved()}>Suivant →</Button>
                : <Button data-testid="line-save" loading={ops.pending} onClick={() => submit(ffk.onSaved)}>Enregistrer · suivant →</Button>}
            </Group>
          </Group>
        ) : <Group justify="space-between">
          {line && !locked ? (
            confirmDelete ? (
              <Group gap="xs">
                <Button color="red" data-testid="line-delete-confirm" loading={ops.pending} onClick={doDelete}>Confirmer la suppression</Button>
                <Button variant="subtle" onClick={() => setConfirmDelete(false)}>Garder</Button>
              </Group>
            ) : (
              <Button variant="subtle" color="red" data-testid="line-delete" onClick={() => setConfirmDelete(true)}>Supprimer</Button>
            )
          ) : <span />}
          <Group gap="xs">
            <Button variant="default" onClick={() => onClose()}>{frozen ? 'Fermer' : 'Annuler'}</Button>
            {!locked && (typeof footerExtra === 'function' ? footerExtra(submit) : footerExtra)}
            {!frozen && <Button data-testid="line-save" loading={ops.pending} onClick={() => submit()}>Enregistrer</Button>}
          </Group>
        </Group>}
      </Stack>
    </Modal>
  );
}

/** Encadré de l'import : sa première phrase (« Fiche déjà créée. ») en gras. */
function BannerText({ text }: { text: string }) {
  const end = text.indexOf('. ');
  if (end < 0) return <>{text}</>;
  return <><b>{text.slice(0, end + 1)}</b>{text.slice(end + 1)}</>;
}
