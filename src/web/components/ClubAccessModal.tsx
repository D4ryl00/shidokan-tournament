import { Box, Button, CopyButton, Group, Loader, Modal, Paper, Stack, Text } from '@mantine/core';
import { useState } from 'react';
import { useClubAccesses, useCreateClubAccess, useDeleteClubAccess, useRevokeInvitation, type ClubAccess, type ClubInvitationRow } from '../api.js';
import { ofName } from '../../domain/plural.js';
import { accessTimes } from '../access-labels.js';
import { ApiErrorAlert } from './ApiErrorAlert.js';
import { StatusBadge } from './ui/StatusBadge.js';
import { IconPlus, IconTrash } from './ui/icons.js';

const date = (iso: string) => new Date(iso).toLocaleDateString('fr-FR');

const SENT: Record<'mail' | 'messagerie' | 'none', { badge: string; tone: 'ok' | 'neutral'; fact: string }> = {
  mail: { badge: 'Envoyé par mail', tone: 'ok', fact: 'Envoyé le' },
  messagerie: { badge: 'Préparé dans ma messagerie', tone: 'neutral', fact: 'Préparé le' },
  none: { badge: 'Jamais envoyé', tone: 'neutral', fact: '' },
};

/** Un fait de la carte : libellé discret et date en gras, ou mention en italique quand il n'y a rien. */
const Fact = ({ label, at, none }: { label: string; at: string | null; none: string }) =>
  at ? <Text size="sm" c="var(--sk-soft)">{label} <Text span fw={600} c="var(--sk-text)" className="num">{date(at)}</Text></Text>
    : <Text size="sm" c="dimmed" fs="italic">{none}</Text>;

