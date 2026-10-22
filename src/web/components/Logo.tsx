import { Box, useComputedColorScheme } from '@mantine/core';

/** Logo Shidokan France ; posé sur un disque blanc en thème sombre (anneau et texte noirs). */
export function Logo({ size }: { size: number }) {
  const scheme = useComputedColorScheme('light');
  const dark = scheme === 'dark';
  return (
    <Box
      data-testid="logo"
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        backgroundColor: dark ? '#ffffff' : 'transparent',
        padding: dark ? 2 : 0,
        flexShrink: 0,
        display: 'flex',
      }}
    >
      <img src="/shidokan-france-logo.webp" alt="Shidokan France" width="100%" height="100%" />
    </Box>
  );
}
