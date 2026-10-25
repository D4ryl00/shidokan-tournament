import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { InstanceRole } from '../auth/guard.js';
import type { AppDb } from '../db/client.js';
import { versionedTables } from '../db/row-versions.js';
import { backupNow } from '../repositories/backups.js';
import { competitionChanged } from '../events.js';
import { getInstance } from '../repositories/instance.js';

/** Une compétition entière, telle qu'elle passe d'une installation à l'autre (réseau ou fichier). */
export interface SyncPackage {
  format: 'shidokan-competition';
  formatVersion: 1;
  migrations: number;
  appVersion: string;
  exportedAt: string;
  from: { instanceId: string; instanceName: string; role: InstanceRole };
  /** Vrai : le destinataire prend la main (prise de main, retour, fichier « donner la main »). */
  handOver: boolean;
  /** Copie servie par le serveur alors qu'un PC a la main : son nom (affiché sur la copie), sinon null. */
  heldBy?: string | null;
  /** Copie servie par le serveur : empreinte de sa version (competitionFingerprint), retenue par le PC. */
  fingerprint?: string;
  competitionId: string;
  tables: Record<string, Record<string, unknown>[]>;
  directory: Record<string, unknown>[];
}

/** Tables d'une compétition qui voyagent, dans un ordre compatible avec les clés étrangères (la compétition d'abord). */
export const PACKAGE_TABLES = [
  'competitions', 'age_bands', 'weight_classes', 'age_links', 'closed_categories', 'waves', 'zones', 'clubs', 'fighters', 'registrations', 'categories',
  'wave_launches', 'frozen_passages', 'recasements', 'refusals', 'set_aside_cases', 'match_results', 'kata_scores', 'tie_breaks',
];
/** Cases fermées tirées de l'ancienne case « Proposée sur la fiche club » d'une compétition (même règle que la migration 0021). */
const CLOSED_FROM_CLUB_FORM = `
  INSERT OR IGNORE INTO closed_categories (competition_id, age_band_code, sex, discipline, ruleset)
  SELECT b.competition_id, b.code, s.sex, c.discipline, c.ruleset
  FROM age_bands b
  CROSS JOIN (SELECT 'F' AS sex UNION ALL SELECT 'M') s
  CROSS JOIN (
    SELECT 'karate' AS discipline, 'jiyu' AS ruleset UNION ALL SELECT 'karate', 'shobu'
    UNION ALL SELECT 'shido-boxing', 'jiyu' UNION ALL SELECT 'shido-boxing', 'shobu'
    UNION ALL SELECT 'shido-mix', 'jiyu' UNION ALL SELECT 'shido-mix', 'shobu'
    UNION ALL SELECT 'triathlon', 'jiyu' UNION ALL SELECT 'triathlon', 'shobu'
    UNION ALL SELECT 'kata', ''
  ) c
  WHERE b.competition_id = ? AND b.on_club_form = 0 AND NOT (b.is_minor = 1 AND c.ruleset = 'shobu')`;

/** Tables d'une compétition qui restent sur l'installation (liens et mails envoyés, fichiers importés, copies reçues, journaux de zone). */
export const LOCAL_ONLY_TABLES = ['uploads', 'club_invitations', 'mail_log', 'received_copies', 'zone_journal', 'zone_entries'];

/** Toutes les tables de compétition doivent être classées : celles qui voyagent, celles qui restent (garde contre l'oubli). */
export function unclassifiedTables(db: AppDb): string[] {
  const known = new Set([...PACKAGE_TABLES, ...LOCAL_ONLY_TABLES, 'club_directory']);
  const all = [...versionedTables(db), 'uploads'];
  return all.filter((t) => !known.has(t));
}

export class PackageError extends Error {
  readonly statusCode = 400;
}

/** Colonnes de la compétition propres à l'installation : la main, les échanges avec le serveur, le secours. */
export const OWNER_COLUMNS = ['owner_instance_id', 'owner_name', 'owner_since', 'owner_token_id', 'last_sync_at', 'server_fingerprint', 'rescue_since'];

/**
 * Colonnes qui désignent une ligne d'une autre table (sans clé étrangère en base pour la plupart) : une valeur qui désigne une ligne
 * d'une autre compétition est refusée (elle ferait apparaître des données dans cette autre compétition).
 */
