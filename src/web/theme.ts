import { createTheme, localStorageColorSchemeManager, type MantineColorsTuple } from '@mantine/core';

// Violet du logo Shidokan France (#722f82) décliné en 10 teintes.
const shidokan: MantineColorsTuple = [
  '#f7edf9', '#e9d6ee', '#d2acdc', '#ba7fc9', '#a55ab8',
  '#9645ab', '#722f82', '#622870', '#53215f', '#431a4d',
];

export const theme = createTheme({
  primaryColor: 'shidokan',
  colors: { shidokan },
  primaryShade: { light: 6, dark: 4 },
  fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  defaultRadius: 'md',
});

export const colorSchemeManager = localStorageColorSchemeManager({ key: 'shidokan-color-scheme' });
