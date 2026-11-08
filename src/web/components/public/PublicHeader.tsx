import { Button, Group, Text, UnstyledButton } from '@mantine/core';
import { Link } from 'react-router';
import { Logo } from '../Logo.js';
import { ThemeToggle } from '../ThemeToggle.js';

/** Barre du haut des pages publiques : logo, nom, bouton de connexion des organisateurs (bien visible à droite) et thème. */
export function PublicHeader() {
  return (
    <Group h={60} px={{ base: 'sm', sm: 'lg' }} gap="xs" wrap="nowrap" justify="space-between"
      style={{ background: 'var(--sk-bar)', borderBottom: '1px solid var(--sk-line)', position: 'sticky', top: 0, zIndex: 10 }}>
      <UnstyledButton component={Link} to="/public" aria-label="Shidokan France — compétitions" style={{ minWidth: 0 }}>
        <Group gap="xs" wrap="nowrap">
          <Logo size={32} />
          <Text fw={800} size="lg" className="sk-ellipsis" style={{ letterSpacing: '-0.01em' }}>Shidokan France</Text>
        </Group>
      </UnstyledButton>
      <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
        <Button component={Link} to="/connexion" size="compact-md" data-testid="organiser-login">
          <Text span visibleFrom="xs" inherit>Connexion organisateurs</Text>
          <Text span hiddenFrom="xs" inherit>Connexion</Text>
        </Button>
        <ThemeToggle />
      </Group>
    </Group>
  );
}
