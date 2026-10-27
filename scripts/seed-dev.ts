/**
 * Script de développement : ajoute à la base une compétition de test remplie de combattants fictifs,
 * répartis dans des catégories variées (toutes disciplines, âges, sexes, jiyu et shobu, kata avec grade,
 * catégories pleines et combattants seuls à recaser). Les autres compétitions ne sont pas touchées.
 *
 *   npm run seed:dev                 → base ./data/shidokan.sqlite (ou DATABASE_PATH)
 *   npm run seed:dev -- --seed 42    → autre tirage (même graine = mêmes données)
 *
 * Les données passent par l'API de l'app (validation, catégories et tableaux à jour), sans serveur à lancer.
 */
import { pathToFileURL } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { weightClassesFor } from '../src/domain/grid.js';
import type { CategoryGrid, DisciplineId, Ruleset, Sex } from '../src/domain/types.js';
import { buildApp } from '../src/server/app.js';

// Noms inventés, absents de l'export FFK : la base de dev ne doit jamais ressembler à de vraies personnes.
const LAST_NAMES = [
  'ORTALAN', 'BRUSSANDE', 'QUELVIRAN', 'MARZELOT', 'TRIVANEL', 'SOULAVIN', 'PELDORAN', 'VERMALOT', 'DOLVERAN', 'FAUNTREL', 'GRAVELOUX', 'JORVANNE',
  'MORVANDEL', 'NAVERLIN', 'OSTRAVEL', 'PRUNELLAC', 'RAVENTOL', 'SALVERNE', 'TARVOLIN', 'URDAVEL', 'VALMORIN', 'ZELORAN', 'ABRIVAL', 'CORVELIN',
  'DRAVENNE', 'ESCALVIN', 'FERMOLAN', 'GALVERAN', 'HASTELIN', 'IVORLAN', 'KERDAVEL', 'LOMBREVAL', 'MALTRAVEN', 'NORVELLE', 'QUINTRAVE', 'ROSVELIN',
];
const FIRST_NAMES: Record<Sex, string[]> = {
  F: ['Léa', 'Emma', 'Chloé', 'Inès', 'Jade', 'Louise', 'Manon', 'Camille', 'Sarah', 'Zoé', 'Lina', 'Alice', 'Nina', 'Clara', 'Lola', 'Rose'],
  M: ['Hugo', 'Lucas', 'Nathan', 'Louis', 'Gabriel', 'Arthur', 'Jules', 'Adam', 'Paul', 'Noah', 'Tom', 'Léo', 'Ethan', 'Sacha', 'Raphaël', 'Nolan'],
};
const CLUBS = [
  { name: 'Dojo des Oliviers (démo)', coachName: 'Coach Démo 1', preApproval: true },
  { name: 'Karaté Club du Port (démo)', coachName: 'Coach Démo 2', preApproval: false },
  { name: 'Shidokan Riviera (démo)', coachName: 'Coach Démo 3', preApproval: true },
  { name: 'Budo Collines (démo)', coachName: 'Coach Démo 4', preApproval: false },
  { name: 'Arts Martiaux du Cap (démo)', coachName: 'Coach Démo 5', preApproval: false },
];
const GRADES = ['6e kyu', '5e kyu', '4e kyu', '3e kyu', '2e kyu', '1er kyu', '1er dan', '2e dan'];

/**
 * Groupes de combattants : discipline, tranche, sexe, rang de la catégorie de poids, nombre.
 * Des catégories pleines (tableaux et poules) et des combattants seuls (cas de recasement).
 */
interface Group { discipline: DisciplineId; band: string; sex: Sex; weight?: number; ruleset?: Ruleset; count: number; kataToo?: number }
const GROUPS: Group[] = [
  { discipline: 'karate', band: 'poussin', sex: 'M', weight: 1, count: 4 },
  { discipline: 'karate', band: 'poussin', sex: 'F', weight: 0, count: 2 },
  { discipline: 'karate', band: 'pupille', sex: 'F', weight: 1, count: 2 },
  { discipline: 'karate', band: 'benjamin', sex: 'M', weight: 2, count: 6, kataToo: 2 },
  { discipline: 'karate', band: 'benjamin', sex: 'F', weight: 0, count: 1 },
  { discipline: 'karate', band: 'minime', sex: 'F', weight: 1, count: 3 },
  { discipline: 'karate', band: 'minime', sex: 'M', weight: 3, count: 1 },
  { discipline: 'karate', band: 'cadet', sex: 'F', weight: 1, count: 5, kataToo: 2 },
  { discipline: 'karate', band: 'cadet', sex: 'F', weight: 0, count: 1 },
  { discipline: 'karate', band: 'cadet', sex: 'M', weight: 2, count: 4 },
  { discipline: 'karate', band: 'junior', sex: 'M', weight: 2, count: 3 },
  { discipline: 'karate', band: 'junior', sex: 'F', weight: 1, count: 3 },
  { discipline: 'karate', band: 'senior', sex: 'M', weight: 3, count: 8, kataToo: 1 },
  { discipline: 'karate', band: 'senior', sex: 'F', weight: 2, count: 4 },
  { discipline: 'karate', band: 'senior', sex: 'M', weight: 4, ruleset: 'shobu', count: 4 },
  { discipline: 'karate', band: 'senior', sex: 'F', weight: 3, ruleset: 'shobu', count: 1 },
  { discipline: 'karate', band: 'v1', sex: 'M', weight: 3, count: 3 },
  { discipline: 'karate', band: 'v2', sex: 'M', weight: 3, count: 1 },
  { discipline: 'shido-boxing', band: 'senior', sex: 'M', weight: 3, count: 4 },
  { discipline: 'shido-boxing', band: 'junior', sex: 'M', weight: 2, count: 3 },
  { discipline: 'shido-mix', band: 'senior', sex: 'M', weight: 3, count: 3 },
  { discipline: 'shido-mix', band: 'junior', sex: 'F', weight: 1, count: 1 },
  { discipline: 'triathlon', band: 'senior', sex: 'M', weight: 3, count: 2 },
  { discipline: 'kata', band: 'minime', sex: 'M', count: 2 },
  { discipline: 'kata', band: 'senior', sex: 'M', count: 4 },
  { discipline: 'kata', band: 'v1', sex: 'F', count: 3 },
];

