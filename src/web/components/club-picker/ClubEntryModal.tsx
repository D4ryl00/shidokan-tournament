import { Button, Group, Modal, Stack, Textarea, TextInput } from '@mantine/core';
import { useState } from 'react';
import type { DirectoryInput } from '../../../domain/registration.js';
import { ApiErrorAlert } from '../ApiErrorAlert.js';
import { EmailsInput } from '../EmailsInput.js';

const EMPTY: DirectoryInput = { name: '', affiliationNumber: null, coachName: null, coachPhone: null, coachEmails: [], notes: null };
const orNull = (v: string | null) => v?.trim() || null;
/** Texte gardé tel que tapé pendant la saisie (un `trim` à chaque touche mangerait l'espace qu'on vient de taper) ; nettoyé à l'enregistrement. */
const typed = (v: string) => v || null;
const cleaned = (f: DirectoryInput): DirectoryInput =>
  ({ ...f, name: f.name.trim(), affiliationNumber: orNull(f.affiliationNumber), coachName: orNull(f.coachName), coachPhone: orNull(f.coachPhone), notes: orNull(f.notes) });

/**
 * Fenêtre de saisie d'un club (fiche d'annuaire) : « Ajouter un club » ou « Modifier le club », la même partout.
 * Le formulaire part de `initial` à chaque montage : le parent remonte la fenêtre (key) pour chaque ouverture.
 * `onSubmit` enregistre ; la fenêtre se ferme s'il réussit, un refus reste affiché dans la fenêtre.
 */
export function ClubEntryModal({ opened, title, initial, onSubmit, onClose }: {
  opened: boolean;
  title: 'Ajouter un club' | 'Modifier le club';
  initial?: Partial<DirectoryInput>;
  onSubmit: (input: DirectoryInput) => Promise<unknown>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<DirectoryInput>({ ...EMPTY, ...initial });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const set = (patch: Partial<DirectoryInput>) => setForm((f) => ({ ...f, ...patch }));
  // Fermée (Annuaire, croix) pendant l'enregistrement, la fenêtre peut être remontée : `onSubmit` reste la promesse du parent, qui fait la suite.
  const save = () => {
    setPending(true);
    setError(null);
    onSubmit(cleaned(form)).then(
      () => { setPending(false); onClose(); },
      (e: unknown) => { setPending(false); setError(e); },
    );
  };
  return (
    <Modal opened={opened} onClose={onClose} title={title}>
      <Stack>
        <TextInput data-testid="directory-name" label="Nom" required value={form.name} onChange={(e) => set({ name: e.currentTarget.value })} />
        <TextInput data-testid="directory-number" label="N° d’affiliation FFK" description="Les chiffres en tête du club dans l’export FFK."
          value={form.affiliationNumber ?? ''} onChange={(e) => set({ affiliationNumber: typed(e.currentTarget.value) })} />
        <TextInput label="Coach" value={form.coachName ?? ''} onChange={(e) => set({ coachName: typed(e.currentTarget.value) })} />
        <TextInput label="Téléphone" value={form.coachPhone ?? ''} onChange={(e) => set({ coachPhone: typed(e.currentTarget.value) })} />
        <EmailsInput data-testid="directory-email" value={form.coachEmails} onChange={(coachEmails) => set({ coachEmails })} />
        <Textarea label="Notes" autosize minRows={2} value={form.notes ?? ''} onChange={(e) => set({ notes: typed(e.currentTarget.value) })} />
        <ApiErrorAlert error={error} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>Annuler</Button>
          <Button data-testid="directory-save" onClick={save} loading={pending} disabled={!form.name.trim()}>
            Enregistrer
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
