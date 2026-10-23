import { Anchor, Button, Group, Text, Title, UnstyledButton } from '@mantine/core';
import { isOrganiser, useAuthMe, useLogout } from '../api.js';
import { Link } from 'react-router';
import { Logo } from './Logo.js';
import { ThemeToggle } from './ThemeToggle.js';

export function AppHeader() {
  const { data: me } = useAuthMe();
  const logout = useLogout();
  return (
    <Group h="100%" px="md" justify="space-between" wrap="nowrap">
      <UnstyledButton component={Link} to="/">
        <Group gap="sm" wrap="nowrap">
          <Logo size={40} />
          <Title order={3}>Shidokan France — Compétitions</Title>
        </Group>
      </UnstyledButton>
      <Group gap="md" wrap="nowrap">
        {isOrganiser(me) && (
          <>
            <Anchor component={Link} to="/annuaire" data-testid="nav-directory">Annuaire des clubs</Anchor>
            <Anchor component={Link} to="/parametres" data-testid="nav-settings">Réglages de l’application</Anchor>
          </>
        )}
        {me?.user && (
          <>
            {isOrganiser(me)
              ? <Anchor component={Link} to="/comptes" data-testid="nav-accounts">Comptes</Anchor>
              : <Anchor component={Link} to="/comptes" data-testid="nav-password">Mon mot de passe</Anchor>}
            <Text size="sm" c="dimmed" visibleFrom="md">{me.user.email}</Text>
            <Button size="xs" variant="subtle" data-testid="logout" loading={logout.isPending} onClick={() => logout.mutate()}>Se déconnecter</Button>
          </>
        )}
        <ThemeToggle />
      </Group>
    </Group>
  );
}