const REFERENCES: [table: string, column: string, target: string][] = [
  ['registrations', 'fighter_id', 'fighters'], ['registrations', 'category_id', 'categories'], ['fighters', 'club_id', 'clubs'],
  ['categories', 'zone_id', 'zones'], ['categories', 'wave_override', 'waves'], ['frozen_passages', 'zone_id', 'zones'],
  ['frozen_passages', 'category_id', 'categories'], ['match_results', 'category_id', 'categories'], ['match_results', 'entrant_a', 'registrations'],
  ['match_results', 'entrant_b', 'registrations'], ['kata_scores', 'category_id', 'categories'], ['kata_scores', 'registration_id', 'registrations'],
  ['tie_breaks', 'category_id', 'categories'], ['recasements', 'registration_id', 'registrations'], ['wave_launches', 'wave_key', 'waves'],
];

/** Valeur acceptée dans une ligne : texte, nombre fini dans l'intervalle des entiers sûrs, ou vide. */
const scalar = (v: unknown) => v === null || typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= Number.MAX_SAFE_INTEGER);

const APP_VERSION = (() => {
  try {
    return (JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../../../package.json'), 'utf8')) as { version: string }).version;
  } catch {
    return 'inconnue';
  }
})();

const migrationCount = (db: AppDb) => (db.$client.prepare('select count(*) as n from __drizzle_migrations').get() as { n: number }).n;
const columnsOf = (db: AppDb, table: string) => (db.$client.prepare('select name, pk from pragma_table_info(?)').all(table) as { name: string; pk: number }[]);
const pkOf = (db: AppDb, table: string) => columnsOf(db, table).filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name);
const competitionColumn = (table: string) => (table === 'competitions' ? 'id' : 'competition_id');

export function buildPackage(db: AppDb, competitionId: string, opts: { handOver: boolean; role: InstanceRole }): SyncPackage {
  const me = getInstance(db);
  const tables: SyncPackage['tables'] = {};
  for (const t of PACKAGE_TABLES) {
    tables[t] = db.$client.prepare(`select * from "${t}" where ${competitionColumn(t)} = ?`).all(competitionId) as Record<string, unknown>[];
  }
  tables.competitions = tables.competitions!.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !OWNER_COLUMNS.includes(k))));
  if (tables.competitions!.length !== 1) throw new PackageError('Compétition introuvable');
  const directory = db.$client
    .prepare('select * from club_directory where id in (select directory_club_id from clubs where competition_id = ?)')
    .all(competitionId) as Record<string, unknown>[];
  return {
    format: 'shidokan-competition', formatVersion: 1, migrations: migrationCount(db), appVersion: APP_VERSION, exportedAt: new Date().toISOString(),
    from: { instanceId: me?.id ?? 'inconnue', instanceName: me?.name ?? 'inconnue', role: opts.role },
    handOver: opts.handOver, competitionId, tables, directory,
  };
}

/**
 * Empreinte d'une compétition : sha256 du contenu des lignes de son paquet, triées par clé primaire. Les colonnes de la main et les
 * versions de lignes n'en font pas partie ; l'état des inscriptions en ligne, si. Le serveur la donne avec chaque copie, prise de main
 * et retour, calculée après le changement : le PC garde celle de la dernière version qu'il connaît.
 */
