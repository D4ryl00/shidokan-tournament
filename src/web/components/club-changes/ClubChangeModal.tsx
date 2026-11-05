import { Button, Checkbox, Group, Modal, Radio, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useEffect, useState, type ReactNode } from 'react';
import { defaultChoice, emailChoices, resolvedValues, type ClubField, type ClubValues, type Side } from '../../../domain/club-changes.js';
import { ApiError, useIgnoreClubChange, useResolveClubChange, type ClubChangeView } from '../../api.js';
import { ApiErrorAlert } from '../ApiErrorAlert.js';

export const LABEL: Record<ClubField, string> = { name: 'Club', coachName: 'Coach', coachPhone: 'Téléphone', coachEmails: 'E-mails', affiliationNumber: 'N° d’affiliation FFK' };
const ORIGIN = { both: 'dans les deux', competition: 'ajoutée dans la compétition', 'competition-only': 'seulement dans la compétition', directory: 'seulement dans l’annuaire' } as const;
/** Une valeur longue (adresse) passe à la ligne au lieu d'élargir la fenêtre. */
const WRAP = { overflowWrap: 'anywhere' } as const;

export const frDate = (iso: string) => new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('fr-FR');

/** Valeur affichée d'un champ ; `(vide)` quand il n'y a rien. */
export function shownValue(value: string | string[] | null): string {
  if (Array.isArray(value)) return value.join(', ') || '(vide)';
  return (value ?? '').trim() || '(vide)';
}
const shown = (field: ClubField, v: ClubValues) => shownValue(v[field]);

interface Props {
  change: ClubChangeView;
  onClose: () => void;
  /** Décision prise (enregistrée ou ignorée), après la relecture des listes. */
  onDone: () => void;
  /** Le serveur dit que la fiche ou le changement a bougé : message à garder affiché, la liste est relue. */
  onStale?: (message: string) => void;
  notice?: string | null;
}

/**
 * Comparaison d'un club de compétition avec sa fiche d'annuaire : l'organisateur garde, champ par champ, la valeur de l'annuaire ou de la
 * compétition. Le parent la remonte (key) pour chaque changement : l'état part du changement ouvert.
 */
