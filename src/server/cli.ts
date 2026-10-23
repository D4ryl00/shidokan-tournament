/**
 * Comptes des organisateurs en ligne de commande (premier compte d'un serveur) :
 *   node dist/server/cli.js add-user <e-mail>     mot de passe demandé deux fois (ou lu sur l'entrée standard, une ligne)
 *   node dist/server/cli.js list-users
 *   node dist/server/cli.js delete-user <e-mail>
 * Dans Docker : docker compose exec -it app node dist/server/cli.js add-user <e-mail>
 */
import fs from 'node:fs';
import { createInterface } from 'node:readline';
import { closeDb, openDb } from './db/client.js';
import { createUser, deleteUser, findUserByEmail, listUsers } from './auth/sessions.js';

/** Saisie sans écho au clavier ; sans clavier (entrée redirigée), une ligne de l'entrée standard. */
function askPassword(question: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    return new Promise((resolve) => {
      const rl = createInterface({ input: stdin });
      rl.once('line', (line) => {
        rl.close();
        resolve(line);
      });
    });
  }
  process.stdout.write(question);
  return new Promise((resolve) => {
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (ch === '\u0003') process.exit(130);
        value = ch === '\u007f' ? value.slice(0, -1) : value + ch;
      }
    };
    stdin.on('data', onData);
  });
}

/**
 * Lancé en administrateur (`docker compose exec`) sur une base qui appartient à un autre utilisateur : on prend son identité,
 * pour ne jamais créer de fichier de base que l'application ne pourrait plus écrire.
 */
function actAsDatabaseOwner(dbPath: string): void {
  if (process.getuid?.() !== 0 || !fs.existsSync(dbPath)) return;
  const { uid, gid } = fs.statSync(dbPath);
  if (uid === 0) return;
  process.setgid!(gid);
  process.setuid!(uid);
}

async function main(): Promise<number> {
  const [command, email] = process.argv.slice(2);
  const dbPath = process.env.DATABASE_PATH ?? './data/shidokan.sqlite';
  actAsDatabaseOwner(dbPath);
  const db = openDb(dbPath);
  try {
    if (command === 'list-users') {
      for (const u of listUsers(db)) console.log(`${u.email}  (créé le ${u.createdAt.slice(0, 10)})`);
      return 0;
    }
    if (command === 'add-user' && email) {
      const password = await askPassword('Mot de passe (10 caractères au moins) : ');
      if (process.stdin.isTTY && (await askPassword('Encore une fois : ')) !== password) {
        console.error('Les deux mots de passe diffèrent.');
        return 1;
      }
      const user = createUser(db, email, password);
      console.log(`Compte créé : ${user.email}`);
      return 0;
    }
    if (command === 'delete-user' && email) {
      const user = findUserByEmail(db, email);
      if (!user) {
        console.error(`Compte introuvable : ${email}`);
        return 1;
      }
      deleteUser(db, user.id);
      console.log(`Compte supprimé : ${user.email}`);
      return 0;
    }
    console.error('Usage : cli.js add-user <e-mail> | list-users | delete-user <e-mail>');
    return 2;
  } catch (e) {
    console.error((e as Error).message);
    return 1;
  } finally {
    closeDb(db);
  }
}

process.exit(await main());
