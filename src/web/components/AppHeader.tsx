import { Anchor, Group, Menu, ActionIcon, Text, UnstyledButton } from '@mantine/core';
import { Link, useLocation } from 'react-router';
import { isOrganiser, useAppVersion, useAuthMe, type AuthMe } from '../api.js';
import { Logo } from './Logo.js';
import { ThemeToggle } from './ThemeToggle.js';
import { UserMenu } from './UserMenu.js';
import { IconMenu } from './ui/icons.js';

/** Pages de l'application (hors compétition) permises à ce compte. */
export function appLinks(me: AuthMe | undefined): { to: string; label: string; testId: string }[] {
  const organiser = isOrganiser(me);
  return [
    { to: '/', label: 'Compétitions', testId: 'nav-competitions' },
    ...(organiser ? [{ to: '/annuaire', label: 'Annuaire', testId: 'nav-directory' }, { to: '/parametres', label: 'Réglages', testId: 'nav-settings' }] : []),
    ...(organiser && me?.user ? [{ to: '/comptes', label: 'Comptes', testId: 'nav-accounts' }] : []),
  ];
}

/** Version affichée : « v1.2.3 », ou « dev » hors d'une image publiée. */
export const versionLabel = (version: string) => (version.includes('-dev') ? 'dev' : `v${version}`);

/** Logo et nom, retour à la liste des compétitions ; la version en petit à côté du nom (et au survol du logo). */
export function Brand({ compact = false }: { compact?: boolean }) {
  const version = useAppVersion();
  const label = version ? versionLabel(version) : null;
  return (
    <UnstyledButton component={Link} to="/" aria-label="Shidokan France — compétitions" title={label ? `Version ${label}` : undefined} style={{ flexShrink: 0 }}>
      <Group gap="xs" wrap="nowrap">
        <Logo size={compact ? 30 : 34} />
        {!compact && <Text fw={800} size="lg" style={{ whiteSpace: 'nowrap', letterSpacing: '-0.01em' }}>Shidokan France</Text>}
        {!compact && label && <Text size="xs" c="dimmed" visibleFrom="sm" data-testid="app-version" style={{ whiteSpace: 'nowrap' }}>{label}</Text>}
      </Group>
    </UnstyledButton>
  );
}

/** Les pages de l'application dans un menu (écrans d'une compétition, où la barre est prise par la compétition). */
export function AppMenu() {
  const { data: me } = useAuthMe();
  return (
    <Menu position="bottom-end" width={200}>
      <Menu.Target>
        <ActionIcon variant="subtle" color="gray" size="lg" radius="md" data-testid="app-menu" aria-label="Pages de l’application">
          <IconMenu />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        {appLinks(me).map((l) => <Menu.Item key={l.to} component={Link} to={l.to} data-testid={l.testId}>{l.label}</Menu.Item>)}
      </Menu.Dropdown>
    </Menu>
  );
}

/** Barre du haut des pages de l'application : sur une ligne, jamais coupée. */
export function AppHeader() {
  const { data: me } = useAuthMe();
  const { pathname } = useLocation();
  const active = (to: string) => (to === '/' ? pathname === '/' : pathname.startsWith(to));
  return (
    <Group h="100%" px="lg" gap="lg" wrap="nowrap" style={{ background: 'var(--sk-bar)', borderBottom: '1px solid var(--sk-line)' }}>
      <Brand />
      <Group gap={4} wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
        {appLinks(me).map((l) => (
          <Anchor key={l.to} component={Link} to={l.to} data-testid={l.testId} underline="never" px="sm" py={6}
            style={{ borderRadius: 999, whiteSpace: 'nowrap', fontWeight: 600, fontSize: 14, color: active(l.to) ? 'var(--sk-chip-text)' : 'var(--sk-muted)', background: active(l.to) ? 'var(--sk-chip)' : 'transparent' }}>
            {l.label}
          </Anchor>
        ))}
      </Group>
      <Group gap="xs" wrap="nowrap">
        <ThemeToggle />
        <UserMenu />
      </Group>
    </Group>
  );
}
