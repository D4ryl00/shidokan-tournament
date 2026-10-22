import { Group, Title, UnstyledButton } from '@mantine/core';
import { Link } from 'react-router';
import { Logo } from './Logo.js';
import { ThemeToggle } from './ThemeToggle.js';

export function AppHeader() {
  return (
    <Group h="100%" px="md" justify="space-between" wrap="nowrap">
      <UnstyledButton component={Link} to="/">
        <Group gap="sm" wrap="nowrap">
          <Logo size={40} />
          <Title order={3}>Shidokan France — Compétitions</Title>
        </Group>
      </UnstyledButton>
      <ThemeToggle />
    </Group>
  );
}
