import { expect, test, type Page } from '@playwright/test';
import { buildFfkWorkbook, FFK_HEADER_2026, type FfkLine } from '../helpers/ffk-fixture.js';
import { createCompetition } from './helpers.js';

// Export FFK 2026-2027 : Prénom, Nom, Numero, Entite rattachement, Genre, Type, Age, Categorie, Technique (non lue) ;
// le règlement des seniors est écrit dans l'âge.
const TANI = '0060893 TANI DOJO';
const SENIOR_JIYU = 'Séniors jiyu ippon kumite';
const SENIOR_SHOBU = 'Séniors shobu ippon kumité';
const MOREAU: FfkLine = ['Lina', 'MOREAU', 'L5', TANI, 'Féminin', 'Karate', 'Cadette', -47, null];

const exportFile = (lines: FfkLine[]) => buildFfkWorkbook({ 'Coupe Shidokan Karate': lines }, { header: FFK_HEADER_2026 });

type Reg = {
  fighterId: string; weightClassId: string | null; ruleset: string | null; ffkConfirmed: boolean; source: string;
  fighter: { lastName: string; firstName: string; licence: string | null };
  club: { id: string; name: string; ffkEntity: string | null } | null;
};

async function newClub(page: Page, id: string, name: string): Promise<string> {
  const res = await page.request.post(`/api/competitions/${id}/clubs`, { data: { name } });
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { id: string }).id;
}

/** Inscription existante (fiche club par défaut) : cadette F en karaté jiyu, sauf ce que `over` change. */
async function register(page: Page, id: string, clubId: string, lastName: string, firstName: string, over: object = {}) {
  const res = await page.request.post(`/api/competitions/${id}/registrations`, {
    data: { clubId, lastName, firstName, sex: 'F', ageBandCode: 'cadet', discipline: 'karate', ruleset: 'jiyu', weightClassId: 'cadet:F:-54', source: 'club_form', ...over },
  });
  expect(res.ok()).toBe(true);
}

const registrations = async (page: Page, id: string) => (await (await page.request.get(`/api/competitions/${id}/registrations`)).json()) as Reg[];
const regOf = async (page: Page, id: string, lastName: string) => (await registrations(page, id)).filter((r) => r.fighter.lastName === lastName);

async function uploadFfk(page: Page, id: string, file: Buffer) {
  await page.goto(`/competitions/${id}/import-ffk`);
  await page.getByTestId('ffk-file').setInputFiles({ name: 'export.xlsx', mimeType: 'application/octet-stream', buffer: file });
  await expect(page.getByTestId('ffk-summary')).toBeVisible();
  // Le champ est vidé aussitôt lu : choisir de nouveau le même fichier le relit.
  await expect(page.getByTestId('ffk-file')).toHaveValue('');
}

const summary = (page: Page) => page.getByTestId('ffk-summary');
const clubCard = (page: Page, entity: string) => page.getByTestId('ffk-club').filter({ hasText: entity });
const fighterCard = (page: Page, name: string) => page.getByTestId('ffk-card').filter({ hasText: name });

/** « Importer… », puis « Importer » dans la fenêtre de confirmation : attend la réponse du serveur (pas une notification d'avant). */
async function confirmImport(page: Page) {
  const done = page.waitForResponse((r) => r.url().includes('/ffk-imports/') && r.url().endsWith('/commit'));
  await page.getByTestId('ffk-commit-confirm').click();
  expect((await done).status()).toBe(200);
}

