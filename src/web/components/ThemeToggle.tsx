import { ActionIcon, Menu, useMantineColorScheme, type MantineColorScheme } from '@mantine/core';
import { IconAuto, IconMoon, IconSun } from './ui/icons.js';

const CHOICES: { value: MantineColorScheme; label: string; icon: React.ReactNode }[] = [
  { value: 'auto', label: 'Auto', icon: <IconAuto size={16} /> },
  { value: 'light', label: 'Clair', icon: <IconSun size={16} /> },
  { value: 'dark', label: 'Sombre', icon: <IconMoon size={16} /> },
];

/** Thème de l'écran : un bouton, et le choix Auto (comme l'ordinateur), Clair ou Sombre dans son menu. */
export function ThemeToggle() {
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const current = CHOICES.find((c) => c.value === colorScheme) ?? CHOICES[0]!;
  return (
    <Menu position="bottom-end" width={160}>
      <Menu.Target>
        <ActionIcon variant="subtle" color="gray" size="lg" radius="md" data-testid="theme-toggle" aria-label={`Thème : ${current.label}`} title={`Thème : ${current.label}`}>
          {current.icon}
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>Thème</Menu.Label>
        {CHOICES.map((c) => (
          <Menu.Item key={c.value} leftSection={c.icon} onClick={() => setColorScheme(c.value)} fw={c.value === colorScheme ? 700 : undefined}>
            {c.label}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}
