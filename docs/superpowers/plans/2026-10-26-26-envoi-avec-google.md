# Envoi des mails avec un compte Google — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** dans Réglages de l'application → Envoi des mails, « Se connecter avec Google » remplace le mot de passe d'application. L'application n'a que le droit d'envoyer (`gmail.send`), et l'envoi passe par l'API Gmail.

**Architecture:** un petit client Google (`src/server/google/client.ts`, `fetch` seulement) gère l'autorisation OAuth, le renouvellement du jeton d'accès, la révocation et l'envoi d'un message MIME brut. Le message est construit par nodemailer (`streamTransport`). Les réglages gagnent deux clés `app_settings` : `mailMode` et `google`. La clé `smtp` existante n'est pas touchée, donc il n'y a pas de migration. `MailTransport` reçoit un `MailSender` (`smtp` ou `google`) au lieu d'un `SmtpSettings`. `sendInvitations` s'arrête si l'accès Google est retiré en cours d'envoi. Une tâche de fond renouvelle l'accès tous les 30 jours.

**Tech Stack:** TypeScript 7 natif, Fastify 5, Drizzle + better-sqlite3, nodemailer 10, React 19 + Mantine 8 + TanStack Query v5, Vitest, Playwright (Chrome).

**Spec:** `docs/superpowers/specs/2026-10-26-envoi-avec-google-design.md`

## Global Constraints

- Aucune dépendance nouvelle (pas de `googleapis`) et aucune migration : seulement de nouvelles clés dans `app_settings`.
- Autorisations demandées, exactement : `openid email https://www.googleapis.com/auth/gmail.send`. Jamais `https://mail.google.com/`.
- Adresses de Google :
  - autorisation `https://accounts.google.com/o/oauth2/v2/auth` ;
  - jetons `https://oauth2.googleapis.com/token` ;
  - révocation `https://oauth2.googleapis.com/revoke` ;
  - envoi `https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media` (`Content-Type: message/rfc822`).
- Paramètres de l'autorisation : `response_type=code`, `access_type=offline`, `prompt=consent`, `state`.
- Adresse de retour : `${PUBLIC_URL sans / final}/api/app-settings/google/callback`.
- Variables d'environnement : `GOOGLE_CLIENT_ID` et `GOOGLE_CLIENT_SECRET`. Le mode Google est disponible si et seulement si ces deux variables **et** `PUBLIC_URL` sont définies (quel que soit le rôle).
- Le code secret et le jeton de renouvellement ne sont jamais renvoyés au navigateur, ni écrits dans les journaux ou dans une sauvegarde.
- Textes exacts (constantes exportées par `src/domain/app-settings.ts`) :
  - `GOOGLE_RECONNECT` = « L’accès au compte Google a été retiré ou a expiré. Reconnectez-vous dans les Réglages de l’application. »
  - `GOOGLE_NOT_CONFIGURED` = « Le compte Google n’est plus configuré sur le serveur (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET). »
  - `GOOGLE_NOT_SENT` = « Non envoyé : accès au compte Google retiré. Reconnectez-vous, puis relancez l’envoi pour ce club. »
  - `GOOGLE_CONNECT_FIRST` = « Connectez d’abord un compte Google. »
- Textes de l'écran :
  - choix « Compte Google » / « Autre serveur (identifiant et mot de passe) » ;
  - boutons « Se connecter avec Google », « Se reconnecter », « Déconnecter » ;
  - « Connecté : {email} » ;
  - aide « Google affichera « application non validée » : cliquez sur Paramètres avancés, puis Accéder. L’application ne pourra qu’envoyer des mails, pas les lire. »
- Interface en français, apostrophe typographique ’ dans les textes affichés, couleurs par les jetons `--sk-*`.
- Ne jamais ouvrir `data/shidokan.sqlite` depuis l'hôte (les tests utilisent `tmpDbPath()`). Ne pas pousser, ne pas fusionner, ne pas reconstruire Docker.
- Vérifications : `npm run typecheck`, `npm test`, `npx playwright test`.

## Review Focus