test('import ffk : relier un club, créer un club, valider une carte avec écarts, écarter une ligne, importer avec des points non tranchés, réimporter : seuls les non tranchés restent', async ({ page }) => {
  const id = await createCompetition(page, 'Coupe import FFK');
  const tani = await newClub(page, id, 'Tani Dojo');
  const esvl = await newClub(page, id, 'ESVL');
  await register(page, id, tani, 'MARTIN', 'Léa', { licence: 'L1' });
  await register(page, id, tani, 'MOREAU', 'Lina', { licence: 'L5', weightClassId: 'cadet:F:-47' });
  await register(page, id, tani, 'MARTINI', 'Jules', { sex: 'M', ageBandCode: 'minime', weightClassId: 'minime:M:-40' });

  const ffk = exportFile([
    ['Léa', 'MARTIN', 'L1', TANI, 'Féminin', 'Karate', 'Cadette', -61, null], // même licence, poids différent : à trancher
    ['Jules', 'MARTINNI', null, TANI, 'Masculin', 'Karate', 'Minime', -40, null], // nom très proche de MARTINI : à trancher
    ['Hugo', 'FARGE', 'L3', TANI, 'Masculin', 'Karate', 'Cadet', 70, null], // « 70 » sans signe : ambigu chez les cadets
    ['Paul', 'DUPONT', 'L4', '0060901 ESVL KARATE', 'Masculin', 'Karate', SENIOR_JIYU, -75, null], // club au nom proche, à vérifier
    ['Nina', 'ROSSI', 'L6', '0060999 KARATE CLUB NOUVEAU', 'Féminin', 'Karate', SENIOR_SHOBU, -55, null], // club inconnu
    MOREAU, // même licence, rien ne change
  ]);
  await uploadFfk(page, id, ffk);
  await expect(page.getByTestId('ffk-sheet')).toHaveCount(1);
  await expect(summary(page)).toContainText('7 à trancher : 2 clubs · 5 combattants');
  await expect(summary(page)).toContainText('0 validée · 1 sans problème');
  await expect(page.getByTestId('ffk-weight-classes')).toContainText('Toutes les catégories de poids de l’export sont dans la grille.');
  await expect(page.getByTestId('ffk-orphans')).toContainText('Tous les inscrits de la compétition sont dans l’export.');
  // Rien n'est tranché : « Importer… » reste possible.
  await expect(page.getByTestId('ffk-bar-message')).toContainText('les 7 points non tranchés sont laissés de côté');

  // 2. Clubs : le sûr est relié d'office ; ESVL est à vérifier, on le relie.
  await expect(clubCard(page, TANI).getByTestId('ffk-club-status')).toHaveText('Sûr');
  await expect(clubCard(page, TANI)).toContainText('Relié d’office.');
  const esvlCard = clubCard(page, 'ESVL KARATE');
  await expect(esvlCard.getByTestId('ffk-club-status')).toHaveText('À vérifier');
  await expect(esvlCard.getByRole('radio', { name: /^Ne pas relier pour l’instant/ })).toBeChecked();
  await expect(fighterCard(page, 'DUPONT Paul')).toContainText('(pas relié)');
  await esvlCard.getByRole('radio', { name: /^Relier à ESVL/ }).click();
  await expect(esvlCard.getByTestId('ffk-club-status')).toHaveText('Relié');
  await expect(summary(page)).toContainText('5 à trancher : 1 club · 4 combattants');
  // Club relié : son nouveau combattant, sans candidat, est importé tel quel.
  await expect(fighterCard(page, 'DUPONT Paul').getByTestId('ffk-card-state')).toHaveText('Sans problème');

  // Club inconnu : « ➕ Créer un club… » ouvre la fenêtre de l'annuaire, pré-remplie.
  const nouveau = clubCard(page, 'KARATE CLUB NOUVEAU');
  await expect(nouveau.getByTestId('ffk-club-status')).toHaveText('Nouveau');
  await nouveau.getByRole('button', { name: '➕ Créer un club…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Ajouter un club' });
  await expect(dialog.getByTestId('directory-name')).toHaveValue('KARATE CLUB NOUVEAU');
  await expect(dialog.getByTestId('directory-number')).toHaveValue('0060999');
  await dialog.getByTestId('directory-save').click();
  await expect(dialog).toBeHidden();
  await expect(nouveau.getByTestId('ffk-club-status')).toHaveText('Créé');
  await expect(summary(page)).toContainText('3 à trancher : 0 club · 3 combattants');
  await expect(fighterCard(page, 'ROSSI Nina').getByTestId('ffk-card-state')).toHaveText('Sans problème');

  // 3. Une carte avec un écart : le champ démarre vide, « À choisir » ; FFK le remplit, puis on valide.
  const martin = fighterCard(page, 'MARTIN Léa');
  await expect(martin.getByTestId('ffk-card-state')).toHaveText('À trancher');
  await expect(martin.getByRole('radio', { name: /^Ne pas lier pour l’instant/ })).toBeChecked();
  await martin.getByRole('radio', { name: /^C’est MARTIN Léa \(même licence\)/ }).click();
  await expect(martin.getByTestId('ffk-pending-count')).toContainText('1 choix à faire');
  const weight = martin.getByTestId('zone-weightClassId');
  await expect(weight).toHaveAttribute('data-zone', 'decide');
  await expect(martin.getByTestId('ffk-card-validate')).toBeDisabled();
  await expect(martin.getByTestId('ffk-card-missing')).toHaveText('Reste à remplir : catégorie de poids.');
  await weight.getByTestId('ffk-choice-ffk').click();
  await expect(weight).toHaveAttribute('data-zone', 'decided');
  await expect(martin.getByTestId('zone-tag-weightClassId')).toHaveText('Choisi');
  await expect(martin.getByTestId('ffk-pending-count')).toHaveCount(0);
  await expect(martin.getByTestId('ffk-card-state')).toHaveText('À valider');
  await martin.getByTestId('ffk-card-validate').click();
  await expect(martin.getByTestId('ffk-card-state')).toHaveText('Validée');
  await expect(martin.getByTestId('ffk-card-summary')).toContainText('Liée à MARTIN Léa · Catégorie de poids : -54 kg → -61 kg');
  await expect(summary(page)).toContainText('2 à trancher : 0 club · 2 combattants');
  await expect(summary(page)).toContainText('1 validée · 3 sans problème');

  // Écarter une ligne : la carte suivante (ouverte par la validation) est liée au candidat, puis écartée.
  const martinni = fighterCard(page, 'MARTINNI Jules');
  await martinni.getByRole('radio', { name: /^C’est MARTINI Jules \(nom très proche\)/ }).click();
  await martinni.getByRole('button', { name: 'Écarter cette ligne' }).click();
  await expect(martinni.getByTestId('ffk-card-state')).toHaveText('Écartée');
  await expect(martinni.getByTestId('ffk-card-summary')).toHaveText('Ligne écartée : pas importée.');
  await expect(summary(page)).toContainText('1 à trancher : 0 club · 1 combattant');

  // FARGE (poids « 70 » ambigu) reste à trancher : l'import n'est pas bloqué, la ligne est laissée de côté.
  await expect(fighterCard(page, 'FARGE Hugo').getByTestId('ffk-card-state')).toHaveText('À trancher');
  await expect(page.getByTestId('ffk-bar-message')).toHaveText('Vous pouvez importer maintenant : le point non tranché est laissé de côté.');
  await expect(page.getByTestId('ffk-commit')).toBeEnabled();
  await page.getByTestId('ffk-commit').click();
  const recap = page.getByTestId('ffk-recap');
  await expect(recap).toContainText('Clubs reliés ou créés');
  await expect(recap).toContainText('ESVL KARATE → ESVL');
  await expect(recap).toContainText('KARATE CLUB NOUVEAU → KARATE CLUB NOUVEAU');
  await expect(recap).toContainText('Inscriptions mises à jour (1)');
  await expect(recap).toContainText('MARTIN Léa — Karaté : Catégorie de poids : -54 kg → -61 kg');
  await expect(recap).toContainText('validée');
  await expect(recap).toContainText('Confirmées sans changement (1)');
  await expect(recap).toContainText('Combattants créés (2)');
  await expect(recap).toContainText('Laissé de côté : 2 combattants');
  await expect(recap).toContainText('FARGE Hugo — Karaté : reste à remplir');
  await expect(recap).toContainText('MARTINNI Jules — Karaté : écartée');
  await confirmImport(page);
  await expect(page.getByText('Import FFK : 2 combattants créés, 1 mis à jour, 0 supprimé, 0 catégorie créée, 2 combattants laissés de côté.')).toBeVisible();

  // Ce qui a été écrit : la carte validée, les nouveaux combattants (règlement lu dans l'âge), les liens de club mémorisés.
  const [lea] = await regOf(page, id, 'MARTIN');
  expect(lea).toMatchObject({ weightClassId: 'cadet:F:-61', ffkConfirmed: true });
  const [rossi] = await regOf(page, id, 'ROSSI');
  expect(rossi).toMatchObject({ ruleset: 'shobu', ffkConfirmed: true, club: { name: 'KARATE CLUB NOUVEAU', ffkEntity: '0060999 KARATE CLUB NOUVEAU' } });
  const [dupont] = await regOf(page, id, 'DUPONT');
  expect(dupont).toMatchObject({ ruleset: 'jiyu', club: { id: esvl, ffkEntity: '0060901 ESVL KARATE' } });
  expect(await regOf(page, id, 'FARGE')).toEqual([]);
  // Lignes laissées de côté : leurs combattants ne changent pas.
  expect(await regOf(page, id, 'MARTINI')).toMatchObject([{ weightClassId: 'minime:M:-40', ffkConfirmed: false }]);
  expect(await registrations(page, id)).toHaveLength(5);

  // Réimport du même fichier : clubs reconnus, seules les deux lignes non tranchées reviennent.
  await uploadFfk(page, id, ffk);
  await expect(summary(page)).toContainText('2 à trancher : 0 club · 2 combattants');
  await expect(page.getByTestId('ffk-club-status')).toHaveText(['Sûr', 'Sûr', 'Sûr']);
  await expect(page.getByTestId('ffk-card')).toHaveCount(2);
  await expect(fighterCard(page, 'MARTINNI Jules').getByTestId('ffk-card-state')).toHaveText('À trancher');
  await expect(fighterCard(page, 'FARGE Hugo').getByTestId('ffk-card-state')).toHaveText('À trancher');
  await expect(page.getByText('Sans problème · 4', { exact: true })).toBeVisible();
});

