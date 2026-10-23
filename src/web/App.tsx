import { AppShell } from '@mantine/core';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router';
import { AppHeader } from './components/AppHeader.js';
import { CompetitionLayout } from './components/CompetitionLayout.js';
import { BracketsRoute } from './pages/BracketsRoute.js';
import { ClubEntryPage } from './pages/ClubEntryPage.js';
import { ClubFormPage } from './pages/ClubFormPage.js';
import { ClubsPage } from './pages/ClubsPage.js';
import { CompetitionSettingsPage } from './pages/CompetitionSettingsPage.js';
import { CompetitionsPage } from './pages/CompetitionsPage.js';
import { DirectoryPage } from './pages/DirectoryPage.js';
import { FfkImportPage } from './pages/FfkImportPage.js';
import { GridEditorPage } from './pages/GridEditorPage.js';
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
        <Route path="/competitions/:id/impression" element={<PrintPage />} />
        <Route path="/competitions/:id/impression/pesee" element={<WeighInSheets />} />
        <Route path="/competitions/:id/impression/podiums" element={<PodiumsPrintPage />} />
        <Route path="/inscription/:token" element={<ClubEntryPage />} />
        <Route path="*" element={<MainShell />} />
      </Routes>
    </BrowserRouter>
  );
}

/** Anciens onglets « vagues » et « recasement » (renommés le 2026-10-23) : redirigés, avec le reste de l'adresse. */
function RenamedTab({ to }: { to: string }) {
  const { search } = useLocation();
  return <Navigate to={`../${to}${search}`} relative="path" replace />;
}

function MainShell() {
  return (
      <AppShell header={{ height: 64 }} padding="md">
        <AppShell.Header>
          <AppHeader />
        </AppShell.Header>
        <AppShell.Main>
          <Routes>
            <Route path="/" element={<CompetitionsPage />} />
            <Route path="/annuaire" element={<DirectoryPage />} />
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