/** Générateur pseudo-aléatoire reproductible (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function call<T>(app: FastifyInstance, method: 'GET' | 'POST' | 'PUT', url: string, payload?: object): Promise<T> {
  const res = await app.inject({ method, url, payload });
  if (res.statusCode >= 400) throw new Error(`${method} ${url} → ${res.statusCode} : ${res.body}`);
  return (res.body ? res.json() : undefined) as T;
}

export async function seedDev(app: FastifyInstance, opts: { seed?: number } = {}): Promise<{ competitionId: string; name: string; registrations: number }> {
  const random = rng(opts.seed ?? 1);
  const pick = <T>(list: T[]): T => list[Math.floor(random() * list.length)]!;
  const stamp = new Date().toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
  const name = `Démo — Coupe Shidokan (${stamp})`;
  const { id } = await call<{ id: string }>(app, 'POST', '/api/competitions', { name, date: '2026-11-22', location: 'Gymnase (démo)', zoneCount: 3 });
  const base = `/api/competitions/${id}`;

  // Comme pour la Coupe 2026 : mini-poussins et espoirs non proposés sur la fiche club
  const grid = await call<CategoryGrid>(app, 'GET', `${base}/grid`);
  await call(app, 'PUT', `${base}/grid`, { ...grid, ageBands: grid.ageBands.map((b) => ({ ...b, onClubForm: b.code !== 'mini-poussin' && b.code !== 'espoir' })) });

  const clubIds: string[] = [];
  for (const [i, c] of CLUBS.entries()) {
    const club = await call<{ id: string }>(app, 'POST', `${base}/clubs`, { ...c, coachPhone: `06 00 00 00 0${i + 1}`, coachEmails: [`coach${i + 1}@example.org`] });
    clubIds.push(club.id);
  }

  const used = new Set<string>();
  const person = (sex: Sex) => {
    for (;;) {
      const p = { lastName: pick(LAST_NAMES), firstName: pick(FIRST_NAMES[sex]) };
      const key = `${p.lastName} ${p.firstName}`;
      if (!used.has(key)) {
        used.add(key);
        return p;
      }
    }
  };

  let registrations = 0;
  for (const g of GROUPS) {
    const classes = g.weight === undefined ? [] : weightClassesFor(grid, g.band, g.sex);
    const wc = g.weight === undefined ? null : classes[Math.min(g.weight, classes.length - 1)]!;
    for (let k = 0; k < g.count; k++) {
      const who = person(g.sex);
      // Deux combattants sans club (inscription sur place)
      const clubId = registrations === 10 || registrations === 40 ? null : pick(clubIds);
      const ruleset: Ruleset | null = g.discipline === 'kata' ? null : (g.ruleset ?? 'jiyu');
      const prefs: DisciplineId[] =
        g.discipline === 'karate' && random() < 0.4 ? (random() < 0.5 ? ['shido-boxing'] : ['shido-mix', 'shido-boxing']) : [];
      const maxKg = wc?.maxKg ?? (wc ? 95 : null);
      const body = {
        clubId, ...who, sex: g.sex, ageBandCode: g.band, discipline: g.discipline, ruleset,
        weightClassId: wc?.id ?? null,
        approxWeightKg: maxKg === null ? null : Math.round((maxKg - random() * 3.5) * 10) / 10,
        otherDisciplines: prefs,
        acceptsJiyuFirst: ruleset === 'shobu' ? random() < 0.6 : null,
        source: clubId === null ? 'onsite' : 'manual',
        ...(g.discipline === 'kata' ? { grade: pick(GRADES) } : {}),
      };
      await call(app, 'POST', `${base}/registrations`, body);
      registrations++;
      // Certains combattants font aussi du kata (même combattant, deuxième inscription)
      if (g.kataToo && k < g.kataToo) {
        await call(app, 'POST', `${base}/registrations`, {
          ...body, discipline: 'kata', ruleset: null, weightClassId: null, otherDisciplines: [], acceptsJiyuFirst: null, grade: pick(GRADES),
        });
        registrations++;
      }
    }
  }
  return { competitionId: id, name, registrations };
}

// Lancement en ligne de commande
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const i = process.argv.indexOf('--seed');
  const seed = i > 0 ? Number(process.argv[i + 1]) : 1;
  const dbPath = process.env.DATABASE_PATH ?? './data/shidokan.sqlite';
  const app = await buildApp({ dbPath, backupIntervalMin: 0 });
  try {
    const r = await seedDev(app, { seed });
    console.log(`Compétition « ${r.name} » créée dans ${dbPath} : ${r.registrations} inscriptions (graine ${seed}).`);
  } finally {
    await app.close();
  }
}
