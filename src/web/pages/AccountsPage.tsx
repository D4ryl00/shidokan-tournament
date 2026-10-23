import { Button, Group, Modal, PasswordInput, Select, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useState } from 'react';
import { useAuthMe, useChangePassword, useCompetitions, useCreateUser, useDeleteUser, useUpdateUserRole, useUsers, useZones, type AccountRole, type UserRole, type UserRow } from '../api.js';
import { ApiErrorAlert } from '../components/ApiErrorAlert.js';
import { SectionHeader } from '../components/Help.js';

const ROLE_LABELS: Record<UserRole, string> = { organisateur: 'Organisateur', table: 'Table centrale', zone: 'Zone' };
const NO_ROLE: AccountRole = { role: 'organisateur', competitionId: null, zoneId: null };

/** Rôle tel qu'affiché dans la liste : « Zone Tatami 1 — Coupe 2026 ». */
export function roleText(u: Pick<UserRow, 'role' | 'competitionName' | 'zoneName'>): string {
  if (u.role !== 'zone') return ROLE_LABELS[u.role];
  if (!u.competitionName || !u.zoneName) return 'Zone (n’existe plus)';
  return `Zone ${u.zoneName} — ${u.competitionName}`;
}

/** Rôle, puis pour une Zone : la compétition, puis une de ses zones. */
function RoleFields({ value, onChange }: { value: AccountRole; onChange: (v: AccountRole) => void }) {
  const { data: competitions = [] } = useCompetitions();
  const { data: zones = [] } = useZones(value.competitionId ?? '', value.role === 'zone');
  return (
    <>
      <Select label="Rôle" data-testid="account-role" allowDeselect={false} value={value.role} w={170}
        data={(Object.keys(ROLE_LABELS) as UserRole[]).map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
        onChange={(v) => v && onChange({ role: v as UserRole, competitionId: null, zoneId: null })} />
      {value.role === 'zone' && (
        <>
          <Select label="Compétition" data-testid="account-competition" value={value.competitionId} w={220} placeholder="Choisir"
            data={competitions.map((c) => ({ value: c.id, label: c.name }))}
            onChange={(v) => onChange({ ...value, competitionId: v, zoneId: null })} />
          <Select label="Zone" data-testid="account-zone" value={value.zoneId} w={160} placeholder="Choisir" disabled={!value.competitionId}
            data={zones.map((z) => ({ value: z.id, label: z.name }))}
            onChange={(v) => onChange({ ...value, zoneId: v })} />
        </>
      )}
    </>
  );
}

export function AccountsPage() {
  const { data: me } = useAuthMe();
  const { data: users = [] } = useUsers();
  const create = useCreateUser();
  const remove = useDeleteUser();
  const updateRole = useUpdateUserRole();
  const change = useChangePassword();
  const [form, setForm] = useState({ email: '', password: '' });
  const [access, setAccess] = useState<AccountRole>(NO_ROLE);
  const [pw, setPw] = useState({ current: '', next: '' });
  const [confirm, setConfirm] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ user: UserRow; access: AccountRole } | null>(null);
  const zoneIncomplete = (a: AccountRole) => a.role === 'zone' && (!a.competitionId || !a.zoneId);

  return (
    <Stack maw={900}>
      <SectionHeader topic="comptes" order={2} />
      <Table>
        <Table.Thead><Table.Tr><Table.Th>E-mail</Table.Th><Table.Th>Rôle</Table.Th><Table.Th>Créé le</Table.Th><Table.Th /></Table.Tr></Table.Thead>
        <Table.Tbody>
          {users.map((u) => (
            <Table.Tr key={u.id} data-testid="account-row">
              <Table.Td>{u.email}{u.email === me?.user?.email ? ' (vous)' : ''}</Table.Td>
              <Table.Td data-testid="account-row-role">{roleText(u)}</Table.Td>
              <Table.Td>{new Date(u.createdAt).toLocaleDateString('fr-FR')}</Table.Td>
              <Table.Td>
                {u.email !== me?.user?.email && (confirm === u.id ? (
                  <Group gap="xs" justify="flex-end">
                    <Button size="xs" color="red" loading={remove.isPending} onClick={() => remove.mutate(u.id, { onSuccess: () => setConfirm(null) })}>Confirmer la suppression</Button>
                    <Button size="xs" variant="subtle" onClick={() => setConfirm(null)}>Garder</Button>
                  </Group>
                ) : (
                  <Group gap="xs" justify="flex-end" wrap="nowrap">
                    <Button size="xs" variant="subtle" data-testid="account-change-role"
                      onClick={() => setEditing({ user: u, access: { role: u.role, competitionId: u.competitionId, zoneId: u.zoneId } })}>Changer le rôle</Button>
                    <Button size="xs" variant="subtle" color="red" onClick={() => setConfirm(u.id)}>Supprimer</Button>
                  </Group>
                ))}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <ApiErrorAlert error={remove.error} />

      <Title order={4}>Ajouter un compte</Title>
      <Group align="end">
        <TextInput label="E-mail" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.currentTarget.value })} />
        <PasswordInput label="Mot de passe" description="10 caractères au moins" value={form.password} onChange={(e) => setForm({ ...form, password: e.currentTarget.value })} />
        <RoleFields value={access} onChange={setAccess} />
        <Button loading={create.isPending} disabled={!form.email || !form.password || zoneIncomplete(access)} data-testid="account-create"
          onClick={() => create.mutate({ ...form, ...access }, { onSuccess: () => { notifications.show({ color: 'green', message: `Compte créé : ${form.email}` }); setForm({ email: '', password: '' }); setAccess(NO_ROLE); } })}>
          Ajouter le compte
        </Button>
      </Group>
      <ApiErrorAlert error={create.error} />

      <Title order={4}>Changer mon mot de passe</Title>
      <Group align="end">
        <PasswordInput label="Mot de passe actuel" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.currentTarget.value })} />
        <PasswordInput label="Nouveau mot de passe" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.currentTarget.value })} />
        <Button loading={change.isPending} disabled={!pw.current || !pw.next}
          onClick={() => change.mutate(pw, { onSuccess: () => { notifications.show({ color: 'green', message: 'Mot de passe changé.' }); setPw({ current: '', next: '' }); } })}>
          Changer
        </Button>
      </Group>
      <ApiErrorAlert error={change.error} />
      <Text size="sm" c="dimmed">Le premier compte d’un serveur se crée en ligne de commande (voir l’aide).</Text>

      <Modal opened={editing !== null} onClose={() => setEditing(null)} title={`Rôle de ${editing?.user.email ?? ''}`}>
        {editing && (
          <Stack>
            <Group align="end"><RoleFields value={editing.access} onChange={(a) => setEditing({ ...editing, access: a })} /></Group>
            <ApiErrorAlert error={updateRole.error} />
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setEditing(null)}>Annuler</Button>
              <Button data-testid="account-role-save" loading={updateRole.isPending} disabled={zoneIncomplete(editing.access)}
                onClick={() => updateRole.mutate({ id: editing.user.id, ...editing.access }, { onSuccess: () => setEditing(null) })}>Enregistrer</Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}
