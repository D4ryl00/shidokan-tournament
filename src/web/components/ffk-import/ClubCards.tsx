import { Button, Group, Paper, Stack, Text, TextInput } from '@mantine/core';
import { useState } from 'react';
import type { ClubLink } from '../../../domain/ffk-plan/clubs.js';
import { plural } from '../../../domain/plural.js';
import type { Club, DirectoryInput } from '../../../domain/registration.js';
import { useClubs, useCreateCompetitionClub } from '../../api.js';
import { ClubEntryModal } from '../club-picker/ClubEntryModal.js';
import { StatusBadge } from '../ui/StatusBadge.js';
import { ChoiceOption } from './ChoiceOption.js';
import { searchByName, searchReady } from './search.js';

/**
 * 2. Clubs de l’export : une carte par club, à relier à un club de la compétition. Seul un lien sûr est fait d’office (carte repliée,
 * « Modifier » l’ouvre) ; sinon le club démarre sur « Ne pas relier pour l’instant ». « ➕ Créer un club… » ouvre la fenêtre
 * « Ajouter un club » de l’annuaire, pré-remplie : le club est créé tout de suite, puis relié.
 */
export function ClubCards({ competitionId, links, choices, onLink }: {
  competitionId: string;
  links: ClubLink[];
  /** `choices.clubLinks` : l’option cochée suit le clic sans attendre l’aperçu. */
  choices: Record<string, string | 'none'> | undefined;
  onLink: (clubEntity: string, target: string | 'none') => void;
}) {
  const { data: clubs = [] } = useClubs(competitionId);
  const create = useCreateCompetitionClub(competitionId);
  /** Clubs créés depuis cette page (« Club créé : … »). */
  const [created, setCreated] = useState<ReadonlySet<string>>(new Set());
  const [adding, setAdding] = useState<ClubLink | null>(null);
  const [opens, setOpens] = useState(0); // remonte la fenêtre à chaque ouverture : le formulaire repart du club de l’export

  const add = (link: ClubLink) => (input: DirectoryInput) =>
    create.mutateAsync(input).then((club) => {
      setCreated((s) => new Set(s).add(club.id));
      onLink(link.clubEntity, club.id);
      return club;
    });

  if (links.length === 0) return <Text size="sm" c="dimmed">Aucun club dans l’export.</Text>;
  return (
    <Stack gap="sm">
      {links.map((link) => {
        const choice = choices?.[link.clubEntity];
        const target = choice === undefined ? link.target : choice === 'none' ? null : choice;
        return (
          <ClubCard key={link.clubEntity} link={link} target={target} clubs={clubs} created={created}
            onLink={(t) => onLink(link.clubEntity, t)} onCreate={() => { setOpens((n) => n + 1); setAdding(link); }} />
        );
      })}
      <ClubEntryModal key={opens} opened={adding !== null} title="Ajouter un club" onClose={() => setAdding(null)}
        initial={adding ? { name: adding.clubName, affiliationNumber: adding.affiliationNumber } : undefined}
        onSubmit={adding ? add(adding) : () => Promise.reject(new Error('Aucun club à créer'))} />
    </Stack>
  );
}