test('import ffk : catégorie cochée puis décochée', async ({ page }) => {
  const id = await createCompetition(page, 'Coupe FFK catégories');
  await newClub(page, id, 'Tani Dojo');
  await uploadFfk(page, id, exportFile([['Marc', 'LEROY', 'L20', TANI, 'Masculin', 'Karate', SENIOR_JIYU, -90, null]]));

  // −90 n'existe pas chez les seniors : case décochée, rien n'est créé d'office, le poids est à choisir.
  const category = page.getByTestId('ffk-weight-class');
  await expect(category).toHaveCount(1);
  await expect(category).toContainText('Seniors · Masculin · -90 kg');
  await expect(category).toContainText('1 combattant · pas créée');
  await expect(category.getByRole('checkbox')).not.toBeChecked();
  const leroy = fighterCard(page, 'LEROY Marc');
  await expect(leroy.getByTestId('ffk-card-state')).toHaveText('À trancher');
  await expect(summary(page)).toContainText('1 à trancher : 0 club · 1 combattant');

  // Cochée : la catégorie sera créée, la carte devient sans problème.
  await category.getByRole('checkbox').check();
  await expect(category).toContainText('1 combattant · sera créée');
  await expect(leroy.getByTestId('ffk-card-state')).toHaveText('Sans problème');
  await expect(summary(page)).toContainText('Tout est tranché');

  // Décochée : retour à l'état de départ.
  await category.getByRole('checkbox').uncheck();
  await expect(category).toContainText('1 combattant · pas créée');
  await expect(leroy.getByTestId('ffk-card-state')).toHaveText('À trancher');
  await expect(summary(page)).toContainText('1 à trancher : 0 club · 1 combattant');

  // Import : aucune catégorie créée, la ligne est laissée de côté.
  await expect(page.getByTestId('ffk-commit')).toBeEnabled();
  await page.getByTestId('ffk-commit').click();
  await expect(page.getByTestId('ffk-recap')).toContainText('Laissé de côté : 1 combattant');
  await expect(page.getByTestId('ffk-recap')).not.toContainText('Catégories de poids créées');
  await confirmImport(page);
  await expect(page.getByText('Import FFK : 0 combattant créé, 0 mis à jour, 0 supprimé, 0 catégorie créée, 1 combattant laissé de côté.')).toBeVisible();
  const grid = (await (await page.request.get(`/api/competitions/${id}/grid`)).json()) as { weightClasses: { id: string }[] };
  expect(grid.weightClasses.map((w) => w.id)).not.toContain('senior:M:-90');
  expect(await registrations(page, id)).toEqual([]);
});