- L'organisateur décoche « envoyer des mails » sur l'écran de consentement de Google (Google laisse décocher chaque autorisation) : la connexion est refusée avec `?google=envoi-refuse`, et rien n'est enregistré (test en Task 3).
- Une reconnexion avec un autre compte Google : l'ancien jeton est révoqué, l'adresse et le jeton sont remplacés, et le nom de l'expéditeur est gardé (test en Task 3).
- Un retour de Google arrivé après 10 minutes, rejoué une seconde fois ou venu d'une autre session : refusé avec `?google=expire`, et rien n'est enregistré (test en Task 3).
- Un jeton d'accès expiré entre deux mails d'un même envoi groupé (Gmail répond 401) : renouvelé une fois puis renvoyé, sans compter comme un retrait d'accès (test en Task 2).
- L'accès retiré en plein envoi groupé : le club en cours et les suivants sont notés `GOOGLE_NOT_SENT`, aucun nouveau lien ne reste actif pour eux, et l'état passe à « à reconnecter » (test en Task 4).

---

### Task 1: Réglages — mode d'envoi et compte Google (modèle, stockage, sauvegardes)

**Files:**
- Modify: `src/domain/app-settings.ts`
- Modify: `src/server/repositories/app-settings.ts`
- Modify: `src/server/routes/app-settings.ts` (signature de `publicAppSettings` ; `googleAvailable` vaut `false` jusqu'à la Task 3)
- Modify: `src/server/repositories/backups.ts` (`stripSecrets`)
- Test: `tests/server/app-settings.test.ts`, `tests/server/backups.test.ts`

**Interfaces:**
- Produces (domaine) :
  ```ts
  export type MailMode = 'smtp' | 'google';
  export interface GoogleSender { email: string; fromName: string; refreshToken: string; status: 'ok' | 'reconnect'; lastRefreshAt: string | null }
  export type PublicGoogleSender = Omit<GoogleSender, 'refreshToken'>;
  // AppSettings gagne : mailMode: MailMode (défaut 'smtp') ; google: GoogleSender | null (défaut null)
  // PublicAppSettings = Omit<AppSettings, 'smtp' | 'google'> & { smtp: PublicSmtpSettings | null; google: PublicGoogleSender | null; googleAvailable: boolean }
  // appSettingsPatchSchema gagne : mailMode: z.enum(['smtp','google']) ; googleFromName: z.string().trim().min(1).max(120)
  export const GOOGLE_RECONNECT, GOOGLE_NOT_CONFIGURED, GOOGLE_NOT_SENT, GOOGLE_CONNECT_FIRST: string; // textes des Global Constraints
  ```
- Produces (dépôt) :
  - `publicAppSettings(full: AppSettings, googleAvailable: boolean): PublicAppSettings` ;
  - `setGoogleSender(db: AppDb, google: GoogleSender | null, mailMode: MailMode): AppSettings` ;
  - `markGoogleRevoked(db: AppDb): void` (`status = 'reconnect'`, sans effet si `google` est null) ;
  - `markGoogleRefreshed(db: AppDb, at: string): void` (`lastRefreshAt = at`, `status = 'ok'`).
  - `updateAppSettings` accepte `mailMode` et `googleFromName`. Avec `google` null, `mailMode: 'google'` ou `googleFromName` lèvent une erreur `statusCode = 400` de message `GOOGLE_CONNECT_FIRST`. `googleFromName` modifie `google.fromName` et n'est jamais stocké comme une clé à part.

- [ ] **Step 1: Write the failing tests** (`tests/server/app-settings.test.ts`)

```ts
test('mode d’envoi : SMTP par défaut, pas de compte Google, Google indisponible sans configuration', async () => {
  const s = (await app.inject({ method: 'GET', url: '/api/app-settings' })).json();
  expect(s).toMatchObject({ mailMode: 'smtp', google: null, googleAvailable: false });
});
test('mode Google ou nom d’expéditeur Google sans compte connecté → 400 « Connectez d’abord un compte Google. »', async () => {
  for (const payload of [{ mailMode: 'google' }, { googleFromName: 'X' }]) {
    const r = await app.inject({ method: 'PATCH', url: '/api/app-settings', payload });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe('Connectez d’abord un compte Google.');
  }
});
test('un réglage smtp enregistré avant (sans mode) se lit comme du SMTP', async () => { /* PATCH { smtp: SMTP } puis GET → mailMode 'smtp', smtp.host conservé */ });
```
Dans `tests/server/backups.test.ts`, étendre « une sauvegarde ne contient ni compte, ni session, ni mot de passe SMTP » : insérer aussi la ligne `('google', {"email":"x@gmail.com","fromName":"X","refreshToken":"SECRET-GOOGLE","status":"ok","lastRefreshAt":null})`. Vérifier que `SECRET-GOOGLE` n'apparaît ni dans `app_settings` ni dans le fichier, et que `x@gmail.com` reste.

- [ ] **Step 2: Run** `npx vitest run tests/server/app-settings.test.ts tests/server/backups.test.ts`. Expected: FAIL (`mailMode` absent, `SECRET-GOOGLE` présent).
- [ ] **Step 3: Implement**
  - les types, les valeurs par défaut (`mailMode: 'smtp'`, `google: null`) et le schéma dans le domaine ;
  - les fonctions du dépôt ;
  - dans `stripSecrets`, `json_remove(value_json, '$.refreshToken') WHERE key = 'google'`, sur le modèle de `smtp.password`.

  `publicAppSettings` retire `refreshToken`. La route GET/PATCH passe `googleAvailable` (pour l'instant `false`, câblé en Task 3).
- [ ] **Step 4: Run** the same tests plus `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(mails): réglages — mode d’envoi et compte Google`

---

### Task 2: Client Google (autorisation, jetons, révocation, envoi)

**Files:**
- Create: `src/server/google/client.ts`
- Create: `tests/helpers/fake-google.ts`
- Test: `tests/server/google-client.test.ts`

**Interfaces:**
- Produces :
  ```ts
  export const GOOGLE_SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/gmail.send'] as const;
  export const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
  export class GoogleAccessRevokedError extends Error {} // réponse invalid_grant au renouvellement
  export interface GoogleConfig { clientId: string; clientSecret: string; redirectUri: string; fetch?: typeof fetch }
  export interface GoogleClient {
    authUrl(state: string): string;
    exchangeCode(code: string): Promise<{ refreshToken: string; email: string; scopes: string[] }>;
    accessToken(refreshToken: string, opts?: { force?: boolean }): Promise<string>; // gardé en mémoire jusqu'à expires_in − 60 s
    revoke(token: string): Promise<boolean>; // false si Google ou le réseau échoue, ne lève jamais
    sendRaw(refreshToken: string, mime: Buffer): Promise<void>;
  }
  export function googleConfigFrom(o: { clientId?: string; clientSecret?: string; publicUrl?: string; fetch?: typeof fetch }): GoogleConfig | null;
  export function googleClient(config: GoogleConfig): GoogleClient;
  ```
- Produces (tests) : `fakeGoogle()` dans `tests/helpers/fake-google.ts` renvoie :
  - `fetch` : faux `fetch` qui aiguille selon l'URL (jetons, révocation, envoi) ;
  - des réglages : `grantedScopes`, `email`, `revokeAfterSends: number | null`, `expireAccessOnce: boolean`, `revokeFails: boolean` ;
  - des relevés : `sent: Buffer[]`, `revoked: string[]`, `refreshCount`.

  `id_token` est un JWT non signé (`header.payload.sig`, en base64url) dont le contenu porte `email`.

- [ ] **Step 1: Write the failing tests**
  - `authUrl` contient `client_id`, `redirect_uri`, `response_type=code`, `access_type=offline`, `prompt=consent`, `state`, et un `scope` égal à `GOOGLE_SCOPES.join(' ')`.
  - `googleConfigFrom` renvoie `null` s'il manque l'une des trois valeurs. Sinon, `redirectUri === 'https://x.org/api/app-settings/google/callback'` pour `publicUrl: 'https://x.org/'`.
  - `exchangeCode` renvoie `{ refreshToken, email: 'orga@gmail.com', scopes }`. Il lève une erreur si Google ne renvoie pas de `refresh_token`.
  - `accessToken` : deux appels ne font qu'un renouvellement (`refreshCount === 1`) ; `force: true` en refait un ; une réponse `{ error: 'invalid_grant' }` (400) lève `GoogleAccessRevokedError`.
  - `sendRaw` envoie le `Buffer` tel quel avec `Authorization: Bearer …` et `Content-Type: message/rfc822`.
  - Si `expireAccessOnce` est vrai, le premier envoi reçoit 401 : un renouvellement forcé et un second envoi suivent, sans erreur, et `sent.length === 1`.
  - Une autre erreur Gmail (403 `{ error: { message: 'Quota' } }`) lève `Error` dont le message contient `403` et `Quota`.
  - `revoke` renvoie `true` et note le jeton. Avec `revokeFails`, il renvoie `false` sans lever.
- [ ] **Step 2: Run** `npx vitest run tests/server/google-client.test.ts`. Expected: FAIL (module absent).
- [ ] **Step 3: Implement** `googleClient` avec `config.fetch ?? fetch` et des corps `application/x-www-form-urlencoded` pour les jetons et la révocation. L'adresse est lue dans le contenu de l'`id_token` (reçu directement de Google en HTTPS, pas besoin de vérifier la signature). Les scopes viennent du champ `scope` de la réponse, séparés par des espaces.
- [ ] **Step 4: Run** the test file and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(mails): client Google (autorisation, jetons, envoi Gmail)`

---

### Task 3: Connexion — routes, retour de Google, déconnexion, configuration

**Files:**
- Create: `src/server/routes/google.ts`
- Modify: `src/server/app.ts` (`AppOptions.google`, création du client, enregistrement des routes, `googleAvailable`)
- Modify: `src/server/routes/app-settings.ts` (reçoit `googleAvailable: boolean`)
- Modify: `src/server/main.ts` (lit `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`)
- Modify: `deploy/compose.yaml` (les deux lignes en commentaire : `# - GOOGLE_CLIENT_ID=…  # voir docs/installation-serveur.md`)
- Test: `tests/server/google-routes.test.ts` ; ajouter `connectGoogle(app, fake)` à `tests/helpers/fake-google.ts`

**Interfaces:**
- Consumes : Task 1 (`setGoogleSender`, `getAppSettings`, `publicAppSettings`) et Task 2 (`googleClient`, `googleConfigFrom`, `GMAIL_SEND_SCOPE`).
- Produces :
  - `AppOptions.google?: { clientId: string; clientSecret: string; fetch?: typeof fetch }` ;
  - dans `buildApp`, `const google: GoogleClient | null` (null sans `publicUrl`), transmis aux Tasks 4 et 5 ;
  - routes, enregistrées seulement si `google` existe :
    - `POST /api/app-settings/google/start`, corps vide → `{ url: string }` ;
    - `GET /api/app-settings/google/callback?code&state&error` → redirection 302 vers `/parametres?google=<résultat>#mails`, avec `<résultat>` parmi `connecte | annule | envoi-refuse | expire | erreur` ;
    - `POST /api/app-settings/google/disconnect` → `{ revoked: boolean }`.
  - `connectGoogle(app, fake, headers?)` : appelle `start`, lit `state` dans l'URL, appelle `callback?code=c&state=…`, et renvoie la réponse du retour.

  Le `state` fait 32 octets aléatoires en base64url. Il est gardé en mémoire avec l'id de l'utilisateur (`req.user?.id ?? null`), vaut 10 minutes et sert une seule fois.

  Un retour accepté :
  - garde `fromName` (celui du compte Google déjà connecté, sinon `smtp.fromName`, sinon « Shidokan France ») ;
  - enregistre `{ email, refreshToken, status: 'ok', lastRefreshAt: now }` avec `mailMode: 'google'` ;
  - puis révoque l'ancien jeton s'il y en avait un (sans attendre le résultat).

  `disconnect` révoque le jeton chez Google, enregistre `google: null` et `mailMode: 'smtp'`, et renvoie le résultat de la révocation.

- [ ] **Step 1: Write the failing tests** (`buildApp({ dbPath, publicUrl: 'https://competitions.example.org', google: { clientId: 'id', clientSecret: 'SECRET-CLIENT', fetch: fake.fetch } })`)
  - **Connexion réussie** : réponse 302 vers `/parametres?google=connecte#mails`. Le GET des réglages renvoie `googleAvailable: true`, `mailMode: 'google'` et `google.email === 'orga@gmail.com'`. Le JSON ne contient ni `refreshToken`, ni le jeton, ni `SECRET-CLIENT`.
  - **Sans `google` ou sans `publicUrl`** : `googleAvailable: false`, et `POST /google/start` renvoie 404.
  - **`state` refusé** : un `state` inconnu, rejoué une seconde fois, ou de plus de 10 minutes (`vi.useFakeTimers`, `vi.advanceTimersByTime(10 * 60_000 + 1)`) donne `?google=expire`. `google` reste null.
  - **Annulation** : `callback?error=access_denied&state=…` donne `?google=annule`, rien n'est enregistré.
  - **Autorisation d'envoi décochée** : `grantedScopes` sans gmail.send donne `?google=envoi-refuse`. Rien n'est enregistré et le jeton reçu est révoqué (`fake.revoked`).
  - **Reconnexion avec un autre compte** : `fake.email = 'autre@gmail.com'`, après un `PATCH { googleFromName: 'Club X' }`. L'adresse change, `fromName` reste « Club X », et l'ancien jeton figure dans `fake.revoked`.
  - **Déconnexion** : renvoie `{ revoked: true }` puis `google: null` et `mailMode: 'smtp'`. Avec `revokeFails`, elle renvoie `{ revoked: false }` et efface quand même.
  - **Rôle serveur** : un `state` créé par un organisateur et utilisé avec le cookie d'un autre organisateur donne `?google=expire`.
- [ ] **Step 2: Run** `npx vitest run tests/server/google-routes.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** les routes et le câblage dans `buildApp` et `main.ts` (`google: process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET ? { clientId, clientSecret } : undefined`). Une erreur de Google à l'échange du code est notée dans le journal sans le code ni les jetons, et donne `?google=erreur`.
- [ ] **Step 4: Run** the test file, `tests/server/app-settings.test.ts` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(mails): se connecter avec Google (autorisation, retour, déconnexion)`

---

### Task 4: Envoi par Gmail, et arrêt si l'accès est retiré

**Files:**
- Modify: `src/server/mail.ts`
- Modify: `src/server/app.ts` (`mailTransport = opts.mailTransport ?? defaultMailTransport(google)`)
- Test: `tests/server/mail.test.ts` (faux transport adapté), `tests/server/google-mail.test.ts`

**Interfaces:**
- Consumes : Task 1 (`markGoogleRevoked`, les constantes de texte), Task 2 (`GoogleClient`, `GoogleAccessRevokedError`) et Task 3 (`connectGoogle`, `AppOptions.google`).
- Produces :
  ```ts
  export type MailSender = { kind: 'smtp'; smtp: SmtpSettings } | { kind: 'google'; google: GoogleSender };
  export type MailTransport = (sender: MailSender) => { verify?(): Promise<unknown>; sendMail(m: OutgoingMail): Promise<unknown> };
  export function defaultMailTransport(google: GoogleClient | null): MailTransport;
  ```
  - `nodemailerTransport` n'est plus exporté et devient la branche `smtp`.
  - La branche `google` :
    - `verify()` = `accessToken(refreshToken, { force: true })` ;
    - `sendMail()` construit le MIME avec `nodemailer.createTransport({ streamTransport: true, buffer: true }).sendMail(...)` (`info.message`), puis appelle `sendRaw`.
    - Avec `google === null`, `verify` et `sendMail` lèvent `Error(GOOGLE_NOT_CONFIGURED)`.
  - `smtpOf` devient `senderOf(db): MailSender` :
    - `mailMode === 'google'` donne le compte Google, si `status === 'reconnect'` → `MailError(GOOGLE_RECONNECT)` ;
    - sinon la configuration SMTP, comme avant ;
    - `fromOf(sender)` vaut `{ name: google.fromName, address: google.email }` en mode Google.
  - `sendInvitations` :
    - `GoogleAccessRevokedError` à la vérification → `markGoogleRevoked` puis `MailError('Envoi impossible, aucun lien n’a changé : ' + GOOGLE_RECONNECT)` ;
    - pendant la boucle → le club en cours suit le chemin d'erreur actuel (nouveau lien désactivé) avec l'erreur `GOOGLE_NOT_SENT`, puis `markGoogleRevoked` ;
    - chaque club **suivant** reçoit `GOOGLE_NOT_SENT` dans les résultats et dans `mailLog`, sans création de lien.
  - `sendTestMail` : `GoogleAccessRevokedError` → `markGoogleRevoked` puis `MailError(GOOGLE_RECONNECT)`.

- [ ] **Step 1: Write the failing tests** (`tests/server/google-mail.test.ts`, appli avec `google` + `fakeGoogle`, sans `mailTransport` injecté, donc le vrai `defaultMailTransport`)
  - **Mail d'essai** : un message dans `fake.sent`, dont le MIME contient `From: "Shidokan France" <orga@gmail.com>` et `Subject:`.
  - **Envoi groupé à deux clubs** : deux messages, chacun avec les deux pièces jointes (`fiche-club-2026-11-22.pdf`, `fiche-club-2026-11-22.ods`), et les nouveaux liens qui fonctionnent.
  - **Accès retiré avant l'envoi** (`revokeAfterSends: 0`) : réponse 400 avec l'erreur `Envoi impossible, aucun lien n’a changé : L’accès au compte Google a été retiré…`. Aucun message, les anciens liens fonctionnent, et le GET des réglages renvoie `google.status === 'reconnect'`.
  - **Accès retiré en plein envoi** (`revokeAfterSends: 1`, trois clubs) : résultats `['sent', 'error', 'error']`, avec les deux erreurs égales à `GOOGLE_NOT_SENT`. L'ancien lien des clubs 2 et 3 fonctionne, aucun nouveau lien ne reste actif pour eux, et `mailLog` contient trois lignes.
  - **Mode Google mais appli construite sans `google`** (même base, reconstruite sans l'option) : le mail d'essai renvoie 400 avec `GOOGLE_NOT_CONFIGURED`.
  - **État « à reconnecter »** : le mail d'essai renvoie 400 avec `GOOGLE_RECONNECT`, sans appel à Google.
  - Dans `tests/server/mail.test.ts`, seule la signature du faux transport change. Tous les tests existants passent sans autre modification.
- [ ] **Step 2: Run** `npx vitest run tests/server/google-mail.test.ts tests/server/mail.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** les points du bloc Interfaces.
- [ ] **Step 4: Run** `npm test` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(mails): envoi par Gmail ; arrêt si l’accès Google est retiré`

---

### Task 5: Garder l'accès en vie (renouvellement mensuel)

**Files:**
- Create: `src/server/google/keepalive.ts`
- Modify: `src/server/app.ts` (démarrer si `google` existe, arrêter dans `onClose`, comme `startRetention`)
- Test: `tests/server/google-keepalive.test.ts`

**Interfaces:**
- Consumes : `markGoogleRefreshed`, `markGoogleRevoked` (Task 1) ; `GoogleClient`, `GoogleAccessRevokedError` (Task 2).
- Produces :
  - `googleKeepAliveTick(db: AppDb, google: GoogleClient, now?: Date): Promise<'skipped' | 'refreshed' | 'revoked' | 'failed'>`. Le résultat est `skipped` dans trois cas : pas de compte Google, `status === 'reconnect'`, ou `lastRefreshAt` vieux de moins de 30 jours. Sinon, `accessToken(…, { force: true })`.
  - `startGoogleKeepAlive(db, google, onError): () => void` : un tour au démarrage, puis toutes les 24 h (`setInterval(…).unref()`).

- [ ] **Step 1: Write the failing tests**
  - `skipped` sans compte ; `skipped` si `lastRefreshAt` vaut maintenant moins 29 jours.
  - À 31 jours, `refreshed`, avec `lastRefreshAt === now.toISOString()` et un `fake.refreshCount` augmenté de 1.
  - `invalid_grant` → `revoked`, et `google.status === 'reconnect'`.
  - Une erreur réseau (le faux `fetch` lève) → `failed`, sans changement d'état ni de `lastRefreshAt`.
- [ ] **Step 2: Run** `npx vitest run tests/server/google-keepalive.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**, puis brancher dans `buildApp`.
- [ ] **Step 4: Run** `npm test` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(mails): renouvellement mensuel de l’accès Google`

---

### Task 6: Écran — Envoi des mails, retour de Google, résultats d'envoi, aide

**Files:**
- Modify: `src/web/pages/AppSettingsPage.tsx` (`SmtpCard` devient `MailCard`)
- Modify: `src/web/api.ts` (`useGoogleStart`, `useGoogleDisconnect`)
- Modify: `src/web/components/InvitationMail.tsx` (`SendResultsModal`)
- Modify: `src/web/help.ts` (`parametres`)
- Modify: `tests/e2e/serveur-server.mjs` (env `PUBLIC_URL=http://localhost:3101`, `GOOGLE_CLIENT_ID=e2e-client`, `GOOGLE_CLIENT_SECRET=e2e-secret`)
- Test: `tests/e2e/serveur.spec.ts`, `tests/web/help.test.ts`

**Interfaces:**
- Consumes : routes de la Task 3, `PublicAppSettings` de la Task 1, constantes `GOOGLE_NOT_SENT` et `GOOGLE_RECONNECT`.
- Produces :
  - `useGoogleStart()` : une mutation POST `/api/app-settings/google/start` qui, en cas de succès, fait `window.location.assign(url)` ;
  - `useGoogleDisconnect()` : une mutation POST `/api/app-settings/google/disconnect` qui invalide `['app-settings']`.

**Comportement de `MailCard`**, d'après la spec §4 :
- Le `SegmentedControl` « Compte Google » / « Autre serveur (identifiant et mot de passe) » n'apparaît que si `googleAvailable` est vrai ou si `mailMode === 'google'`. Sa valeur de départ est `mailMode`.
- Avec `mailMode === 'google'` et `googleAvailable` faux, une alerte orange affiche `GOOGLE_NOT_CONFIGURED`.
- **Vue « Autre serveur »** : la vue d'aujourd'hui. Enregistrer envoie `{ mailMode: 'smtp', smtp }`.
- **Vue Google, sans compte** : bouton « Se connecter avec Google » et le texte d'aide exact.
- **Vue Google, connectée** :
  - « Connecté : {email} » ;
  - champ « Nom de l’expéditeur », qu'« Enregistrer » envoie avec `{ mailMode: 'google', googleFromName }` ;
  - « Se reconnecter » ;
  - « Déconnecter », avec une confirmation `modals.openConfirmModal` (titre « Déconnecter le compte Google ? », corps « Les mails ne pourront plus partir de ce compte tant qu’il n’est pas reconnecté. », bouton « Déconnecter »). Avec `{ revoked: false }`, une notification orange : « Déconnecté ici, mais Google n’a pas pu être prévenu : retirez l’accès depuis votre compte Google (Sécurité → Applications tierces). »
- **Vue Google, `status === 'reconnect'`** : alerte rouge `GOOGLE_RECONNECT` et bouton « Se reconnecter ».
- Le mail d'essai fonctionne dans les deux vues.
- **Retour de Google** : au montage de `AppSettingsPage`, le paramètre `google` de l'URL affiche une notification, puis il est retiré avec `history.replaceState` (en gardant `#mails`). Textes :
  - `connecte` : « Compte Google connecté. » (vert) ;
  - `annule` : « Connexion à Google annulée. » ;
  - `envoi-refuse` : « L’autorisation d’envoyer des mails n’a pas été cochée chez Google : recommencez et cochez-la. » (orange) ;
  - `expire` : « Le retour de Google a expiré ou n’est pas valable : recommencez. » (orange) ;
  - `erreur` : « Google n’a pas pu terminer la connexion : réessayez. » (rouge).
- **`SendResultsModal`** : si un résultat a l'erreur `GOOGLE_NOT_SENT`, une alerte rouge en tête : « L’accès au compte Google a été retiré pendant l’envoi : reconnectez-vous dans les Réglages de l’application, puis renvoyez aux clubs restants. », avec un lien vers `/parametres#mails`.
- **Aide `parametres`** : la voie Google en premier (un clic, avertissement « application non validée », envoi seulement) ; la voie Gmail avec mot de passe d'application en variante. Le test « pas de jargon » doit passer : pas de « API » ni de « OAuth ».

- [ ] **Step 1: Write the failing tests**
  - Dans `tests/web/help.test.ts` : `HELP.parametres.details.flat().join(' ')` contient « Se connecter avec Google » et « application non validée ».
  - Dans `tests/e2e/serveur.spec.ts`, test `serveur : envoi des mails — choix Google, le bouton mène chez Google avec les bonnes autorisations` :
    1. se connecter, ouvrir `/parametres#mails`, choisir « Compte Google » ;
    2. intercepter `https://accounts.google.com/**` avec `page.route` (l'abandonner après avoir lu l'URL), puis cliquer « Se connecter avec Google » ;
    3. vérifier que l'URL contient `client_id=e2e-client`, `redirect_uri=http%3A%2F%2Flocalhost%3A3101%2Fapi%2Fapp-settings%2Fgoogle%2Fcallback` et `gmail.send`, mais pas `mail.google.com` ;
    4. ouvrir `/parametres?google=annule#mails` : le texte « Connexion à Google annulée. » s'affiche, et l'URL ne contient plus `google=`.
- [ ] **Step 2: Run** `npx vitest run tests/web/help.test.ts` and `npx playwright test tests/e2e/serveur.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `MailCard`, les hooks, la notification de retour, la modale de résultats et l'aide.
- [ ] **Step 4: Run** `npm run typecheck`, `npm test` and `npx playwright test` (toute la suite : les autres tests du serveur e2e tournent maintenant avec `PUBLIC_URL`). Expected: PASS.
- [ ] **Step 5: Commit** `feat(mails): écran — se connecter avec Google`

---

### Task 7: Documentation d'installation, guide, bilan

**Files:**
- Modify: `docs/installation-serveur.md` (§ « Ce qu'il faut », §4 « Envoi des mails », nouvelle section « Créer l'accès Google (une seule fois) », et rappel dans « Pour une autre adresse »)
- Modify: `docs/guide-utilisateur.md`, seulement s'il décrit le réglage de l'envoi (`grep -n "mot de passe d" docs/guide-utilisateur.md`)
- Modify: `docs/superpowers/plans/2026-10-21-00-feuille-de-route.md` (étape 26), `docs/superpowers/plans/2026-10-21-99-bilan.md`

- [ ] **Step 1:** Écrire la section Google Cloud, pas à pas, selon la spec §7 :
  - projet ;
  - activation de l'API Gmail ;
  - écran de consentement Externe, avec les autorisations `gmail.send`, `openid` et `email`, puis « Publier l'application » ;
  - ID client OAuth « Application Web », avec la redirection `https://competitions.shidokanfrance.com/api/app-settings/google/callback` ;
  - les deux lignes dans `compose.yaml`, puis `docker compose up -d` ;
  - le bouton dans l'application, l'avertissement (« Paramètres avancés » puis « Accéder à … (non sécurisé) »), et le mail d'essai.

  Ajouter :
  - « Si l'accès est retiré (mot de passe du compte Google changé…), les Réglages affichent "à reconnecter" » ;
  - l'ancienne voie, le mot de passe d'application, en variante courte.

  Vérifier les libellés actuels de la console Google Cloud (WebFetch de la documentation Google « Configure the OAuth consent screen » et « Using OAuth 2.0 for Web Server Applications »). Vérifier aussi qu'une application publiée non vérifiée garde un jeton de renouvellement durable avec `gmail.send`. **Si ce n'est plus le cas, s'arrêter et prévenir l'organisateur** (spec §3.2).
- [ ] **Step 2:** Mettre à jour la feuille de route (étape 26 faite) et le bilan (décisions 💡 de la spec, écarts éventuels).
- [ ] **Step 3: Run** `npm test`. Expected: PASS (les aides et les textes n'ont pas bougé depuis la Task 6).
- [ ] **Step 4: Commit** `docs(mails): installation — créer l’accès Google, se connecter`
