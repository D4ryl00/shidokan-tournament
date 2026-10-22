import { expect, test } from 'vitest';
import { ffkDefaultGrid } from '../../src/domain/grid-ffk.js';
import { closeDb, openDb } from '../../src/server/db/client.js';
import {
  GridValidationError,
  createCompetition,
  getCompetition,
  getGrid,
  listCompetitions,
  replaceGrid,
  updateCompetition,
} from '../../src/server/repositories/competitions.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

const NAME = "Coupe Shidokan – Côte d'Azur";

test('une compétition est créée avec la grille FFK et relue à l’identique', async () => {
  const db = openDb(tmpDbPath());
  const c = await createCompetition(db, { name: NAME, date: '2026-11-22' });
  expect(c.tatamiCount).toBe(2);
  expect((await getCompetition(db, c.id))?.name).toBe(NAME);
  expect(await getGrid(db, c.id)).toEqual(ffkDefaultGrid());
  expect((await listCompetitions(db)).map((x) => x.id)).toEqual([c.id]);
});

test('compétitions listées par date décroissante', async () => {
  const db = openDb(tmpDbPath());
  const a = await createCompetition(db, { name: 'A', date: '2026-01-10' });
  const b = await createCompetition(db, { name: 'B', date: '2026-11-22' });
  expect((await listCompetitions(db)).map((x) => x.id)).toEqual([b.id, a.id]);
});

test('replaceGrid enregistre une grille modifiée', async () => {
  const db = openDb(tmpDbPath());
  const c = await createCompetition(db, { name: NAME, date: '2026-11-22' });
  const g = ffkDefaultGrid();
  const wc = g.weightClasses.find((w) => w.ageBandCode === 'poussin' && w.sex === 'F' && w.maxKg === 25)!;
  wc.label = '-20';
  wc.maxKg = 20;
  await replaceGrid(db, c.id, g);
  expect(await getGrid(db, c.id)).toEqual(g);
});

test('replaceGrid refuse une grille invalide et garde l’ancienne', async () => {
  const db = openDb(tmpDbPath());
  const c = await createCompetition(db, { name: NAME, date: '2026-11-22' });
  const bad = ffkDefaultGrid();
  bad.ageBands.push({ ...bad.ageBands[0]! });
  await expect(replaceGrid(db, c.id, bad)).rejects.toThrow(GridValidationError);
  expect(await getGrid(db, c.id)).toEqual(ffkDefaultGrid());
});

test('les réglages partiels gardent les autres valeurs', async () => {
  const db = openDb(tmpDbPath());
  const c = await createCompetition(db, { name: NAME, date: '2026-11-22' });
  await updateCompetition(db, c.id, { settings: { repechage: true } });
  const again = await updateCompetition(db, c.id, { settings: { thirdPlaceMatch: true } });
  expect(again.settings.repechage).toBe(true);
  expect(again.settings.thirdPlaceMatch).toBe(true);
  expect(again.settings.weightGapMaxKg).toEqual({ children: 5, adults: 5 });
});

test('les données survivent à la fermeture et réouverture de la base', async () => {
  const file = tmpDbPath();
  const db = openDb(file);
  const c = await createCompetition(db, { name: NAME, date: '2026-11-22', location: 'Nice', tatamiCount: 3 });
  closeDb(db);
  const reopened = openDb(file);
  expect(await getCompetition(reopened, c.id)).toEqual(c);
});

test('getCompetition renvoie null pour un identifiant inconnu', async () => {
  const db = openDb(tmpDbPath());
  expect(await getCompetition(db, 'inconnu')).toBeNull();
});

test('renommer une catégorie garde son identifiant', async () => {
  const db = openDb(tmpDbPath());
  const c = await createCompetition(db, { name: NAME, date: '2026-11-22' });
  const g = await getGrid(db, c.id);
  const wc = g.weightClasses.find((w) => w.ageBandCode === 'poussin' && w.sex === 'F' && w.maxKg === 25)!;
  wc.label = '-20';
  wc.maxKg = 20;
  await replaceGrid(db, c.id, g);
  const after = await getGrid(db, c.id);
  expect(after.weightClasses.find((w) => w.id === wc.id)?.label).toBe('-20');
});

test('les fonctions du dépôt sont asynchrones (chemin PostgreSQL)', () => {
  const db = openDb(tmpDbPath());
  expect(createCompetition(db, { name: NAME, date: '2026-11-22' })).toBeInstanceOf(Promise);
  expect(listCompetitions(db)).toBeInstanceOf(Promise);
});

test('des réglages stockés obsolètes ne cassent pas la lecture', async () => {
  const db = openDb(tmpDbPath());
  const c = await createCompetition(db, { name: NAME, date: '2026-11-22' });
  db.$client
    .prepare('update competitions set settings_json = ? where id = ?')
    .run(JSON.stringify({ repechage: true, ancienneCle: 1, kataBronzeCount: 7 }), c.id);
  const [read] = await listCompetitions(db);
  expect(read!.settings.repechage).toBe(true);
  expect(read!.settings.kataBronzeCount).toBe(2);
});