export function competitionFingerprint(db: AppDb, competitionId: string): string {
  const { tables } = buildPackage(db, competitionId, { handOver: false, role: 'local' });
  const ignored = new Set(['version', 'updated_at']);
  const canonical = PACKAGE_TABLES.map((t) => {
    // age_links est renumérotée à chaque réception : son numéro de ligne ne compte pas, seul son contenu.
    const pk = t === 'age_links' ? [] : pkOf(db, t);
    const rows = (tables[t] ?? []).map((r) => Object.keys(r).filter((k) => !ignored.has(k) && !(t === 'age_links' && k === 'id')).sort().map((k) => [k, r[k] ?? null]));
    const key = (r: unknown[][]) => JSON.stringify(pk.length ? pk.map((k) => r.find(([c]) => c === k)?.[1] ?? null) : r);
    return [t, rows.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0))];
  });
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/** Contrôles d'un paquet reçu (réseau ou fichier), avant toute écriture ; renvoie le paquet typé. */
export function validatePackage(db: AppDb, raw: unknown): SyncPackage {
  const pkg = raw as Partial<SyncPackage> | null;
  if (!pkg || pkg.format !== 'shidokan-competition' || pkg.formatVersion !== 1 || typeof pkg.competitionId !== 'string' || !pkg.tables || typeof pkg.tables !== 'object') {
    throw new PackageError('Ce fichier n’est pas une compétition exportée par l’application.');
  }
  if (typeof pkg.migrations !== 'number' || pkg.migrations > migrationCount(db)) {
    throw new PackageError('Ce paquet vient d’une version plus récente de l’application : mettez cette installation à jour.');
  }
  const invalid = () => new PackageError('Paquet invalide : des données appartiennent à une autre compétition.');
  const malformed = (what: string) => new PackageError(`Paquet invalide : ${what}.`);
  const id = pkg.competitionId;
  const competitions = pkg.tables.competitions;
  if (!Array.isArray(competitions) || competitions.length !== 1 || competitions[0]?.id !== id) throw invalid();
  if (!Array.isArray(pkg.directory)) throw malformed('annuaire illisible');
  for (const [t, rows] of [...PACKAGE_TABLES.map((t) => [t, pkg.tables![t] ?? []] as const), ['club_directory', pkg.directory] as const]) {
    if (!Array.isArray(rows)) throw malformed(`table ${t} illisible`);
    for (const r of rows as unknown[]) {
      if (!r || typeof r !== 'object' || Array.isArray(r)) throw malformed(`ligne illisible dans ${t}`);
      for (const [k, v] of Object.entries(r)) {
        if (!scalar(v)) throw malformed(`valeur illisible (${t}.${k})`);
        if (k === 'version' && v !== null && !(Number.isSafeInteger(v) && (v as number) >= 0)) throw malformed(`version illisible (${t})`);
      }
    }
  }
  for (const t of PACKAGE_TABLES) {
    if (t === 'competitions') continue;
    const rows = pkg.tables[t] ?? [];
    if (rows.some((r) => r.competition_id !== id)) throw invalid();
    if (t === 'age_links') continue;
    const pk = pkOf(db, t);
    const find = db.$client.prepare(`select competition_id as c from "${t}" where ${pk.map((k) => `"${k}" = ?`).join(' and ')}`);
    for (const r of rows) {
      const existing = find.get(...pk.map((k) => r[k])) as { c: string } | undefined;
      if (existing && existing.c !== id) throw invalid();
    }
  }
  // Aucune référence vers une ligne d'une autre compétition.
  for (const [table, column, target] of REFERENCES) {
    const values = [...new Set((pkg.tables[table] ?? []).map((r) => r[column]).filter((v): v is string => typeof v === 'string' && v !== ''))];
    const find = db.$client.prepare(`select competition_id as c from "${target}" where id = ?`);
    for (const v of values) {
      const existing = find.get(v) as { c: string } | undefined;
      if (existing && existing.c !== id) throw invalid();
    }
  }
  return pkg as SyncPackage;
}

/** Fiche d'annuaire locale qui correspond à une fiche reçue (id, puis numéro d'affiliation, puis nom sans autre numéro) ; sinon ajoutée. */
function localEntry(db: AppDb, entry: Record<string, unknown>): string {
  const byId = db.$client.prepare('select id from club_directory where id = ?').get(entry.id) as { id: string } | undefined;
  if (byId) return byId.id;
  if (entry.affiliation_number) {
    const byNumber = db.$client.prepare('select id from club_directory where affiliation_number = ?').get(entry.affiliation_number) as { id: string } | undefined;
    if (byNumber) return byNumber.id;
  }
  const byName = db.$client
    .prepare('select id, affiliation_number as n from club_directory where name_key = ? order by created_at, id')
    .all(entry.name_key) as { id: string; n: string | null }[];
  const compatible = byName.find((e) => !e.n) ?? (!entry.affiliation_number && byName.length === 1 ? byName[0] : undefined);
  if (compatible) return compatible.id;
  const cols = columnsOf(db, 'club_directory').map((c) => c.name).filter((c) => c in entry);
  db.$client.prepare(`insert into club_directory (${cols.map((c) => `"${c}"`).join(', ')}) values (${cols.map(() => '?').join(', ')})`).run(...cols.map((c) => entry[c] ?? null));
  return entry.id as string;
}

/**
 * Remplace (ou crée) la compétition du paquet, sans toucher aux autres compétitions ni aux liens, mails et fichiers de
 * l'installation. Contrôles d'abord, sauvegarde ensuite, puis tout dans une transaction. `owner` : l'installation qui garde la main
 * (copie en lecture seule), ou null (gérée ici).
 */
