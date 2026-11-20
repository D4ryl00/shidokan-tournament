# Récapitulatif PDF envoyé par mail — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Depuis l'onglet Clubs, envoyer à un club (icône enveloppe) ou à tous (bouton) son récapitulatif PDF par mail, avec un message propre à la compétition édité dans un volet « Message du récapitulatif ».

**Architecture:** Réutilise l'envoi des invitations (`src/server/mail.ts` : expéditeur, vérification du transport, images inline, `mail_log`, `SendJobs`) et le PDF du récapitulatif (`buildClubRecapPdf`, `clubRecapLines`). Nouveau module serveur `src/server/recap-mail.ts`, routes sous `/api/competitions/:id/invitations/recaps…` (déjà couvertes par le refus « serveur en ligne seulement » de `club-services.ts`), réglage `settings.recapMail`, composant web `RecapMail.tsx`.

**Tech Stack:** TypeScript, Fastify, Drizzle/SQLite (migration), React + Mantine + TipTap (`MailMessageEditor`), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-20-kata-par-kataka-duree-recap-mail-design.md` (partie 2)

## Global Constraints

- Mails : **serveur en ligne seulement** (`clubServices`) ; sur un PC, les routes répondent 403 `SERVER_ONLY` (chemins sous `/invitations`) et l'interface d'envoi n'apparaît que si `useAuthMe().data?.role === 'serveur'` (comme `OnlineEntryPanel` dans `ClubFormPage.tsx`).
- Message : `competition.settings.recapMail: MailTemplate | null` (null → `DEFAULT_RECAP_MAIL`) ; aucun niveau « Paramètres de l'application ». Variables : `{club} {coach} {competition} {date} {lieu}`.
- Pièce jointe : seulement le PDF du club, nom `recapitulatif-<club>.pdf` (même nom que le téléchargement), généré au moment de l'envoi. Les images d'un message mis en forme partent en ligne (comme l'invitation).
- Destinataires : les e-mails du coach du club (`recipientsOf` existant, toutes les adresses).
- Club sans inscription ou sans e-mail : sauté avec une raison (« Aucune inscription. », « Pas d’e-mail pour ce club. »).
- Un seul envoi groupé à la fois par compétition, invitations et récapitulatifs confondus (`SendJobBusyError`).
- `mail_log` : chaque envoi noté avec `kind = 'recap'` ; le « dernier mail » des invitations ne lit que `kind = 'invitation'`.
- Renvoyer est toujours permis.
- Ne jamais ouvrir `data/shidokan.sqlite` depuis l'hôte ; tester chaque changement visible sur Chrome.

## Review Focus

- Club dont toutes les inscriptions sont retirées : l'enveloppe est grisée et l'envoi global le saute (raison « Aucune inscription. »), jamais un PDF vide.
- Un envoi d'invitations en cours : « Envoyer à tous » répond 409 avec le message de `SendJobBusyError`, et inversement.
- Message mis en forme avec image : l'image part en ligne ; image supprimée de la base → refus avant tout envoi.
- Le « Dernier envoi » de la liste des invitations (Fiche club) ne change pas après un envoi de récapitulatif.
- Sur un PC (rôle local) : ni enveloppe, ni bouton, ni volet ; les routes répondent 403.

---

### Task 1: Réglage `recapMail` et texte de départ

**Files:**
- Modify: `src/domain/settings.ts` (~l.61 schéma, ~l.93 défaut, ~l.132 `mergeSettings` : remplacement entier comme `invitationMail`)
- Create: `src/domain/recap-mail.ts`
- Modify: `src/server/app.ts` (~l.220 : même garde `SERVER_ONLY` pour `recapMail` que pour `invitationMail`)
- Test: `tests/domain/settings.test.ts`

**Interfaces:**
- Produces: `CompetitionSettings.recapMail: MailTemplate | null` (défaut `null`) ; `export const DEFAULT_RECAP_MAIL: MailTemplate` (format texte, objet `Récapitulatif {competition} — {club}`, corps sobre : salue `{coach}`, dit que le récapitulatif des inscriptions de `{club}` pour `{competition}` du `{date}` à `{lieu}` est joint et invite à signaler une erreur) ; `export const RECAP_VARIABLES = '{club} {coach} {competition} {date} {lieu}'`.

- [ ] **Step 1: Tests qui échouent**

```ts
test('recapMail : null par défaut, remplacé en entier', () => {
  expect(defaultSettings().recapMail).toBeNull();
  const html = mergeSettings({ recapMail: { subject: 'S', body: '<p>B</p>', format: 'html' } });
  expect(mergeSettings({ recapMail: { subject: 'T', body: 'texte' } }, html).recapMail).toEqual({ subject: 'T', body: 'texte' });
  expect(mergeSettings({ recapMail: null }, html).recapMail).toBeNull();
});
```
- [ ] **Step 2:** `npx vitest run tests/domain/settings.test.ts` → FAIL.
- [ ] **Step 3:** Implémenter (schéma, défaut, merge, garde `app.ts`, constantes).
- [ ] **Step 4:** `npx vitest run tests/domain/settings.test.ts && npm run typecheck` → PASS.
- [ ] **Step 5:** `git commit -m "feat(clubs): message du récapitulatif dans les réglages de la compétition"`

### Task 2: `mail_log.kind` (migration 0042)

**Files:**
- Modify: `src/server/db/schema.ts` (`mailLog` ~l.131 : `kind: text('kind', { enum: ['invitation', 'recap'] }).notNull().default('invitation')`)
- Create: `drizzle/0042_mail_log_kind.sql` (via `npm run db:generate -- --name mail_log_kind`)
- Modify: `src/server/repositories/invitations.ts` (~l.92 : `lastMail` filtre `kind = 'invitation'`)
- Test: `tests/server/migration-0042.test.ts` (modèle : `migration-0040.test.ts`, `olderDb(41)`)

**Interfaces:**
- Produces: colonne `mail_log.kind` ('invitation' par défaut, lignes existantes comprises).

- [ ] **Step 1: Test qui échoue** : après `openDb(olderDb(41))`, une ligne `mail_log` insérée sans `kind` vaut `'invitation'` ; `pragma_table_info('mail_log')` contient `kind`.
- [ ] **Step 2:** `npx vitest run tests/server/migration-0042.test.ts` → FAIL.
- [ ] **Step 3:** Schéma + migration générée + filtre `lastMail`.
- [ ] **Step 4:** `npx vitest run tests/server/migration-0042.test.ts tests/server/invitations.test.ts tests/server/mail.test.ts` → PASS.
- [ ] **Step 5:** `git commit -m "feat(mails): type de mail dans le journal des envois"`

### Task 3: Envoi serveur (un club, tous, aperçu)

**Files:**
- Create: `src/server/recap-mail.ts`
- Modify: `src/server/mail.ts` (exporter `senderOf`, `fromOf`, `recipientsOf`, `errorText`, et généraliser `invitationImages` en `messageImages(db, template, others)` exporté ; aucun changement de comportement)
- Modify: `src/server/routes/registrations.ts` (déplacer `recapFileName` et la construction du PDF vers une fonction réutilisable)
- Modify: `src/server/club-recap-pdf.ts` (ajouter `clubRecapFile`)
- Modify: `src/server/send-jobs.ts` (`SendJob.kind`, `start(..., kind)`, `get(competitionId, kind)`)
- Modify: `src/server/routes/invitations.ts` (nouvelles routes, `SendJobs` partagé)
- Modify: `src/server/auth/permissions.ts` (~l.37 `ORGANISER_GETS` : ajouter `/invitations/recaps/send`, `/invitations/recaps/preview`)
- Modify: `src/server/journal/coverage.ts` (classer les deux POST comme `POST ${C}/invitations/send`)
- Test: `tests/server/recap-mail.test.ts` (modèle : `tests/server/mail.test.ts`, transport factice, `buildApp({ clubServices: true, mailTransport })`)

**Interfaces:**
- Consumes: `recapMail`, `DEFAULT_RECAP_MAIL` (Task 1) ; `mail_log.kind` (Task 2) ; `clubRecapLines`, `allClubRecaps` (`repositories/club-recap.ts`), `buildClubRecapPdf`.
- Produces:
  - `export async function clubRecapFile(db: AppDb, competitionId: string, clubId: string): Promise<{ filename: string; content: Buffer } | null>` (null : aucune inscription) — utilisé aussi par la route de téléchargement.
  - `export async function recapMessage(db, competitionId, clubId, imageSrc?, template?): Promise<{ subject: string; text: string; html: string }>`
  - `export async function prepareRecaps(db, transport, competitionId, pauseMs = 300): Promise<(clubIds: string[], onResult?: (r: SendResult) => void) => Promise<SendResult[]>>` — vérifie expéditeur, message, images, transport avant tout envoi (refus → `MailError`, rien ne part).
  - Routes :
    - `POST /api/competitions/:id/invitations/:clubId/recap` → `SendResult` (200 ; erreur de transport → 400 `MailError`).
    - `POST /api/competitions/:id/invitations/recaps/send` body `{ clubIds: string[] }` (1 à 500) → 202 `SendJob` (`kind: 'recap'`) ; 409 si un envoi est en cours.
    - `GET /api/competitions/:id/invitations/recaps/send` → `{ job: SendJob | null }` (dernier envoi de récapitulatifs seulement ; `GET …/invitations/send` ne rend que `kind: 'invitation'`).
    - `GET /api/competitions/:id/invitations/recaps/preview?clubId=` → `{ subject, body, html }`.

- [ ] **Step 1: Tests qui échouent**

```ts
test('récapitulatif à un club : PDF joint, message de départ, noté recap', async () => {
  const clubId = await clubWithRegistration({ name: 'Étoile', coachEmails: ['a@x.fr', 'b@x.fr'], coachName: 'M. Coach' });
  const r = (await call('POST', `/invitations/${clubId}/recap`)).json();
  expect(r.status).toBe('sent');
  const m = sent.at(-1)!;
  expect(m.to.map((t) => t.address)).toEqual(['a@x.fr', 'b@x.fr']);
  expect(m.subject).toBe('Récapitulatif Coupe 2026 — Étoile');
  expect(m.attachments.map((a) => a.filename)).toEqual(['recapitulatif-etoile.pdf']);
  expect(m.attachments[0]!.content.subarray(0, 4).toString()).toBe('%PDF');
  expect(db.prepare("select kind from mail_log").all()).toEqual([{ kind: 'recap' }]);
  expect((await call('GET', '/invitations')).json().find((c) => c.clubId === clubId).lastMail).toBeNull();
});

