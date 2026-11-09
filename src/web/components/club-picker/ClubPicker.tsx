import { Button, Group, Select } from '@mantine/core';
import { useState } from 'react';
import type { Club, DirectoryInput } from '../../../domain/registration.js';
import { useClubs, useCreateCompetitionClub, useDirectoryClubs } from '../../api.js';
import { ClubEntryModal } from './ClubEntryModal.js';
import { choiceKey, parseChoice, type ClubChoice } from './choice.js';

/**
 * Choix d'un club de la compétition : ses clubs, puis les fiches de l'annuaire qui n'y sont pas encore.
 * Choisir n'écrit rien (le club d'une fiche se crée à l'enregistrement, voir `useResolveClub`) ; seule la fenêtre
 * « Ajouter un club » crée tout de suite la fiche et le club, puis le choisit.
 */
export function ClubPicker({ competitionId, value, onChange, prefill, label = 'Club' }: {
  competitionId: string;
  value: ClubChoice | null;
  /** `club` : le club de la compétition quand le choix en est un (pour lire `preApproval`), `null` pour une fiche de l'annuaire. */
  onChange: (choice: ClubChoice | null, club: Club | null) => void;
  prefill?: Partial<DirectoryInput>;
  label?: string;
}) {
  const { data: clubs = [] } = useClubs(competitionId);
  const { data: directory = [] } = useDirectoryClubs(competitionId);
  const create = useCreateCompetitionClub(competitionId);
  const [opens, setOpens] = useState(0); // remonte la fenêtre à chaque ouverture : le formulaire repart de `prefill`
  const [adding, setAdding] = useState(false);
  const data = [
    { group: 'Clubs de la compétition', items: clubs.map((c) => ({ value: choiceKey({ kind: 'club', id: c.id }), label: c.name })) },
    { group: 'Annuaire', items: directory.map((d) => ({ value: choiceKey({ kind: 'directory', id: d.id }), label: d.name })) },
  ].filter((g) => g.items.length > 0);
  const change = (key: string | null) => {
    const choice = key ? parseChoice(key) : null;
    onChange(choice, choice?.kind === 'club' ? (clubs.find((c) => c.id === choice.id) ?? null) : null);
  };
  return (
    <>
      <Group align="flex-end" gap="xs" wrap="nowrap" data-testid="club-picker">
        <Select style={{ flex: 1 }} label={label} searchable clearable placeholder="Choisir un club" nothingFoundMessage="Aucun club" data={data}
          value={value ? choiceKey(value) : null} onChange={change} />
        <Button data-testid="club-picker-new" variant="default" onClick={() => { setOpens((n) => n + 1); setAdding(true); }}>Ajouter un club</Button>
      </Group>
      <ClubEntryModal key={opens} opened={adding} title="Ajouter un club" initial={prefill} onClose={() => setAdding(false)}
        onSubmit={(input) => create.mutateAsync(input).then((club) => onChange({ kind: 'club', id: club.id }, club))} />
    </>
  );
}
