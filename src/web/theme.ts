import {
  Badge,
  Button,
  Card,
  createTheme,
  localStorageColorSchemeManager,
  Modal,
  Paper,
  Table,
  Tabs,
  type CSSVariablesResolver,
  type MantineColorsTuple,
} from '@mantine/core';

/**
 * Jetons de couleur des deux thèmes (conception de la refonte, §4.1) : les écrans n'utilisent que ces variables `--sk-*`
 * (ou les couleurs de Mantine accordées dessus), jamais une couleur écrite en dur.
 */
export const TOKENS = {
  dark: {
    bg: '#141118', bar: '#141118', line: '#2a2431', card: '#1d1922', cardLine: '#2c2633', row: '#1a1620',
    text: '#f1edf5', soft: '#b9b1c2', muted: '#8d8497', accent: '#c17ad3', onAccent: '#1a0f1f',
    hero: 'linear-gradient(135deg, #3b1f47, #2a1833)', heroText: '#d9a8e6', heroSub: '#b9a9c4',
    chip: '#2a2131', chipText: '#e3c6ec', ok: '#1f2a22', okText: '#7fd6a0', warn: '#33281a', warnText: '#f0b766',
    // Barres de la liste des règles : du vert (sans validation) au rouge (concessions très fortes), texte `onCost`.
    cost0: '#2b8a57', cost1: '#5c8f22', cost2: '#9a7600', cost3: '#c25a0c', cost4: '#c43a30', onCost: '#ffffff',
  },
  light: {
    bg: '#f7f5f9', bar: '#ffffff', line: '#ebe6ef', card: '#ffffff', cardLine: '#e7e1ec', row: '#faf8fb',
    text: '#1d1622', soft: '#4b4354', muted: '#72687d', accent: '#722f82', onAccent: '#ffffff',
    hero: 'linear-gradient(135deg, #f3e6f7, #fbf6fd)', heroText: '#722f82', heroSub: '#6b5f75',
    chip: '#f1e4f6', chipText: '#722f82', ok: '#e6f5ec', okText: '#1f7a45', warn: '#fff3df', warnText: '#9a5a00',
    cost0: '#1f7a45', cost1: '#4d7f1a', cost2: '#8a6a00', cost3: '#b04e00', cost4: '#b42318', onCost: '#ffffff',
  },
} as const;
export type TokenName = keyof (typeof TOKENS)['dark'];

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const variablesOf = (t: Record<TokenName, string>) => Object.fromEntries(Object.entries(t).map(([k, v]) => [`--sk-${kebab(k)}`, v]));

// Violet du logo Shidokan France (#722f82, teinte 6 en clair) et sa version lumineuse pour le sombre (#c17ad3, teinte 4).
const shidokan: MantineColorsTuple = ['#f8eefb', '#efdcf4', '#e0bbe9', '#d09ade', '#c17ad3', '#a95dbd', '#722f82', '#62286f', '#521f5d', '#41184a'];
// Surfaces du thème sombre (Mantine : 0 texte, 2 texte discret, 4 bordures, 6 cartes et champs, 7 fond).
const dark: MantineColorsTuple = ['#f1edf5', '#d6cfdd', '#b9b1c2', '#8d8497', '#352e3d', '#2c2633', '#1d1922', '#141118', '#0f0d12', '#0a090c'];
// Gris légèrement violets du thème clair (3 et 4 bordures, 6 texte discret).
const gray: MantineColorsTuple = ['#faf8fb', '#f3f0f5', '#ebe6ef', '#e0d9e5', '#cdc4d4', '#a89eb2', '#72687d', '#4b4354', '#2e2835', '#1d1622'];

export const cssVariablesResolver: CSSVariablesResolver = () => ({
  variables: {},
  light: { ...variablesOf(TOKENS.light), '--mantine-color-body': TOKENS.light.bg, '--mantine-color-text': TOKENS.light.text, '--mantine-color-dimmed': TOKENS.light.muted },
  dark: { ...variablesOf(TOKENS.dark), '--mantine-color-body': TOKENS.dark.bg, '--mantine-color-text': TOKENS.dark.text, '--mantine-color-dimmed': TOKENS.dark.muted },
});

const surface = { backgroundColor: 'var(--sk-card)', borderColor: 'var(--sk-card-line)' };

export const theme = createTheme({
  primaryColor: 'shidokan',
  colors: { shidokan, dark, gray },
  primaryShade: { light: 6, dark: 4 },
  // Texte noir sur le violet lumineux du thème sombre, blanc sur le violet du logo.
  autoContrast: true,
  luminanceThreshold: 0.28,
  fontFamily: '"Inter Variable", system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  headings: { fontFamily: '"Inter Variable", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', fontWeight: '700' },
  defaultRadius: 'md',
  components: {
    Badge: Badge.extend({ defaultProps: { variant: 'light', radius: 'xl', size: 'md' }, styles: { root: { textTransform: 'none', fontWeight: 600, letterSpacing: 0 } } }),
    Button: Button.extend({ defaultProps: { radius: 'md' }, styles: { root: { fontWeight: 600 } } }),
    Card: Card.extend({ defaultProps: { radius: 'lg' }, styles: { root: surface } }),
    Paper: Paper.extend({ defaultProps: { radius: 'lg' }, styles: { root: surface } }),
    Modal: Modal.extend({ defaultProps: { radius: 'lg' }, styles: { content: { backgroundColor: 'var(--sk-card)' }, header: { backgroundColor: 'var(--sk-card)' } } }),
    Table: Table.extend({ defaultProps: { highlightOnHover: true, verticalSpacing: 'sm' }, styles: { th: { color: 'var(--sk-muted)', fontWeight: 600, fontSize: 'var(--mantine-font-size-xs)' }, thead: { borderBottomColor: 'var(--sk-line)' } } }),
    Tabs: Tabs.extend({ styles: { tab: { fontWeight: 500 } } }),
  },
});

export const colorSchemeManager = localStorageColorSchemeManager({ key: 'shidokan-color-scheme' });