export async function importPackage(
  db: AppDb,
  dbPath: string,
  raw: unknown,
  owner: { id: string; name: string } | null,
  now = new Date(),
  { backup = true }: { backup?: boolean } = {},
): Promise<{ competitionId: string; created: boolean }> {
  const pkg = validatePackage(db, raw);
  const id = pkg.competitionId;
  const created = !db.$client.prepare('select 1 from competitions where id = ?').get(id);
  if (backup) await backupNow(db, dbPath);
  const client = db.$client;
  // Seules les fiches d'annuaire des clubs du paquet sont reprises.
  const linked = new Set((pkg.tables.clubs ?? []).map((c) => c.directory_club_id).filter(Boolean));
  try {
    client.transaction(() => {
      client.pragma('defer_foreign_keys = ON');
      const entryOf = new Map(pkg.directory.filter((e) => linked.has(e.id)).map((e) => [e.id as string, localEntry(db, e)]));

      for (const t of PACKAGE_TABLES) {
        const rows = (pkg.tables[t] ?? []).map((r) => (t === 'clubs' ? { ...r, directory_club_id: r.directory_club_id ? (entryOf.get(r.directory_club_id as string) ?? null) : null } : r));
        if (t === 'age_links') {
          client.prepare('delete from age_links where competition_id = ?').run(id);
          const cols = columnsOf(db, t).map((c) => c.name).filter((c) => c !== 'id');
          const insert = client.prepare(`insert into age_links (${cols.map((c) => `"${c}"`).join(', ')}) values (${cols.map(() => '?').join(', ')})`);
          for (const r of rows) insert.run(...cols.map((c) => r[c] ?? null));
          continue;
        }
        const local = new Set(columnsOf(db, t).map((c) => c.name).filter((c) => t !== 'competitions' || !OWNER_COLUMNS.includes(c)));
        const pk = pkOf(db, t);
        for (const r of rows) {
          const cols = Object.keys(r).filter((c) => local.has(c));
          const updates = cols.filter((c) => !pk.includes(c));
          client
            .prepare(
              `insert into "${t}" (${cols.map((c) => `"${c}"`).join(', ')}) values (${cols.map(() => '?').join(', ')}) on conflict (${pk.map((k) => `"${k}"`).join(', ')}) do ` +
                (updates.length ? `update set ${updates.map((c) => `"${c}" = excluded."${c}"`).join(', ')}` : 'nothing'),
            )
            .run(...cols.map((c) => r[c] ?? null));
        }
      }

      // Lignes de la compétition qui ne sont plus dans le paquet : supprimées (des dernières tables aux premières).
      for (const t of [...PACKAGE_TABLES].reverse()) {
        if (t === 'competitions' || t === 'age_links') continue;
        const pk = pkOf(db, t);
        const keyOf = (r: Record<string, unknown>) => JSON.stringify(pk.map((k) => r[k]));
        const kept = new Set((pkg.tables[t] ?? []).map(keyOf));
        const del = client.prepare(`delete from "${t}" where ${pk.map((k) => `"${k}" = ?`).join(' and ')}`);
        for (const r of client.prepare(`select ${pk.map((k) => `"${k}"`).join(', ')} from "${t}" where competition_id = ?`).all(id) as Record<string, unknown>[]) {
          if (kept.has(keyOf(r))) continue;
          // Un club qui a des liens ou des mails sur cette installation est gardé (ils seraient supprimés avec lui).
          if (t === 'clubs' && client.prepare('select 1 from club_invitations where club_id = ? union select 1 from mail_log where club_id = ?').get(r.id, r.id)) continue;
          del.run(...pk.map((k) => r[k]));
        }
      }

      // Paquet d'une version d'avant les catégories fermées : ses tranches « non proposées sur la fiche club » deviennent fermées (comme la migration 0021).
      if (!('closed_categories' in pkg.tables)) client.prepare(CLOSED_FROM_CLUB_FORM).run(id);

      const stamp = now.toISOString();
      client
        // Une compétition reçue n'est plus « en secours » : elle est remplacée, ou gérée selon le paquet.
        .prepare('update competitions set owner_instance_id = ?, owner_name = ?, owner_since = ?, last_sync_at = ?, rescue_since = null where id = ?')
        .run(owner?.id ?? null, owner?.name ?? null, owner ? stamp : null, stamp, id);
      client.prepare('update competitions set owner_token_id = null where id = ?').run(id);
    })();
  } catch (e) {
    // Paquet incomplet ou incohérent (colonne obligatoire absente, référence impossible) : rien n'a été écrit.
    if (e instanceof PackageError) throw e;
    throw new PackageError(`Paquet invalide : ${(e as Error).message}.`);
  }
  competitionChanged(id);
  return { competitionId: id, created };
}