/** Carte d'un lien : quand il a été créé, envoyé, visité ; « Supprimer » demande confirmation dans la carte. */
function AccessCard({ access, time, isNew, deleting, onDelete }: { access: ClubAccess; time: string; isNew: boolean; deleting: boolean; onDelete: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const sent = SENT[access.sentVia ?? 'none'];
  return (
    <Paper withBorder radius="md" px="md" py="sm" bg="var(--sk-row)" data-testid="club-access">
      <Group justify="space-between" wrap="nowrap" gap="md">
        <Stack gap={4} style={{ minWidth: 0 }}>
          <Group gap="xs">
            <Text fw={600}>Lien du {date(access.createdAt)} <Text span c="dimmed" fw={400} size="sm">à {time}</Text></Text>
            {isNew ? <StatusBadge tone="accent">Nouveau</StatusBadge> : <StatusBadge tone={sent.tone}>{sent.badge}</StatusBadge>}
          </Group>
          <Group gap="lg" style={{ rowGap: 2 }}>
            <Fact label={sent.fact} at={access.sentVia ? access.sentAt : null} none="Pas d’envoi enregistré" />
            <Fact label="Dernière visite" at={access.lastUsedAt} none="Jamais visité" />
          </Group>
        </Stack>
        {!confirm && (
          <Button size="compact-sm" variant="subtle" color="red" leftSection={<IconTrash size={14} />} style={{ flexShrink: 0 }} onClick={() => setConfirm(true)}>Supprimer</Button>
        )}
      </Group>
      {confirm && (
        <Group justify="space-between" gap="sm" mt="sm" px="sm" py={8} style={{ borderRadius: 8, background: 'var(--mantine-color-red-light)' }}>
          <Text size="sm" fw={600} c="red">Ce lien ne marchera plus.</Text>
          <Group gap={6} wrap="nowrap">
            <Button size="compact-sm" variant="default" onClick={() => setConfirm(false)}>Annuler</Button>
            <Button size="compact-sm" color="red" loading={deleting} onClick={onDelete}>Supprimer</Button>
          </Group>
        </Group>
      )}
    </Paper>
  );
}

/** Accès d'un club : ses liens actifs (le plus récent d'abord), un lien de plus, un lien en moins, ou tous en moins. */
export function ClubAccessModal({ competitionId, club, onClose }: { competitionId: string; club: ClubInvitationRow | null; onClose: () => void }) {
  const { data: accesses } = useClubAccesses(competitionId, club?.clubId ?? null);
  const create = useCreateClubAccess(competitionId);
  const remove = useDeleteClubAccess(competitionId);
  const revokeAll = useRevokeInvitation(competitionId);
  const [created, setCreated] = useState<{ id: string; url: string } | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const close = () => {
    setCreated(null);
    setConfirmAll(false);
    create.reset();
    remove.reset();
    revokeAll.reset();
    onClose();
  };
  if (!club) return <Modal opened={false} onClose={close} />;
  const list = accesses ?? [];
  const times = accessTimes(list);
  const deleteOne = (linkId: string) =>
    remove.mutate({ clubId: club.clubId, linkId }, {
      onSuccess: () => { if (created?.id === linkId) setCreated(null); },
    });

  return (
    <Modal opened onClose={close} size="lg" title={`Accès ${ofName(club.clubName)}`}>
      <Stack gap="md">
        <Text size="sm" c="var(--sk-soft)">Chaque lien ouvre la même page d’inscription du club. Un lien ne s’affiche qu’à sa création.</Text>
        {created && (
          <Paper radius="md" p="sm" bg="var(--sk-chip)" style={{ border: '1px solid var(--mantine-color-shidokan-light)' }}>
            <Text size="sm" fw={600} c="var(--sk-warn-text)" mb={6}>Copiez ce lien maintenant : il ne sera plus affiché.</Text>
            <Group gap="sm" wrap="nowrap">
              <Box px="sm" py={6} bg="var(--sk-card)" style={{ flex: 1, minWidth: 0, borderRadius: 6, border: '1px solid var(--sk-card-line)' }}>
                <Text size="sm" ff="monospace" c="var(--sk-soft)" style={{ wordBreak: 'break-all' }} data-testid="new-access-url">{created.url}</Text>
              </Box>
              <CopyButton value={created.url}>
                {({ copied, copy }) => <Button size="sm" variant={copied ? 'light' : 'filled'} onClick={copy}>{copied ? 'Copié' : 'Copier le lien'}</Button>}
              </CopyButton>
            </Group>
          </Paper>
        )}
        <ApiErrorAlert error={create.error ?? remove.error ?? revokeAll.error} />
        {accesses === undefined ? <Group justify="center" py="lg"><Loader size="sm" /></Group> : (
          <Stack gap="sm">
            {list.length === 0 && <Text size="sm" data-testid="no-access">Ce club est invité, mais n’a pas encore de lien : il en recevra un à l’envoi par mail, ou créez-le ici.</Text>}
            {list.map((a) => (
              <AccessCard key={a.id} access={a} time={times.get(a.id) ?? ''} isNew={created?.id === a.id} deleting={remove.isPending && remove.variables?.linkId === a.id} onDelete={() => deleteOne(a.id)} />
            ))}
          </Stack>
        )}
        <Box pt="md" style={{ borderTop: '1px solid var(--sk-line)' }}>
          {confirmAll ? (
            <Group justify="space-between" gap="sm" px="sm" py={8} style={{ borderRadius: 8, background: 'var(--mantine-color-red-light)' }}>
              <Text size="sm" fw={600} c="red">{list.length ? 'Plus aucun lien de ce club ne marchera ; il redeviendra « à inviter ».' : 'Ce club redeviendra « à inviter ».'}</Text>
              <Group gap={6} wrap="nowrap">
                <Button size="compact-sm" variant="default" onClick={() => setConfirmAll(false)}>Annuler</Button>
                <Button size="compact-sm" color="red" loading={revokeAll.isPending} onClick={() => revokeAll.mutate(club.clubId, { onSuccess: close })}>{list.length ? 'Oui, tout supprimer' : 'Oui, retirer'}</Button>
              </Group>
            </Group>
          ) : (
            <Group justify="space-between">
              <Button leftSection={<IconPlus size={16} />} loading={create.isPending}
                onClick={() => create.mutate(club.clubId, { onSuccess: (l) => setCreated({ id: l.id, url: `${window.location.origin}/inscription/${l.token}` }) })}>
                Créer un lien
              </Button>
              <Button variant="subtle" color="red" onClick={() => setConfirmAll(true)}>{list.length ? 'Supprimer tous les accès' : 'Retirer l’invitation'}</Button>
            </Group>
          )}
        </Box>
      </Stack>
    </Modal>
  );
}
