# Étape 17 (étape C du spec) : mise en ligne, comptes, mails et conservation des données — plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :**
- L'application peut tourner **en rôle `serveur`**, sur internet, derrière Caddy. Toute la partie organisateurs y exige une **connexion** (comptes avec mot de passe), et seules les pages des clubs restent publiques, avec un nombre de requêtes limité.
- Les organisateurs **envoient le lien de chaque club par mail** (SMTP, Gmail par exemple), avec un message modifiable. Chaque envoi crée un nouveau lien.
- La page du club affiche la **mention sur les données personnelles**.
- Les données d'organisation sont **effacées automatiquement** 13 mois après la compétition, et le palmarès est gardé.
- En rôle `local` (le PC du jour J), rien ne change : pas de connexion.

**Architecture :**
- Le rôle vient de `INSTANCE_ROLE=serveur|local` (défaut `local`).
- Une migration ajoute `users`, `sessions`, `app_settings` (clé → JSON), `mail_log` et `competitions.purged_at`.
- Les tables propres à l'installation (`instance`, `change_counter`, `users`, `sessions`, `app_settings`) ne sont jamais copiées par une restauration. Les comptes, les sessions et le mot de passe SMTP sont **retirés des fichiers de sauvegarde**.
- Les sessions passent par un cookie `HttpOnly` dont seule l'empreinte est en base.
- Un crochet `onRequest` protège `/api/*` en rôle `serveur`, vérifie l'origine des écritures et limite le nombre de requêtes.
- Les mails passent par nodemailer, avec un transport injectable pour les tests.
- L'effacement tourne au démarrage, puis une fois par jour.

**Tech Stack :** TypeScript, Fastify 5, Drizzle (SQLite), React 19 + Mantine 8, react-query, nodemailer (nouvelle dépendance), Vitest, Playwright.

**Spec :** `docs/superpowers/specs/2026-10-23-inscriptions-en-ligne-et-synchronisation-design.md` §6 (mails), §8.1 à §8.5 (rôles, comptes, sécurité, conservation, hébergement). Hors de cette étape : les rôles table centrale et zone (étapes A et E), le transfert entre installations (D).

## Global Constraints
- **Rôle** : `INSTANCE_ROLE=serveur` active les comptes, `trustProxy`, le cookie `Secure` et l'adresse publique `PUBLIC_URL` (base des liens envoyés). Si elle manque, on prend l'origine de la requête. Toute autre valeur, ou l'absence de la variable, vaut `local`.
- **Routes publiques en rôle `serveur`** : `GET /api/health`, `GET /api/auth/me`, `POST /api/auth/login`, `/api/inscription/*`. Toutes les autres routes `/api/*` répondent **401** `{ error: 'Connexion requise.' }` sans session valide. Les fichiers de l'interface (`index.html`, `/assets/*`) restent servis : l'interface affiche l'écran de connexion.
- **Mots de passe** : `scrypt` (N=16384, r=8, p=1, longueur 64), sel aléatoire de 16 octets. Format stocké : `scrypt$<sel base64>$<empreinte base64>`. Au moins **10 caractères**. Comparaison en temps constant (`timingSafeEqual`).
- **Session** :
  - jeton de 32 octets aléatoires en base64url, dont seule l'empreinte SHA-256 est en base ;
  - cookie `shidokan_session` avec `HttpOnly; SameSite=Lax; Path=/`, plus `Secure` en rôle `serveur`, et `Max-Age` de 30 jours ;
  - l'expiration glisse : elle repart à 30 jours à chaque usage, avec au plus une mise à jour par heure ;
  - « Se déconnecter » supprime la session.
- **Origine des écritures** (rôle `serveur`) : une requête autre que GET ou HEAD qui porte un en-tête `Origin` dont l'hôte diffère de l'hôte de la requête → **403** `{ error: 'Origine refusée.' }`.
- **Limites** (en mémoire, par adresse IP) :
  - `/api/inscription/*` : 300 requêtes par fenêtre de 10 minutes ;
  - `POST /api/auth/login` : 10 essais par 15 minutes ;
  - au-delà : **429** `{ error: 'Trop de requêtes : réessayez dans quelques minutes.' }`.