test('récapitulatifs à tous : clubs sans inscription ou sans e-mail sautés avec leur raison', async () => {
  // club A : inscription + e-mail ; club B : e-mail sans inscription ; club C : inscription sans e-mail
  const job = (await call('POST', '/invitations/recaps/send', { clubIds: [a, b, c] })).json();
  expect(job.kind).toBe('recap');
  const done = await finished('/invitations/recaps/send');
  expect(done.results.map((r) => [r.clubId, r.status, r.error])).toEqual([[a, 'sent', null], [b, 'error', 'Aucune inscription.'], [c, 'error', 'Pas d’e-mail pour ce club.']]);
});

test('un seul envoi groupé à la fois, invitations et récapitulatifs confondus', async () => {
  gate = new Promise(() => {}); // transport bloqué, comme dans mail.test.ts
  await call('POST', '/invitations/send', { clubs: [{ clubId: a }] });
  expect((await call('POST', '/invitations/recaps/send', { clubIds: [a] })).statusCode).toBe(409);
});

test('message propre à la compétition : variables remplacées', async () => {
  await call('PATCH', '', { settings: { recapMail: { subject: '{club} / {competition}', body: 'Bonjour {coach}, {date} à {lieu}' } } });
  const p = (await call('GET', `/invitations/recaps/preview?clubId=${a}`)).json();
  expect(p.subject).toBe('Étoile / Coupe 2026');
  expect(p.body).toBe('Bonjour M. Coach, 22 novembre 2026 à Nice');
});
```
Et dans un test « PC » (`buildApp({ clubServices: false })`) : `POST …/invitations/x/recap` → 403.

- [ ] **Step 2:** `npx vitest run tests/server/recap-mail.test.ts` → FAIL.
- [ ] **Step 3:** Implémenter `clubRecapFile` (et l'utiliser dans les routes `recap.pdf` / `club-recaps.zip`), `recapMessage` (valeurs comme `invitationMessage`, `lien`/`date_limite` vides), `prepareRecaps` (calqué sur `prepareInvitations`, sans liens ; pause `pauseMs` entre deux mails ; `GoogleAccessRevokedError` → arrêt, clubs suivants `GOOGLE_NOT_SENT`), le `kind` de `SendJobs`, les routes, les permissions, la couverture du journal.
- [ ] **Step 4:** `npx vitest run tests/server/recap-mail.test.ts tests/server/mail.test.ts tests/server/club-recap.test.ts tests/server/journal-coverage.test.ts tests/server/permissions.test.ts && npm run typecheck` → PASS.
- [ ] **Step 5:** `git commit -m "feat(clubs): envoi du récapitulatif PDF par mail, à un club ou à tous"`

### Task 4: Interface de l'onglet Clubs

**Files:**
- Modify: `src/web/api.ts` (près de `useSendInvitations` ~l.1551)
- Create: `src/web/components/RecapMail.tsx`
- Modify: `src/web/components/ui/icons.tsx` (`IconMail`, enveloppe au trait)
- Modify: `src/web/pages/ClubsPage.tsx` (~l.94 en-tête, ~l.128 cellule d'actions)
- Modify: `src/web/help.ts` (sujet `clubs.recap` : envoi, message, pièce jointe, renvoi possible)
- Test: `tests/web/recap-mail.test.ts`, `tests/e2e/` (nouveau scénario, modèle : le scénario e2e des invitations)

**Interfaces:**
- Consumes: routes de Task 3 ; `MailMessageEditor`, `useRemovedNotice` (`components/mail-editor/`), `sendSummary` (`src/web/send-summary.ts`), `useUpdateCompetition`, `useAuthMe`.
- Produces:
  - Hooks : `useSendRecap(id)` (mutation `{ clubId }` → `SendResult`), `useSendRecaps(id)` (mutation `clubIds: string[]` → `SendJob`), `useRecapSendJob(id)` (query `['recap-send', id]`, relue chaque seconde tant que non fini), `useRecapPreview(id, clubId, version)`. `SendJob` client : ajouter `kind: 'invitation' | 'recap'`.
  - `export function recapBlocked(club: { coachEmails: string[] }, registrations: number): string | null` — raison affichée en infobulle de l'enveloppe grisée (« Aucune inscription », « Pas d’e-mail pour ce club »), null si envoyable.
  - Composants : `RecapMessage({ competitionId, previewClubId })` (volet « Message du récapitulatif », calqué sur `CompetitionMessage` d'`InvitationMail.tsx` : objet, éditeur, aperçu, « Revenir au texte de départ » = enregistrer `null`, mention « Le récapitulatif PDF du club est joint automatiquement. », variables `RECAP_VARIABLES`) ; `RecapSendAll({ competitionId, clubs })` (bouton + confirmation + avancement + résumé) ; `RecapSendOne({ competitionId, club, registrations })` (icône `IconMail` + confirmation listant les adresses et l'objet).

- [ ] **Step 1: Test qui échoue**

```ts
test('recapBlocked : raison de l’enveloppe grisée', () => {
  expect(recapBlocked({ coachEmails: ['a@x.fr'] }, 0)).toBe('Aucune inscription');
  expect(recapBlocked({ coachEmails: [] }, 3)).toBe('Pas d’e-mail pour ce club');
  expect(recapBlocked({ coachEmails: ['a@x.fr'] }, 3)).toBeNull();
});
```
- [ ] **Step 2:** `npx vitest run tests/web/recap-mail.test.ts` → FAIL.
- [ ] **Step 3:** Implémenter hooks, `recapBlocked`, composants ; `ClubsPage` : volet sous `PageHeader`, bouton « Envoyer les récapitulatifs à tous les clubs » à côté du .zip, enveloppe juste à droite de l'icône de téléchargement (avant « Modifier »), le tout seulement si `me?.role === 'serveur'`. Confirmation globale : « {n} clubs recevront leur récapitulatif » + liste des clubs sautés et leur raison.
- [ ] **Step 4:** `npx vitest run tests/web/recap-mail.test.ts && npm run typecheck` → PASS.
- [ ] **Step 5:** Scénario e2e : rôle serveur, transport factice ; volet → modifier l'objet → enregistrer ; enveloppe d'un club → confirmer → notification « envoyé » ; bouton global → résumé. `npm run test:e2e -- <fichier>` → PASS.
- [ ] **Step 6: Vérifier sur Chrome** (serveur de test, `BACKUP_INTERVAL_MIN` ≤ 1440) : volet, enveloppe grisée/active, envoi d'un club, envoi à tous, aperçu du message ; et sur un poste « local » : rien de tout cela.
- [ ] **Step 7:** `git commit -m "feat(clubs): envoyer le récapitulatif depuis l'onglet Clubs"`