test('import ffk : fiche sans inscription FFK supprimée', async ({ page }) => {
  const id = await createCompetition(page, 'Coupe FFK fiches');
  const tani = await newClub(page, id, 'Tani Dojo');
  await register(page, id, tani, 'MOREAU', 'Lina', { licence: 'L5', weightClassId: 'cadet:F:-47' });
  await register(page, id, tani, 'BLANC', 'Zoé', { source: 'ffk' }); // venue d'un import FFK précédent
  await register(page, id, tani, 'NOIR', 'Anna');
  await uploadFfk(page, id, exportFile([MOREAU]));

  const orphans = page.getByTestId('ffk-orphan');
  await expect(orphans).toHaveCount(2);
  const blanc = orphans.filter({ hasText: 'BLANC Zoé' });
  const noir = orphans.filter({ hasText: 'NOIR Anna' });
  await expect(blanc).toContainText('présent dans l’export précédent');
  await expect(noir).not.toContainText('présent dans l’export précédent');
  // Par défaut, rien n'est retiré : « Garder ».
  await expect(blanc.getByRole('radio', { name: 'Garder' })).toBeChecked();
  await blanc.getByText('Supprimer', { exact: true }).click();
  await expect(blanc).toContainText('L’inscription sera supprimée à l’import.');

  await expect(page.getByTestId('ffk-commit')).toBeEnabled();
  await page.getByTestId('ffk-commit').click();
  const recap = page.getByTestId('ffk-recap');
  await expect(recap).toContainText('Inscriptions supprimées (1)');
  await expect(recap).toContainText('BLANC Zoé — Karaté');
  await expect(recap).toContainText('Fiches club sans inscription FFK gardées (1)');
  await confirmImport(page);
  await expect(page.getByText('Import FFK : 0 combattant créé, 0 mis à jour, 1 supprimé, 0 catégorie créée.')).toBeVisible();

  expect(await regOf(page, id, 'BLANC')).toEqual([]);
  // Gardée telle quelle, sans la marque « confirmée FFK » ; la ligne de l'export est confirmée.
  expect(await regOf(page, id, 'NOIR')).toMatchObject([{ ffkConfirmed: false, weightClassId: 'cadet:F:-54' }]);
  expect(await regOf(page, id, 'MOREAU')).toMatchObject([{ ffkConfirmed: true }]);
});

