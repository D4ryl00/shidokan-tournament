import { AppShell } from '@mantine/core';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { AppHeader } from './components/AppHeader.js';
import { CompetitionLayout } from './components/CompetitionLayout.js';
import { BracketsRoute } from './pages/BracketsRoute.js';
import { ClubFormPage } from './pages/ClubFormPage.js';
import { ClubsPage } from './pages/ClubsPage.js';
import { CompetitionSettingsPage } from './pages/CompetitionSettingsPage.js';
import { CompetitionsPage } from './pages/CompetitionsPage.js';
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
        <Route path="*" element={<MainShell />} />
      </Routes>
    </BrowserRouter>
  );
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
            <Route path="/competitions/:id" element={<CompetitionLayout />}>
              <Route index element={<Navigate to="reglages" replace />} />
              <Route path="inscriptions" element={<RegistrationsPage />} />
              <Route path="clubs" element={<ClubsPage />} />
              <Route path="fiche-club" element={<ClubFormPage />} />
              <Route path="import-ffk" element={<FfkImportPage />} />
              <Route path="vagues" element={<WavesPage />} />
              <Route path="pesee" element={<WeighInPage />} />
              <Route path="recasement" element={<ReplacementPage />} />
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
