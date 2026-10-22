import { SegmentedControl, useMantineColorScheme, type MantineColorScheme } from '@mantine/core';

export function ThemeToggle() {
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  return (
    <SegmentedControl
      data-testid="theme-toggle"
      size="xs"
      value={colorScheme}
      onChange={(v) => setColorScheme(v as MantineColorScheme)}
      data={[
        { value: 'auto', label: 'Auto' },
        { value: 'light', label: 'Clair' },
        { value: 'dark', label: 'Sombre' },
      ]}
    />
  );
}
