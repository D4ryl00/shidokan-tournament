import '@fontsource-variable/inter';
import '@mantine/core/styles.css';
import '@mantine/dates/styles.css';
import '@mantine/notifications/styles.css';
import './app.css';
import { MantineProvider } from '@mantine/core';
import { Notifications, notifications } from '@mantine/notifications';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { ApiError } from './api.js';
import { colorSchemeManager, cssVariablesResolver, theme } from './theme.js';

// Retour sur un onglet (impression, autre écran ouvert à côté) : ses données sont rechargées.
// Session expirée ou supprimée (rôle serveur) : la fenêtre de reconnexion s'ouvre par-dessus l'écran, sans perdre la saisie en cours.
const SESSION_LOST = new Set(['Connexion requise.', 'Non connecté.']);
// Écriture refusée parce qu'un autre poste a modifié la donnée : tout est relu, et le poste est prévenu.
const STALE = 'Modifié entre-temps par un autre poste : l’écran a été rechargé.';
const onError = (e: unknown) => {
  if (e instanceof ApiError && e.status === 401 && SESSION_LOST.has(e.message)) queryClient.setQueryData(['auth-expired'], true);
  if (e instanceof ApiError && e.status === 409 && e.message === STALE) {
    void queryClient.invalidateQueries();
    notifications.show({ color: 'orange', message: STALE });
  }
};
const queryClient: QueryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: true } },
  queryCache: new QueryCache({ onError }),
  mutationCache: new MutationCache({ onError }),
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="auto" colorSchemeManager={colorSchemeManager} cssVariablesResolver={cssVariablesResolver}>
      <Notifications position="top-right" />
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </MantineProvider>
  </StrictMode>,
);
