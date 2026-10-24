import { ActionIcon, Menu, Text } from '@mantine/core';
import { Link } from 'react-router';
import { isOrganiser, useAuthMe, useLogout } from '../api.js';
import { IconUser } from './ui/icons.js';

/** Compte connecté (serveur en ligne) : son adresse, « Mon mot de passe » (Table, Zone) et « Se déconnecter ». */
export function UserMenu() {
  const { data: me } = useAuthMe();
  const logout = useLogout();
  if (!me?.user) return null;
  return (
    <Menu position="bottom-end" width={260}>
      <Menu.Target>
        <ActionIcon variant="light" size="lg" radius="xl" data-testid="user-menu" aria-label={`Compte : ${me.user.email}`} title={me.user.email}>
          <IconUser size={18} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>Connecté</Menu.Label>
        <Text size="sm" px="sm" pb={6} className="sk-ellipsis" title={me.user.email}>{me.user.email}</Text>
        <Menu.Divider />
        {!isOrganiser(me) && <Menu.Item component={Link} to="/comptes" data-testid="nav-password">Mon mot de passe</Menu.Item>}
        <Menu.Item color="red" data-testid="logout" onClick={() => logout.mutate()}>Se déconnecter</Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}