function ClubCard({ link, target, clubs, created, onLink, onCreate }: {
  link: ClubLink;
  /** Club relié (choix en cours, sinon celui de l’aperçu) ; `null` = pas relié. */
  target: string | null;
  clubs: Club[];
  created: ReadonlySet<string>;
  onLink: (target: string | 'none') => void;
  onCreate: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const { proposal } = link;
  const sure = proposal?.certainty === 'sure';
  const targetName = target ? (clubs.find((c) => c.id === target)?.name ?? (target === proposal?.clubId ? proposal.name : '…')) : null;
  const status = !target
    ? (proposal?.certainty === 'doubtful' ? 'À vérifier' : sure ? 'Pas relié' : 'Nouveau')
    : created.has(target) ? 'Créé' : sure && target === proposal?.clubId ? 'Sûr' : 'Relié';
  // Un club sûr reste replié (relié d’office) ; un club qu’on vient de créer reste ouvert sur « Club créé ».
  const folded = sure && !open && !(target && created.has(target));
  const pick = (t: string | 'none') => {
    onLink(t);
    setQuery('');
  };
  const results = searchByName(clubs, query, (c) => c.name);

  return (
    <Paper withBorder p="sm" radius="md" data-testid="ffk-club" data-linked={target ? 'true' : 'false'}
      style={{
        backgroundColor: 'var(--sk-bg)',
        borderColor: target ? undefined : 'var(--mantine-color-orange-6)',
        boxShadow: `inset 3px 0 0 ${target ? 'var(--mantine-color-green-6)' : 'var(--mantine-color-orange-6)'}`,
      }}>
      <Stack gap="xs">
        <Group justify="space-between" align="flex-start" wrap="nowrap" gap="sm">
          <div style={{ minWidth: 0 }}>
            <Text fw={700} style={{ overflowWrap: 'anywhere' }}>{link.clubEntity}</Text>
            <Text size="sm" c="dimmed">{plural(link.rows, 'combattant')} dans l’export{targetName ? ` · → ${targetName}` : ''}</Text>
          </div>
          <StatusBadge tone={target ? 'ok' : 'warn'} data-testid="ffk-club-status">{status}</StatusBadge>
        </Group>
        {link.warning && <Text size="sm" c="orange">{link.warning}</Text>}
        {folded ? (
          <Group justify="space-between" gap="xs">
            <Text size="sm" c="dimmed">
              {target === proposal?.clubId ? 'Relié d’office.' : target ? `Relié à ${targetName}.` : 'Pas relié pour l’instant.'}
            </Text>
            <Button variant="subtle" size="compact-sm" onClick={() => setOpen(true)}>Modifier</Button>
          </Group>
        ) : (
          <>
            <Stack gap={4} role="radiogroup" aria-label={`Lien du club ${link.clubName}`}>
              {proposal && (
                <ChoiceOption checked={target === proposal.clubId} onClick={() => pick(proposal.clubId)}
                  sub={sure ? 'reconnu d’office' : 'nom proche : à vérifier'}>
                  Relier à <b>{proposal.name}</b>
                </ChoiceOption>
              )}
              {target && target !== proposal?.clubId && (
                <ChoiceOption checked onClick={() => pick(target)}>
                  {created.has(target) ? 'Club créé : ' : 'Relier à '}<b>{targetName}</b>
                </ChoiceOption>
              )}
              <ChoiceOption checked={!target} onClick={() => pick('none')} sub="ses nouveaux combattants sont laissés de côté">
                Ne pas relier pour l’instant
              </ChoiceOption>
            </Stack>
            <Group gap="xs" wrap="wrap">
              <TextInput style={{ flex: '1 1 220px' }} type="search" autoComplete="off" placeholder="Chercher un autre club par son nom…"
                aria-label={`Chercher un club pour ${link.clubName}`} value={query} onChange={(e) => setQuery(e.currentTarget.value)} />
              <Button variant="default" onClick={onCreate}>➕ Créer un club…</Button>
            </Group>
            {searchReady(query) && (
              <Stack gap={4}>
                {results.length
                  ? results.map((c) => (
                    <ChoiceOption key={c.id} checked={target === c.id} onClick={() => pick(c.id)}>Relier à <b>{c.name}</b></ChoiceOption>
                  ))
                  : <Text size="xs" c="dimmed">Aucun club ne contient « {query.trim()} ».</Text>}
              </Stack>
            )}
            {sure && (
              <Group justify="flex-end">
                <Button variant="subtle" size="compact-sm" onClick={() => setOpen(false)}>Replier</Button>
              </Group>
            )}
          </>
        )}
      </Stack>
    </Paper>
  );
}