test('import ffk : 360 px sans débordement', async ({ page }) => {
  const id = await createCompetition(page, 'Coupe FFK téléphone');
  const tani = await newClub(page, id, 'Tani Dojo');
  await newClub(page, id, 'Budo');
  await register(page, id, tani, 'MARTIN', 'Léa', { licence: 'L1' });
  await register(page, id, tani, 'NOIR', 'Anna');
  await page.setViewportSize({ width: 360, height: 740 });
  await uploadFfk(page, id, exportFile([
    ['Léa', 'MARTIN', 'L1', TANI, 'Féminin', 'Karate', 'Cadette', -61, null],
    ['Paul', 'DURAND-LEFEBVRE', 'L30', '0060902 BUDO CLUB DE LA VALLEE DE LA VESUBIE', 'Masculin', 'Karate', SENIOR_JIYU, -90, null],
    MOREAU,
  ]));
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

  // Toutes les sections : catégorie, clubs (à vérifier), cartes, fiche sans inscription FFK, barre du bas.
  await expect(page.getByTestId('ffk-weight-class')).toHaveCount(1);
  await expect(page.getByTestId('ffk-club')).toHaveCount(2);
  await expect(page.getByTestId('ffk-orphan')).toHaveCount(1);
  await expect(page.getByTestId('ffk-import-bar')).toBeVisible();
  expect(await overflow()).toBeLessThanOrEqual(0);

  // Une carte ouverte, avec son champ à choisir.
  const martin = fighterCard(page, 'MARTIN Léa');
  await martin.getByRole('radio', { name: /^C’est MARTIN Léa \(même licence\)/ }).click();
  await expect(martin.getByTestId('zone-weightClassId')).toBeVisible();
  await expect(martin.getByTestId('ffk-card-validate')).toBeVisible();
  expect(await overflow()).toBeLessThanOrEqual(0);

  // La fenêtre de confirmation.
  await expect(page.getByTestId('ffk-commit')).toBeEnabled();
  await page.getByTestId('ffk-commit').click();
  const dialog = page.getByRole('dialog', { name: 'Confirmer l’import FFK' });
  await expect(dialog.getByTestId('ffk-recap')).toContainText('Laissé de côté');
  expect(await dialog.getByTestId('ffk-recap').evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  expect(await overflow()).toBeLessThanOrEqual(0);
});
