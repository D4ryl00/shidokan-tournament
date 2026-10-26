import { AppShell, Center, Loader } from '@mantine/core';
import type { ReactNode } from 'react';
import { useAuthExpired, useAuthMe } from './api.js';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useMatch } from 'react-router';
import { AppHeader } from './components/AppHeader.js';
import { CompetitionLayout } from './components/CompetitionLayout.js';
import { AccountsPage } from './pages/AccountsPage.js';
import { AppSettingsPage } from './pages/AppSettingsPage.js';
import { BracketsRoute } from './pages/BracketsRoute.js';
import { ClubEntryPage } from './pages/ClubEntryPage.js';
import { ClubFormPage } from './pages/ClubFormPage.js';
import { ClubsPage } from './pages/ClubsPage.js';
import { CompetitionSettingsPage } from './pages/CompetitionSettingsPage.js';
import { CompetitionsPage } from './pages/CompetitionsPage.js';
import { DirectoryPage } from './pages/DirectoryPage.js';
import { DirectorySyncPage } from './pages/DirectorySyncPage.js';
import { FfkImportPage } from './pages/FfkImportPage.js';
import { GridEditorPage } from './pages/GridEditorPage.js';
import { LoginPage, ReloginModal } from './pages/LoginPage.js';
import { MatchesPage } from './pages/MatchesPage.js';
import { PodiumsPage } from './pages/PodiumsPage.js';
import { PodiumsPrintPage, PrintPage } from './pages/PrintPage.js';
import { RegistrationsPage } from './pages/RegistrationsPage.js';
import { ReplacementPage } from './pages/ReplacementPage.js';
import { WavesPage } from './pages/WavesPage.js';
import { WeighInPage, WeighInSheets } from './pages/WeighInPage.js';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/competitions/:id/impression" element={<AuthGate><PrintPage /></AuthGate>} />
        <Route path="/competitions/:id/impression/pesee" element={<AuthGate><WeighInSheets /></AuthGate>} />
        <Route path="/competitions/:id/impression/podiums" element={<AuthGate><PodiumsPrintPage /></AuthGate>} />
        <Route path="/inscription/:token" element={<ClubEntryPage />} />
        <Route path="*" element={<AuthGate><MainShell /></AuthGate>} />
      </Routes>
    </BrowserRouter>
  );
}

/** En ligne (rôle serveur) : l'écran de connexion tant qu'aucun organisateur n'est connecté. Sur le PC : rien à faire. */
function AuthGate({ children }: { children: ReactNode }) {
  const { data, isLoading } = useAuthMe();
  const expired = useAuthExpired();
  if (isLoading) return <Center mih="100vh"><Loader /></Center>;
  if (!data) return <LoginPage />;
  return (
    <>
      {children}
      {data.role === 'serveur' && expired && <ReloginModal />}
    </>
  );
}

/** Anciens onglets « vagues » et « recasement » (renommés le 2026-10-23) : redirigés, avec le reste de l'adresse. */
function RenamedTab({ to }: { to: string }) {
  const { search } = useLocation();
  return <Navigate to={`../${to}${search}`} relative="path" replace />;
}

function MainShell() {
  // Écrans d'une compétition : sa propre barre compacte remplace celle de l'application.
  const inCompetition = !!useMatch('/competitions/:id/*');
  return (
      <AppShell header={{ height: 60, collapsed: inCompetition }} padding="lg">
        <AppShell.Header>
          {!inCompetition && <AppHeader />}
        </AppShell.Header>
        <AppShell.Main>
          <Routes>
            <Route path="/" element={<CompetitionsPage />} />
            <Route path="/annuaire" element={<DirectoryPage />} />
            <Route path="/annuaire/google" element={<DirectorySyncPage />} />
            <Route path="/comptes" element={<AccountsPage />} />
            <Route path="/parametres" element={<AppSettingsPage />} />
            <Route path="/competitions/:id" element={<CompetitionLayout />}>
              <Route index element={<Navigate to="reglages" replace />} />
              <Route path="inscriptions" element={<RegistrationsPage />} />
              <Route path="clubs" element={<ClubsPage />} />
              <Route path="fiche-club" element={<ClubFormPage />} />
              <Route path="import-ffk" element={<FfkImportPage />} />
              <Route path="sessions" element={<WavesPage />} />
              <Route path="vagues" element={<RenamedTab to="sessions" />} />
              <Route path="pesee" element={<WeighInPage />} />
              <Route path="reaffectation" element={<ReplacementPage />} />
              <Route path="recasement" element={<RenamedTab to="reaffectation" />} />
              <Route path="tableaux" element={<BracketsRoute />} />
              <Route path="combats" element={<MatchesPage />} />
              <Route path="podiums" element={<PodiumsPage />} />
              <Route path="reglages" element={<CompetitionSettingsPage />} />
              <Route path="grille" element={<GridEditorPage />} />
            </Route>
          </Routes>
        </AppShell.Main>
      </AppShell>
  );
}