export function ClubChangeModal({ change, onClose, onDone, onStale, notice }: Props) {
  const resolve = useResolveClubChange();
  const ignore = useIgnoreClubChange();
  const [choices, setChoices] = useState<Partial<Record<ClubField, Side>>>({});
  const mailOptions = emailChoices(change.directory.coachEmails, change.values.coachEmails, change.changedFields, change.addedEmails);
  const [kept, setKept] = useState<Set<string>>(new Set(mailOptions.filter((m) => m.checked).map((m) => m.email)));
  const canApply = change.upcoming && change.managedHere;
  const [applyToClub, setApplyToClub] = useState(true);
  const differs = (f: ClubField) => change.fields.includes(f);
  const side = (f: ClubField) => choices[f] ?? defaultChoice(f, change.values, change.changedFields);
  // Adresses identiques : la liste de la fiche, avec son ordre et son adresse principale, est renvoyée telle quelle.
  const emails = differs('coachEmails') ? mailOptions.filter((m) => kept.has(m.email)).map((m) => m.email) : change.directory.coachEmails;
  const values = resolvedValues(change.directory, change.values, choices, emails, change.changedFields);

  const error = resolve.error ?? ignore.error;
  // Fiche ou changement modifiés depuis l'ouverture : les listes sont relues (par la décision), le message reste affiché.
  useEffect(() => {
    if (error instanceof ApiError && error.status === 409) onStale?.(error.message);
  }, [error, onStale]);
  const busy = resolve.isPending || ignore.isPending;
  const save = () =>
    resolve.mutate({ clubId: change.clubId, directoryVersion: change.directoryVersion, changedAt: change.changedAt, values, applyToClub: canApply && applyToClub }, { onSuccess: onDone });
  const skip = () => ignore.mutate({ clubId: change.clubId, changedAt: change.changedAt }, { onSuccess: onDone });

  const fields: ReactNode[] = (['name', 'coachName', 'coachPhone', 'coachEmails', 'affiliationNumber'] as const).map((f) => {
    if (!differs(f)) {
      return (
        <Stack key={f} gap={0} data-testid={`change-same-${f}`}>
          <Text size="sm" fw={600}>{LABEL[f]}</Text>
          <Text size="sm" c="dimmed" style={WRAP}>{shown(f, change.values)} (identique)</Text>
        </Stack>
      );
    }
    if (f === 'coachEmails') {
      return (
        <Stack key={f} gap={4} data-testid="change-field-coachEmails">
          <Text size="sm" fw={600}>{LABEL[f]}</Text>
          {mailOptions.length === 0 && <Text size="sm" style={WRAP}>(vide)</Text>}
          {mailOptions.map((m) => (
            <Checkbox key={m.email} size="sm" label={`${m.email} (${ORIGIN[m.origin]})`} checked={kept.has(m.email)} styles={{ label: WRAP }}
              onChange={(e) => setKept((k) => { const n = new Set(k); if (e.currentTarget.checked) n.add(m.email); else n.delete(m.email); return n; })} />
          ))}
          {emails.length === 0 && <Text size="xs" c="dimmed">Aucune adresse cochée : la fiche n’en gardera pas.</Text>}
        </Stack>
      );
    }
    return (
      <Radio.Group key={f} label={LABEL[f]} value={side(f)} onChange={(v) => setChoices((c) => ({ ...c, [f]: v as Side }))} data-testid={`change-field-${f}`}
        styles={{ label: { fontWeight: 600 } }}>
        <Stack gap={4} mt={4}>
          <Radio value="directory" label={`Annuaire : ${shown(f, change.directory)}`} styles={{ label: WRAP }} />
          <Radio value="competition" label={`Compétition : ${shown(f, change.values)}`} styles={{ label: WRAP }} />
        </Stack>
      </Radio.Group>
    );
  });

  return (
    <Modal opened onClose={onClose} size="lg" title={<Text fw={700} style={WRAP}>{change.values.name} : garder quelles informations ?</Text>} styles={{ title: { minWidth: 0 } }}>
      <Stack>
        <Text size="sm" c="dimmed">{change.competitionName}, le {frDate(change.competitionDate)} · modifié le {frDate(change.changedAt)}</Text>
        {fields}
        {change.upcoming && (
          <Stack gap={2}>
            <Checkbox data-testid="change-apply" label={`Appliquer aussi au club dans ${change.competitionName}`} checked={canApply && applyToClub} disabled={!canApply}
              onChange={(e) => setApplyToClub(e.currentTarget.checked)} styles={{ label: WRAP }} />
            {!change.managedHere && <Text size="xs" c="dimmed">Gérée par {change.ownerName ?? 'une autre installation'} : à appliquer après le retour de la main.</Text>}
          </Stack>
        )}
        {notice && <Text size="sm" c="red" data-testid="change-notice">{notice}</Text>}
        <ApiErrorAlert error={error instanceof ApiError && error.status === 409 ? null : error} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose} disabled={busy}>Plus tard</Button>
          <Button variant="default" onClick={skip} loading={ignore.isPending} disabled={resolve.isPending}>Ignorer ce changement</Button>
          <Button data-testid="change-save" onClick={save} loading={resolve.isPending} disabled={ignore.isPending || !values.name.trim()}>Enregistrer dans l’annuaire</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

/** Marqueur : « le suivant » de la liste, après une décision. */
const NEXT = Symbol('suivant');

/**
 * Fenêtre de comparaison d'une page : `open(clubId)` ouvre un changement, `openFirst()` le premier puis, après chaque décision, le suivant.
 * Le changement ouvert est relu dans `changes` : une liste relue le remplace (la fenêtre est remontée, key), et il disparaît s'il n'existe plus.
 */
export function useClubChangeDialog(changes: ClubChangeView[]): { open: (clubId: string) => void; openFirst: () => void; element: ReactNode } {
  const [target, setTarget] = useState<string | typeof NEXT | null>(null);
  const [chain, setChain] = useState(false);
  const [stale, setStale] = useState<string | null>(null);
  const current = target === NEXT ? changes[0] : target ? changes.find((c) => c.clubId === target) : undefined;
  // Changement disparu (décidé ailleurs, rendu identique) : la fenêtre se ferme ; si un refus venait de s'afficher, on le dit autrement.
  useEffect(() => {
    if (target === null || current) return;
    if (stale) notifications.show({ color: 'yellow', message: `${stale} Ce changement n’existe plus.` });
    setStale(null);
    setTarget(null);
  }, [target, current, stale]);
  const close = () => { setTarget(null); setStale(null); };
  const element = current ? (
    <ClubChangeModal key={`${current.clubId}:${current.changedAt}:${current.directoryVersion}`} change={current} notice={stale} onStale={setStale} onClose={close}
      onDone={() => { setStale(null); setTarget(chain ? NEXT : null); }} />
  ) : null;
  return {
    open: (clubId) => { setStale(null); setChain(false); setTarget(clubId); },
    openFirst: () => { setStale(null); setChain(true); setTarget(NEXT); },
    element,
  };
}
