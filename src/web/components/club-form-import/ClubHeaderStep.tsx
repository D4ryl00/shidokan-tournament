import { Alert, Button, Checkbox, Group, Input, Modal, Stack, Text, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useState, type FormEvent } from 'react';
import { clubHeaderDiff } from '../../../domain/club-form-plan.js';
import type { ClubFormReadHeader } from '../../../domain/club-form-read.js';
import type { Club } from '../../../domain/registration.js';
import { ApiError, fetchClub, useWriteClubFormHeader, type ClubFormHeaderValues } from '../../api.js';
import { ApiErrorAlert } from '../ApiErrorAlert.js';
import { FfkChoice } from '../club-line/FfkChoice.js';
import { FfkProgress } from '../club-line/FfkProgress.js';
import { OneOf } from '../PaperEntryTable.js';

const TITLES = { ffk: 'Fiche renvoyée', fiche: 'Enregistré' };
const YES_NO: ['yes' | 'no', string][] = [['yes', 'Oui'], ['no', 'Non']];
const valuesOf = (c: Club): ClubFormHeaderValues => ({ coachName: c.coachName, coachPhone: c.coachPhone, coachEmails: c.coachEmails, preApproval: c.preApproval });
const blankToNull = (v: string) => v.trim() || null;

/**
 * Première étape d'une fiche renvoyée dont l'en-tête diffère du club : ce qu'on garde est écrit dans le club et dans sa fiche
 * d'annuaire. Comparée à `club` tel qu'il est au montage (`expected` de l'écriture) ; remontée après un refus (club changé).
 */
export function ClubHeaderStep({ competitionId, club, header, progress, mobile, onDone, onStale, onClose }: {
  competitionId: string;
  club: Club;
  header: ClubFormReadHeader;
  progress: { index: number; total: number };
  mobile: boolean;
  /** Enregistré ou « Laisser tel quel » : étape suivante. */
  onDone: () => void;
  /** Le club a changé entre-temps : l'étape est à refaire sur le club relu. */
  onStale: (fresh: Club) => void;
  onClose: () => void;
}) {
  // Le club comparé : celui du montage, même si la liste des clubs est rechargée pendant l'étape.
  const [shown] = useState(() => valuesOf(club));
  const [diff] = useState(() => clubHeaderDiff(header, shown));
  const [coach, setCoach] = useState(diff.coachName?.fiche ?? shown.coachName ?? '');
  const [phone, setPhone] = useState(diff.coachPhone?.fiche ?? shown.coachPhone ?? '');
  const [added, setAdded] = useState<string[]>(diff.newEmails);
  const [preApproval, setPreApproval] = useState(diff.preApproval?.fiche ?? shown.preApproval);
  const write = useWriteClubFormHeader(competitionId, club.id);

  const save = (e?: FormEvent) => {
    e?.preventDefault();
    const values: ClubFormHeaderValues = {
      coachName: blankToNull(coach),
      coachPhone: blankToNull(phone),
      coachEmails: [...shown.coachEmails, ...diff.newEmails.filter((a) => added.includes(a))],
      preApproval,
    };
    write.mutateAsync({ values, expected: shown }).then(onDone, async (error: unknown) => {
      if (!(error instanceof ApiError && error.code === 'STALE_CLUB_HEADER')) return;
      notifications.show({ color: 'orange', message: error.message });
      // Relu sur le serveur : la comparaison se refait sur le club tel qu'il est devenu.
      const fresh = await fetchClub(competitionId, club.id).catch(() => undefined);
      if (fresh) onStale(fresh);
    });
  };

  // Champ texte : les deux cases s'il diffère, « Identique » si la fiche donne la même valeur, rien si elle est vide.
  const textField = (label: string, testId: string, value: string, set: (v: string) => void, d: typeof diff.coachName, given: string | null) => (
    <Stack gap={4}>
      <TextInput label={label} data-testid={testId} value={value} onChange={(e) => set(e.currentTarget.value)} />
      {d ? (
        <FfkChoice label={label} titles={TITLES} ffk={d.fiche} fiche={d.saved?.trim() || '—'}
          state={value.trim() === d.fiche ? 'ffk' : value.trim() === (d.saved?.trim() ?? '') ? 'fiche' : null}
          onPick={(which) => set(which === 'ffk' ? d.fiche : (d.saved ?? ''))} />
      ) : given?.trim() ? <Text size="xs" c="dimmed">Identique à l’enregistré.</Text> : null}
    </Stack>
  );

  return (
    <Modal opened onClose={onClose} fullScreen={mobile} title={`${club.name} : coordonnées`}>
      <form onSubmit={save}>
        <Stack data-testid="club-header-step">
          <FfkProgress {...progress} />
          <Alert color="blue"><b>La fiche renvoyée donne d’autres coordonnées.</b> Ce que vous gardez ici est écrit dans le club et dans l’annuaire.</Alert>
          {textField('Coach', 'club-header-coach', coach, setCoach, diff.coachName, header.coachName)}
          {textField('Téléphone', 'club-header-phone', phone, setPhone, diff.coachPhone, header.coachPhone)}
          {(shown.coachEmails.length > 0 || diff.newEmails.length > 0) && (
            <Input.Wrapper label="E-mails" labelElement="div">
              <Stack gap={6} mt={4}>
                <Text size="sm" c="dimmed">Enregistré : {shown.coachEmails.length ? shown.coachEmails.join(', ') : 'aucune adresse'}</Text>
                {diff.newEmails.map((a) => (
                  <Checkbox key={a} data-testid="club-header-email" label={`Ajouter ${a}`} description="Nouvelle, dans la fiche." checked={added.includes(a)}
                    onChange={(e) => {
                      const on = e.currentTarget.checked;
                      setAdded((list) => (on ? [...list, a] : list.filter((x) => x !== a)));
                    }} />
                ))}
              </Stack>
            </Input.Wrapper>
          )}
          <Input.Wrapper label="Pré-accord du coach" labelElement="div" role="group" aria-label="Pré-accord du coach">
            <Stack gap={4} mt={4}>
              {/* Oui ou Non : un second clic ne vide pas le choix. */}
              <OneOf value={preApproval ? 'yes' : 'no'} options={YES_NO} onChange={(v) => v && setPreApproval(v === 'yes')} />
              {diff.preApproval && (
                <FfkChoice label="Pré-accord du coach" titles={TITLES} ffk={diff.preApproval.fiche ? 'Oui' : 'Non'} fiche={diff.preApproval.saved ? 'Oui' : 'Non'}
                  state={preApproval === diff.preApproval.fiche ? 'ffk' : 'fiche'}
                  onPick={(which) => setPreApproval(which === 'ffk' ? diff.preApproval!.fiche : diff.preApproval!.saved)} />
              )}
              <Text size="xs" c="dimmed">Le pré-accord ne vaut que pour cette compétition (il n’est pas dans l’annuaire).</Text>
            </Stack>
          </Input.Wrapper>
          <ApiErrorAlert error={write.error?.code === 'STALE_CLUB_HEADER' ? null : write.error} />
          <Group justify="space-between">
            <Button variant="subtle" color="gray" data-testid="club-header-skip" disabled={write.isPending} onClick={onDone}>Laisser tel quel</Button>
            <Button type="submit" data-testid="club-header-save" loading={write.isPending}>Enregistrer · suivant →</Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
