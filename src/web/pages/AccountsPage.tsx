import { Button, Group, PasswordInput, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useState } from 'react';
import { useAuthMe, useChangePassword, useCreateUser, useDeleteUser, useUsers } from '../api.js';
import { ApiErrorAlert } from '../components/ApiErrorAlert.js';
import { SectionHeader } from '../components/Help.js';

export function AccountsPage() {
  const { data: me } = useAuthMe();
  const { data: users = [] } = useUsers();
  const create = useCreateUser();
  const remove = useDeleteUser();
  const change = useChangePassword();
  const [form, setForm] = useState({ email: '', password: '' });
  const [pw, setPw] = useState({ current: '', next: '' });
  const [confirm, setConfirm] = useState<string | null>(null);

  return (
    <Stack maw={720}>
      <SectionHeader topic="comptes" order={2} />
      <Table>
        <Table.Thead><Table.Tr><Table.Th>E-mail</Table.Th><Table.Th>Créé le</Table.Th><Table.Th /></Table.Tr></Table.Thead>
        <Table.Tbody>
          {users.map((u) => (
            <Table.Tr key={u.id} data-testid="account-row">
              <Table.Td>{u.email}{u.email === me?.user?.email ? ' (vous)' : ''}</Table.Td>
              <Table.Td>{new Date(u.createdAt).toLocaleDateString('fr-FR')}</Table.Td>
              <Table.Td>
                {u.email !== me?.user?.email && (confirm === u.id ? (
                  <Group gap="xs" justify="flex-end">
                    <Button size="xs" color="red" loading={remove.isPending} onClick={() => remove.mutate(u.id, { onSuccess: () => setConfirm(null) })}>Confirmer la suppression</Button>
                    <Button size="xs" variant="subtle" onClick={() => setConfirm(null)}>Garder</Button>
                  </Group>
                ) : (
                  <Group justify="flex-end"><Button size="xs" variant="subtle" color="red" onClick={() => setConfirm(u.id)}>Supprimer</Button></Group>
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
        <Button loading={create.isPending} disabled={!form.email || !form.password}
          onClick={() => create.mutate(form, { onSuccess: () => { notifications.show({ color: 'green', message: `Compte créé : ${form.email}` }); setForm({ email: '', password: '' }); } })}>
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
    </Stack>
  );
}
