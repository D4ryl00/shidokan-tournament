import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { ApiError } from './api.js';
import { colorSchemeManager, theme } from './theme.js';

// Retour sur un onglet (impression, autre écran ouvert à côté) : ses données sont rechargées.
// Session expirée ou supprimée (rôle serveur) : l'état de connexion est relu, ce qui ramène à l'écran de connexion.
const onError = (e: unknown) => {
  if (e instanceof ApiError && e.status === 401 && e.message === 'Connexion requise.') void queryClient.invalidateQueries({ queryKey: ['auth'] });
};
const queryClient: QueryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: true } },
  queryCache: new QueryCache({ onError }),
  mutationCache: new MutationCache({ onError }),
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="auto" colorSchemeManager={colorSchemeManager}>
      <Notifications position="top-right" />
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </MantineProvider>
  </StrictMode>,
);