- **Lien remplacé** : un jeton révoqué → **410** « Ce lien a été remplacé : utilisez celui du dernier mail reçu. » Un jeton inconnu → 404 « Lien inconnu ou expiré. » (inchangé).
- **Chaque envoi crée un nouveau lien** ✅ : le premier mail, une relance, et « Ouvrir dans ma messagerie » régénèrent tous le lien. L'interface le dit : « Un nouveau lien est créé à chaque envoi ; les liens envoyés avant ne fonctionnent plus. »
- **Variables du message** : `{club}`, `{coach}`, `{competition}`, `{date}` (format JJ/MM/AAAA), `{lieu}`, `{date_limite}` (JJ/MM/AAAA, ou « non précisée »), `{lien}`. Une variable inconnue reste telle quelle.
- **Message par défaut** (copie exacte), objet `Inscriptions — {competition}`, corps :
  ```
  Bonjour {coach},

  Les inscriptions à la compétition « {competition} » ({date}, {lieu}) sont ouvertes.
  Inscrivez les combattants de {club} sur cette page, et revenez-y pour les modifier jusqu'au {date_limite} :
  {lien}

  Ce lien est personnel à votre club : ne le transmettez pas.

  Sportivement,
  Shidokan France
  ```
- **Mention sur les données** (texte par défaut, copie exacte de la conception §8.3, avec `{contact}`). L'adresse de contact est vide par défaut.
  - Tant qu'elle est vide, la section « Inscriptions en ligne » affiche : « Complétez l'adresse de contact de la mention sur les données personnelles (Réglages de l'application) avant d'ouvrir les inscriptions. »
  - La page du club affiche alors la mention sans la phrase de contact.
- **Conservation** : réglages `retentionMonths` (13) et `directoryInactiveYears` (3). On efface **sans avertissement** ✅ :
  - pour une compétition dont la date est passée de `retentionMonths` et qui n'est pas encore effacée :
    - `fighters.weigh_in_kg`, `licence` et `grade` ;
    - `registrations.approx_weight_kg` ;
    - `clubs.coach_phone` et `coach_email` ;
    - les lignes de `club_invitations`, `mail_log` et `uploads` de la compétition ;
    - puis on note `competitions.purged_at` ;
  - pour une fiche de l'annuaire sans aucun club relié à une compétition des `directoryInactiveYears` dernières années, et créée avant cette période : `archived = 1`, et `coach_name`, `coach_phone`, `coach_email`, `notes` vidés ;
  - pour les **sauvegardes** : celles dont la date (dans le nom) est plus ancienne que `retentionMonths` sont supprimées, sauf la plus récente.

  Tout le reste (palmarès) est gardé.
- **Secrets** : le mot de passe SMTP n'est jamais renvoyé par l'API (`hasPassword: boolean` à la place), et il est retiré des sauvegardes, comme les tables `users` et `sessions`.
- Rôle `local` : comportement et tests actuels inchangés. Les écrans de comptes sont masqués, et `GET /api/auth/me` répond `{ role: 'local', user: null }`.
- Tous les tests restent verts : `npm run typecheck && npm test && npm run test:e2e`.

## Review Focus
- **Une route d'organisateur oubliée par la protection** : toute route `/api/*` qui n'est pas publique répond 401 sans session, y compris celles ajoutées plus tard. Test Task 1, qui parcourt toutes les routes enregistrées.
- **Une sauvegarde du serveur restaurée sur le PC, ou l'inverse** : les comptes, les sessions et les réglages SMTP de l'installation qui reçoit restent les siens. Aucun mot de passe ni empreinte de compte dans un fichier de sauvegarde. Test Task 1.
- **Mail en échec pour un club parmi plusieurs** : les autres partent ; le club en erreur affiche « Erreur : … ». Son nouveau lien est quand même créé (l'ancien ne marche plus) ; l'interface le dit, et propose de renvoyer. Test Task 4.
- **Effacement** : une compétition de plus de 13 mois perd poids, licence, grade, coordonnées, liens, mails et fichiers, mais garde ses résultats, ses podiums et ses noms. Une compétition récente n'est pas touchée. Un second passage ne fait rien. Test Task 6.
- **Cookie volé ou session expirée** : une session expirée ou supprimée → 401, et l'interface revient à l'écran de connexion sans perdre de saisie silencieusement : l'avertissement « modifications non enregistrées » existant s'applique. Test Task 1 et e2e Task 7.

---

### Task 1 : Rôle `serveur`, comptes, sessions, protection, limites, sauvegardes sans secrets

**Files:**
- Modify:
  - `src/server/db/schema.ts` : `users` (id, email unique, password_hash, role `'organisateur'`, created_at), `sessions` (id, user_id FK cascade, token_hash unique, created_at, expires_at, last_seen_at), `app_settings` (key pk, value_json, updated_at), `mail_log` (id, competition_id FK cascade, club_id FK cascade, email, sent_at, status `'sent'|'error'`, error, rowMeta), `competitions.purged_at` ;
  - `src/server/app.ts` (`AppOptions.role`, `publicUrl`, `trustProxy`, crochets) ; `src/server/main.ts` ;
  - `src/server/repositories/backups.ts` : tables exclues de la restauration, et secrets retirés de `backupNow` et `freshCopy` ;
  - `tests/server/row-versions.test.ts` : liste des tables globales (`users`, `sessions`, `app_settings`) ; `mail_log` est versionnée.
- Create : `drizzle/0016_comptes_mails.sql` (généré), `src/server/auth/passwords.ts`, `src/server/auth/sessions.ts`, `src/server/auth/guard.ts` (protection, origine, limites), `src/server/routes/auth.ts`, `src/server/cli.ts`.
- Test : `tests/server/auth.test.ts`, `tests/server/backups.test.ts` (ajouts).

**Interfaces:**
- Produces:
  ```ts
  // passwords.ts
  export function hashPassword(password: string): string;             // scrypt$sel$empreinte
  export function verifyPassword(password: string, stored: string): boolean;
  export const MIN_PASSWORD = 10;
  // sessions.ts
  export interface SessionUser { id: string; email: string; role: 'organisateur' }
  export function createSession(db: AppDb, userId: string): string;   // jeton (cookie)
  export function sessionUser(db: AppDb, token: string): SessionUser | null; // expirée → null (et supprimée) ; glisse l'expiration
  export function deleteSession(db: AppDb, token: string): void;
  export function createUser(db: AppDb, email: string, password: string): SessionUser;     // e-mail normalisé en minuscules ; doublon → 409
  export function listUsers(db: AppDb): { id: string; email: string; createdAt: string }[];
  export function deleteUser(db: AppDb, id: string): void;            // supprime aussi ses sessions
  export function changePassword(db: AppDb, userId: string, current: string, next: string): void; // mauvais mot de passe actuel → 400
  // guard.ts
  export type InstanceRole = 'serveur' | 'local';
  export const roleFromEnv: (v: string | undefined) => InstanceRole;
  export function registerGuard(app: FastifyInstance, db: AppDb, role: InstanceRole): void; // onRequest : origine, limites, session (req.user)
  export class RateLimiter { constructor(max: number, windowMs: number); hit(key: string, now?: number): boolean } // false = au-delà
  // routes/auth.ts : GET /api/auth/me → { role, user: { email } | null } (401 en serveur sans session) ;
  //   POST /api/auth/login { email, password } → 204 + Set-Cookie (mauvais identifiants → 401 « E-mail ou mot de passe incorrect. ») ;
  //   POST /api/auth/logout → 204 ; GET|POST /api/users ; DELETE /api/users/:userId (pas soi-même → 400) ; PUT /api/users/me/password
  // cli.ts : `node dist/server/cli.js add-user <email>` (mot de passe demandé deux fois au clavier, sans écho) ; `… list-users` ; `… delete-user <email>`
  // AppOptions : role?: InstanceRole (défaut 'local') ; publicUrl?: string
  ```
- Restauration : tables jamais copiées = `__drizzle_migrations`, `instance`, `change_counter`, `users`, `sessions`, `app_settings`.
- Sauvegardes : après `VACUUM INTO`, sur la copie, `DELETE FROM sessions; DELETE FROM users;` et retrait de `password` dans la valeur `smtp` d'`app_settings`.

- [ ] **Step 1 : tests** (`auth.test.ts`, via `buildApp({ role: 'serveur' })` et `inject`) :
  - `hashPassword / verifyPassword : bon et mauvais mot de passe ; deux empreintes du même mot de passe diffèrent`.
  - `serveur : toutes les routes /api non publiques répondent 401 sans session`. Parcourir les routes enregistrées (`app.printRoutes` ou un `onRoute` qui les collecte), en remplaçant les paramètres par `x`.
  - `serveur : routes publiques accessibles (health, auth/me → 401 mais pas « Connexion requise », auth/login, inscription)`.
  - `connexion : cookie HttpOnly, SameSite=Lax, Secure ; avec le cookie, /api/competitions → 200 ; mauvais mot de passe → 401 ; déconnexion → 401 ensuite`.
  - `session expirée (expires_at passé) → 401 et supprimée`.
  - `écriture avec Origin d'un autre site → 403 ; même hôte → accepté`.
  - `11e essai de connexion en 15 minutes → 429 ; RateLimiter : fenêtre glissante`.
  - `comptes : création (mot de passe < 10 → 400, e-mail en double → 409), liste sans empreinte, suppression (soi-même → 400), changement de mot de passe`.
  - `local : aucune connexion demandée ; /api/auth/me → { role: 'local', user: null }`.
  - `backups.test.ts` :
    - `une sauvegarde ne contient ni compte, ni session, ni mot de passe SMTP` ;
    - `restaurer une sauvegarde d'une autre installation ne touche pas aux comptes, aux sessions ni aux réglages de l'installation`.
- [ ] **Step 2 : lancer les tests**, qui doivent échouer : `npx vitest run tests/server/auth.test.ts tests/server/backups.test.ts`. Attendu : FAIL.
- [ ] **Step 3 : écrire le schéma**, puis lancer `npx drizzle-kit generate --name comptes_mails` et relire le SQL.
- [ ] **Step 4 : écrire les modules `auth/*`**, les routes, le CLI, les crochets, et modifier les sauvegardes. Dans `main.ts` : `role: roleFromEnv(process.env.INSTANCE_ROLE)` et `publicUrl: process.env.PUBLIC_URL`.
- [ ] **Step 5 : lancer les tests**, qui doivent passer : `npx vitest run tests/server && npm run typecheck`.
- [ ] **Step 6 : commit** : `feat(mise en ligne): rôle serveur — comptes, sessions, protection des routes, origine, limites ; sauvegardes sans secrets`

### Task 2 : Écrans de connexion et de comptes

**Files:**
- Create : `src/web/pages/LoginPage.tsx`, `src/web/pages/AccountsPage.tsx`, `src/web/useAuth.ts`
- Modify :
  - `src/web/App.tsx` : `MainShell` passe par `AuthGate` (l'écran de connexion tant que `GET /api/auth/me` répond 401) ; route `/comptes` ;
  - `src/web/components/AppHeader.tsx` : en rôle serveur, l'e-mail, « Comptes » et « Se déconnecter » ;
  - `src/web/api.ts` : `useAuthMe`, `useLogin`, `useLogout`, `useUsers`, `useCreateUser`, `useDeleteUser`, `useChangePassword`. Toute réponse 401 « Connexion requise. » invalide `['auth']`, ce qui ramène à l'écran de connexion ;
  - `src/web/help.ts` : sujet `comptes`.
- Test : `tests/web/help.test.ts` (sujet `comptes`), e2e en Task 7.

- [ ] **Step 1 : test** dans `tests/web/help.test.ts` : `comptes : l'aide parle du mot de passe d'au moins 10 caractères et de la commande add-user`. Le test doit échouer.
- [ ] **Step 2 : écrire les écrans et les hooks.** Écran de connexion : E-mail, Mot de passe, bouton « Se connecter », et l'erreur affichée. Écran Comptes : liste ; ajout (E-mail, Mot de passe) ; « Supprimer » (avec confirmation, pas pour soi) ; « Changer mon mot de passe ».
- [ ] **Step 3 : vérifier** : `npm run typecheck && npx vitest run tests/web`.
- [ ] **Step 4 : commit** : `feat(mise en ligne): écrans de connexion et de comptes`

### Task 3 : Réglages de l'application (SMTP, mention, conservation, message par défaut)

**Files:**
- Create : `src/server/repositories/app-settings.ts`, `src/server/routes/app-settings.ts`, `src/domain/app-settings.ts` (types, valeurs par défaut, textes exacts), `src/web/pages/AppSettingsPage.tsx`
- Modify : `src/server/app.ts`, `src/web/App.tsx` (route `/parametres`), `src/web/components/AppHeader.tsx` (lien « Réglages de l'application »), `src/web/api.ts`, `src/web/help.ts` (sujet `parametres`, avec l'aide Gmail)
- Test : `tests/server/app-settings.test.ts`, `tests/web/help.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // domain/app-settings.ts
  export interface SmtpSettings { host: string; port: number; security: 'tls' | 'starttls' | 'none'; user: string; password: string | null; fromName: string; fromEmail: string }
  export interface MailTemplate { subject: string; body: string }
  export interface AppSettings {
    smtp: SmtpSettings | null;
    privacyNotice: string;          // avec {contact}
    privacyContact: string;         // '' par défaut
    retentionMonths: number;        // 13
    directoryInactiveYears: number; // 3
    invitationMail: MailTemplate;   // message par défaut (Global Constraints)
  }
  export const DEFAULT_APP_SETTINGS: AppSettings;
  export type PublicAppSettings = Omit<AppSettings, 'smtp'> & { smtp: (Omit<SmtpSettings, 'password'> & { hasPassword: boolean }) | null };
  // repository
  export function getAppSettings(db: AppDb): AppSettings;              // valeurs par défaut complétées
  export function publicAppSettings(s: AppSettings): PublicAppSettings;
  export function updateAppSettings(db: AppDb, patch: Partial<AppSettings>): AppSettings; // smtp.password null ou absent = inchangé ; '' = effacé
  // routes : GET /api/app-settings → PublicAppSettings ; PATCH /api/app-settings ; POST /api/app-settings/test-mail { to } (Task 4)
  ```
- L'écran : quatre blocs.
  - « Envoi des mails » : les champs SMTP. Le mot de passe a pour indication « laisser vide pour garder le mot de passe enregistré ». On y trouve aussi « Envoyer un mail d'essai » et l'aide Gmail : validation en deux étapes, mot de passe d'application, `smtp.gmail.com`, port 465, TLS.
  - « Message aux clubs » : objet et texte, avec la liste des variables.
  - « Données personnelles » : texte de la mention et adresse de contact.
  - « Conservation » : nombre de mois et nombre d'années.

- [ ] **Step 1 : tests** (`app-settings.test.ts`) :
  - `valeurs par défaut (textes exacts)` ;
  - `enregistrement partiel` ;
  - `le mot de passe SMTP n'est jamais renvoyé (hasPassword) ; absent = gardé ; '' = effacé` ;
  - `retentionMonths ≥ 1, directoryInactiveYears ≥ 1 ; port 1..65535` ;
  - et `tests/web/help.test.ts` : `parametres : aide Gmail (mot de passe d'application)`.
- [ ] **Step 2 : lancer les tests**, qui doivent échouer : `npx vitest run tests/server/app-settings.test.ts tests/web/help.test.ts`.
- [ ] **Step 3 : écrire le code.**
- [ ] **Step 4 : lancer les tests**, qui doivent passer : `npx vitest run tests/server tests/web && npm run typecheck`.
- [ ] **Step 5 : commit** : `feat(mise en ligne): réglages de l'application — SMTP, mention sur les données, conservation, message aux clubs`

### Task 4 : Envoi des liens par mail

**Files:**
- Create : `src/domain/mail-template.ts`, `src/server/mail.ts`
- Modify :
  - `src/server/repositories/invitations.ts` : `resolveInvitation` distingue le lien révoqué ; `listInvitations` ajoute le dernier envoi ;
  - `src/server/routes/invitations.ts` et `src/server/routes/club-entry.ts` (410) ;
  - `src/domain/settings.ts` : réglage de compétition `invitationMail: MailTemplate | null`, `null` = message de l'application ;
  - `src/server/app.ts` : `AppOptions.mailTransport` ;
  - `package.json` : `nodemailer` et `@types/nodemailer`.
- Test : `tests/domain/mail-template.test.ts`, `tests/server/mail.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // domain/mail-template.ts
  export interface MailValues { club: string; coach: string; competition: string; date: string; lieu: string; date_limite: string; lien: string }
  export function renderTemplate(text: string, values: MailValues): string;
  // server/mail.ts
  export type MailTransport = (smtp: SmtpSettings) => { sendMail(m: { from: string; to: string; subject: string; text: string }): Promise<unknown> };
  export const nodemailerTransport: MailTransport;   // host, port, secure = security === 'tls', requireTLS = security === 'starttls'
  export interface SendResult { clubId: string; clubName: string; email: string | null; status: 'sent' | 'error'; error: string | null }
  // routes :
  //   POST /api/competitions/:id/invitations/send { clubIds } → SendResult[]  (pour chaque club : nouveau lien, message rendu, envoi, ligne de mail_log ;
  //        club sans e-mail → status error « Pas d'e-mail pour ce club. », sans nouveau lien ; pause de 300 ms entre deux envois)
  //   POST /api/competitions/:id/invitations/:clubId/mailto → { to: string | null; subject: string; body: string } (nouveau lien)
  //   GET  /api/competitions/:id/invitations/preview?clubId= → { subject, body } avec « {lien} » laissé visible (aucun lien créé)
  //   POST /api/app-settings/test-mail { to } → 204 ou 400 avec le message d'erreur SMTP
  //   sans SMTP réglé → 400 « Réglez l'envoi des mails dans les Réglages de l'application. »
  // ClubInvitationRow + lastMail: { sentAt: string; status: 'sent' | 'error'; error: string | null } | null
  ```
- Le message utilisé est celui de la compétition (`settings.invitationMail`), sinon celui de l'application. Le `{lien}` vient de `publicUrl`, sinon de l'origine de la requête, suivi de `/inscription/<jeton>`.

- [ ] **Step 1 : tests**
  - `mail-template.test.ts` : `remplace toutes les variables ; variable inconnue laissée ; message par défaut rendu exactement`.
  - `mail.test.ts` (transport factice qui note les mails et peut échouer pour une adresse) :
    - `envoi à deux clubs : deux mails (expéditeur « Nom <adresse> », objet et texte rendus, lien neuf qui fonctionne), deux lignes de mail_log, l'ancien lien → 410 « Ce lien a été remplacé… »` ;
    - `un club en erreur : les autres partent ; résultat et lastMail = error avec le message` ;
    - `club sans e-mail → error « Pas d'e-mail pour ce club. », son lien n'est pas changé` ;
    - `sans réglage SMTP → 400` ;
    - `mailto : to, objet et corps avec un lien neuf` ;
    - `aperçu : rien n'est créé` ;
    - `message propre à la compétition utilisé quand il existe` ;
    - `mail d'essai : envoyé au destinataire ; erreur SMTP → 400 avec son message` ;
    - `jeton inconnu → 404, révoqué → 410`.
- [ ] **Step 2 : lancer les tests**, qui doivent échouer : `npx vitest run tests/domain/mail-template.test.ts tests/server/mail.test.ts`.
- [ ] **Step 3 : installer la dépendance** : `npm install nodemailer && npm install -D @types/nodemailer`. Puis écrire le code.
- [ ] **Step 4 : lancer les tests**, qui doivent passer : `npx vitest run tests/server tests/domain && npm run typecheck`.
- [ ] **Step 5 : commit** : `feat(mails): envoi du lien de chaque club par mail (nouveau lien à chaque envoi), aperçu, mailto, journal`

### Task 5 : Écrans : envoi depuis la Fiche club, mention sur la page du club

**Files:**
- Modify :
  - `src/web/components/OnlineEntryPanel.tsx` :
    - colonne « Dernier mail » : « Envoyé le … » ou « Erreur : … » ;
    - case par club invité, et filtres « Jamais envoyé », « Sans combattant », « Avec e-mail » ;
    - bouton « Envoyer le lien par mail » pour les clubs cochés, avec confirmation qui reprend la phrase des Global Constraints sur le nouveau lien. Le résultat s'affiche par club ;
    - par club : « Ouvrir dans ma messagerie » (ouvre `mailto:` avec le résultat de la route mailto) ;
    - bloc repliable « Message aux clubs de cette compétition » : objet et texte, initialisés depuis l'application. Il comprend « Enregistrer pour cette compétition », « Revenir au message de l'application » et un aperçu pour le premier club coché ;
    - l'alerte « Complétez l'adresse de contact… » quand `privacyContact` est vide.
  - `src/web/pages/ClubEntryPage.tsx` : la mention en bas de page, et le message 410 ;
  - `src/server/repositories/club-entry.ts` : `ClubEntryView.privacyNotice: string`, texte rendu (`{contact}` remplacé ; sans contact, la dernière phrase est retirée) ;
  - `src/web/api.ts`.
- Test : `tests/server/club-entry.test.ts` (ajout : `la vue contient la mention rendue ; sans contact, pas de phrase de contact`). e2e en Task 7.

- [ ] **Step 1 : test serveur** de la mention. Il doit échouer.
- [ ] **Step 2 : écrire les écrans.**
- [ ] **Step 3 : vérifier** : `npm run typecheck && npx vitest run tests/server/club-entry.test.ts`.
- [ ] **Step 4 : commit** : `feat(mails): envoi depuis la Fiche club ; mention sur les données personnelles sur la page du club`

### Task 6 : Effacement automatique (conservation)

**Files:**
- Create : `src/server/repositories/retention.ts`
- Modify : `src/server/app.ts` (au démarrage, puis toutes les 24 h ; arrêté par `onClose`), `src/server/repositories/backups.ts` (`pruneOldBackups(dbPath, months, now)`)
- Test : `tests/server/retention.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface PurgeReport { competitions: number; directoryEntries: number; backups: number }
  /** Efface ce qui a dépassé les délais de conservation (Global Constraints). Idempotente. */
  export function purgeExpiredData(db: AppDb, dbPath: string, now?: Date): PurgeReport;
  export function startRetention(db: AppDb, dbPath: string, onError: (e: unknown) => void): () => void;
  ```

- [ ] **Step 1 : tests** (`retention.test.ts`, dates fixées par `now`) :
  - `compétition de plus de 13 mois : poids, licence, grade, coordonnées du club, liens, mails et fichiers effacés ; noms, résultats, notes de kata, tableaux et catégories gardés ; purged_at noté` ;
  - `compétition de 12 mois : rien` ;
  - `second passage : rien (purged_at)` ;
  - `annuaire : fiche sans compétition depuis 3 ans → archivée, coordonnées et notes vidées ; fiche avec une compétition récente → intacte ; fiche créée il y a moins de 3 ans sans compétition → intacte` ;
  - `sauvegardes plus anciennes que 13 mois supprimées, sauf la plus récente` ;
  - `délais réglés à 24 mois : rien d'effacé à 13 mois`.
- [ ] **Step 2 : lancer les tests**, qui doivent échouer : `npx vitest run tests/server/retention.test.ts`.
- [ ] **Step 3 : écrire `retention.ts` et `pruneOldBackups`**, puis les brancher dans `app.ts`.
- [ ] **Step 4 : lancer les tests**, qui doivent passer : `npx vitest run tests/server && npm run typecheck`.
- [ ] **Step 5 : commit** : `feat(données): effacement automatique des données d'organisation après 13 mois (palmarès gardé), annuaire inactif, vieilles sauvegardes`

### Task 7 : Parcours e2e en rôle serveur, déploiement, documents

**Files:**
- Create : `tests/e2e/serveur.spec.ts`, `playwright.config.ts` (un second `webServer` en rôle `serveur` sur le port 3101, avec sa propre base et un compte créé par le CLI au démarrage, et un projet qui lui est propre)
- Modify : `deploy/compose.yaml` (`INSTANCE_ROLE=serveur`, `PUBLIC_URL=https://competitions.shidokanfrance.com`), `deploy/Caddyfile` (sans `basic_auth`, domaine `competitions.shidokanfrance.com`), `docs/installation-serveur.md`, `README.md`, `docs/superpowers/plans/2026-10-21-00-feuille-de-route.md`, `docs/superpowers/plans/2026-10-21-99-bilan.md`
- La procédure d'installation doit couvrir :
  - l'installation de Docker sur Ubuntu (dépôt officiel, `docker-ce` et `docker-compose-plugin`) ;
  - la création du premier compte : `docker compose exec -it app node dist/server/cli.js add-user <e-mail>` ;
  - le réglage de Gmail : validation en deux étapes, mot de passe d'application ;
  - l'adresse de contact de la mention ;
  - la sauvegarde hors du serveur.

  Elle signale aussi qu'une **restauration** sur un nouveau serveur ne remet pas les comptes : il faut les recréer avec le CLI.

- [ ] **Step 1 : e2e** `serveur : connexion obligatoire, puis les écrans habituels ; déconnexion ; la page d'un club s'ouvre sans connexion` : écran de connexion, mauvais mot de passe (message), bon mot de passe, liste des compétitions, « Se déconnecter » (retour à la connexion), puis `/inscription/inconnu` qui affiche « Lien inconnu ou expiré. » sans connexion.
- [ ] **Step 2 : lancer toute la suite**, qui doit passer : `npm run typecheck && npm test && npm run test:e2e`.
- [ ] **Step 3 : documents et fichiers de déploiement**, puis vérification locale de `deploy/` avec l'image construite localement : connexion par Caddy, envoi d'un mail d'essai vers un transport factice si possible, sinon sauter cette vérification et le noter.
- [ ] **Step 4 : commit** : `test(e2e): rôle serveur ; déploiement : rôle serveur derrière Caddy, procédure Ubuntu, premier compte, Gmail ; docs : étape 17`
