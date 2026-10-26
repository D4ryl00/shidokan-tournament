# Envoi des mails avec un compte Google — conception

**Date :** 2026-10-26 · **Complète :** `docs/superpowers/specs/2026-10-23-inscriptions-en-ligne-et-synchronisation-design.md` (envoi des invitations aux clubs) et `docs/installation-serveur.md` (étape 4, « Envoi des mails »).

Légende : ✅ demandé ou validé par l'organisateur · 💡 choix du rédacteur (à vérifier en relisant) · 🔧 laissé au constructeur.

---

## 1. Pourquoi

Aujourd'hui, l'envoi des mails (invitations aux clubs, mail d'essai) passe par un serveur SMTP avec un identifiant et un mot de passe (`src/server/mail.ts`, Réglages de l'application → Envoi des mails). Avec Gmail, il faut activer la validation en deux étapes, créer un **mot de passe d'application** dans le compte Google, puis le coller dans les Réglages.

✅ Ce mot de passe d'application est **trop compliqué à créer** et **pas assez sûr**. Il donne l'accès complet à la boîte, ne se limite pas à l'envoi, et il est stocké dans l'application.

✅ Le besoin : ajouter **« Se connecter avec Google »**. L'organisateur clique, Google demande l'autorisation, et l'application peut envoyer des mails depuis ce compte, sans mot de passe à créer ni à stocker.

✅ Le compte expéditeur est une adresse **@gmail.com classique**, pas un compte Google Workspace.

**Réussi si :** l'organisateur règle l'envoi en un clic plus une autorisation Google ; le mail d'essai et les invitations (avec leurs deux fiches jointes) partent comme aujourd'hui ; l'accès peut être retiré depuis l'application ou depuis le compte Google ; un accès retiré ou expiré donne un message clair, jamais un envoi à moitié fait.

**Échec même si « ça marche » :**
- l'application obtient plus que le droit d'envoyer (lecture ou suppression des mails) ;
- le code secret ou le jeton Google apparaît à l'écran, dans une sauvegarde ou dans les journaux ;
- il faut se reconnecter chaque semaine ;
- une configuration SMTP existante cesse de fonctionner.

## 2. Ce qui ne change pas / hors sujet

- Le mode **identifiant et mot de passe (SMTP)** reste disponible, tel quel (💡 pour un serveur d'envoi qui n'est pas chez Google, et pour le PC de la salle, cf. §5).
- Ce n'est **pas** une connexion des organisateurs avec Google : les comptes de l'application (e-mail + mot de passe) ne changent pas.
- Pas de compte Microsoft ou autre fournisseur.
- Pas de demande de **vérification de l'application par Google** (cf. §3.2).
- Pas de lecture des réponses des clubs, ni d'expéditeur différent par compétition.

## 3. Côté Google

### 3.1 Un seul droit : envoyer 💡
L'application demande uniquement les autorisations :
- `https://www.googleapis.com/auth/gmail.send` : envoyer des mails en votre nom, sans pouvoir lire, modifier ou supprimer les mails ;
- `openid` et `email` : connaître l'adresse du compte connecté, qui sert d'adresse d'expéditeur.

C'est pourquoi l'envoi passe par l'**API Gmail** (`users.messages.send`) et **pas** par le SMTP de Gmail avec OAuth (XOAUTH2). Ce dernier exige l'autorisation `https://mail.google.com/`, c'est-à-dire l'accès complet à la boîte, ce qui est l'échec n° 1 du §1.

### 3.2 Application « externe », publiée, non vérifiée ✅
Avec un compte @gmail.com, l'application déclarée dans Google Cloud est forcément **externe**. Elle est **publiée en production sans vérification** (✅ option acceptée par l'organisateur) :
- l'autorisation **dure** : pas d'expiration au bout de 7 jours, contrairement au mode « test » ;
- à la connexion, Google affiche une fois l'écran **« Google n'a pas validé cette application »**. On clique sur « Paramètres avancés », puis « Accéder à … (non sécurisé) ». La doc et l'aide de l'écran le disent à l'avance, pour que ça ne fasse pas peur ;
- la limite de 100 comptes pour une application non vérifiée ne gêne pas : il n'y a qu'un compte expéditeur.

🔧 Les libellés exacts de la console Google Cloud et de l'écran d'avertissement changent de temps en temps. Les vérifier au moment d'écrire la doc. De même, vérifier qu'une application publiée non vérifiée garde bien un jeton durable avec `gmail.send`. Si ce n'est plus le cas, revenir vers l'organisateur avant d'aller plus loin.

### 3.3 Le parcours d'autorisation 💡
Flux OAuth 2.0 « code d'autorisation » pour une application Web :
- le bouton envoie le navigateur chez Google avec `access_type=offline` et `prompt=consent`, pour recevoir à chaque fois un **jeton de renouvellement** (refresh token), même lors d'une reconnexion ;
- un paramètre `state` aléatoire, à usage unique, lié à la session de l'organisateur et valable 10 minutes, protège le retour contre un retour forgé (CSRF) ;
- Google revient sur `PUBLIC_URL` + une route de retour (🔧 par exemple `/api/app-settings/google/callback`). Le serveur échange le code contre les jetons, lit l'adresse du compte, enregistre le jeton de renouvellement, puis renvoie le navigateur vers `Réglages de l'application#mails` avec un message de réussite ou d'erreur ;
- si l'organisateur refuse chez Google, il revient sur les Réglages avec « Connexion à Google annulée » ; rien ne change.

🔧 Le cookie de session doit accompagner ce retour (redirection GET de premier niveau : vérifier son attribut `SameSite`). La route de retour est réservée à l'organisateur, comme le reste des Réglages de l'application.

## 4. Ce que voit l'organisateur

Réglages de l'application → **Envoi des mails** 💡 :

- En haut, un choix entre **« Compte Google »** et **« Autre serveur (identifiant et mot de passe) »**. Le choix n'apparaît que si le mode Google est disponible (§5). Sinon, l'écran reste celui d'aujourd'hui.
- **Compte Google, pas encore connecté :**
  - un bouton **« Se connecter avec Google »** ;
  - une phrase d'aide : « Google affichera "application non validée" : cliquez sur Paramètres avancés, puis Accéder. L'application ne pourra qu'envoyer des mails, pas les lire. »
- **Compte Google, connecté :**
  - **« Connecté : xxx@gmail.com »** ;
  - le champ **Nom de l'expéditeur** (par défaut « Shidokan France ») et un bouton « Enregistrer » ;
  - un bouton **« Déconnecter »**, avec une confirmation ;
  - un bouton « Se reconnecter » pour changer de compte.

  L'adresse de l'expéditeur est celle du compte Google : elle n'est pas modifiable 💡 (Gmail refuse une autre adresse qu'un alias déclaré).
- **Compte Google, accès retiré ou expiré** (Google répond `invalid_grant`) : « L'accès au compte Google a été retiré ou a expiré. Reconnectez-vous. », avec le bouton « Se reconnecter ».
- **Mail d'essai :** il reste disponible et fonctionne de la même façon dans les deux modes.
- 💡 Les deux réglages coexistent : passer en mode SMTP et enregistrer ne déconnecte pas Google, et inversement. Le mode choisi sert pour les envois. Seul « Déconnecter » efface la connexion Google.
- **« Déconnecter »** révoque le jeton chez Google (`https://oauth2.googleapis.com/revoke`). Si la révocation échoue (réseau), le jeton est quand même effacé localement, et un message le signale.

L'aide de l'écran (`src/web/help.ts`) est mise à jour en conséquence.

## 5. Déploiement : où le mode Google existe ✅

✅ L'**ID client** et le **code secret** de Google se règlent dans **`compose.yaml`**, parce qu'ils sont liés au déploiement :

```yaml
    environment:
      - PUBLIC_URL=https://competitions.shidokanfrance.com
      - GOOGLE_CLIENT_ID=…
      - GOOGLE_CLIENT_SECRET=…
```

- Le mode Google est **disponible** seulement si `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` et `PUBLIC_URL` sont tous les trois définis 💡. En pratique, c'est le serveur en ligne : sur le PC de la salle, ces variables ne sont pas là et seul le mode SMTP existe.
- `deploy/compose.yaml` reçoit les deux lignes, en commentaire, avec un renvoi à la doc 💡.
- Le code secret n'est **jamais** écrit dans la base, envoyé au navigateur ou écrit dans les journaux.
- Si les réglages disent « Compte Google » mais que les variables ont disparu (`compose.yaml` modifié), l'envoi est refusé avec un message clair : « Le compte Google n'est plus configuré sur le serveur (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET). » L'écran l'affiche aussi.

## 6. Côté serveur

- **Stockage** 🔧 : le réglage d'envoi stocké dans `app_settings` gagne un mode (`smtp` ou `google`) et, pour Google, l'adresse du compte, le nom de l'expéditeur et le jeton de renouvellement. La forme exacte revient au constructeur. Un réglage `smtp` déjà enregistré (sans mode) se lit comme du SMTP, sans migration manuelle.
- **Jeton jamais exposé :** `publicAppSettings` ne renvoie que l'adresse connectée et l'état, comme `hasPassword` aujourd'hui. Les sauvegardes retirent le jeton de renouvellement, comme elles retirent déjà le mot de passe SMTP (`src/server/repositories/backups.ts`, `json_remove` sur `smtp.password`). Une restauration sur le même serveur ne touche pas aux réglages de l'application (`INSTALLATION_TABLES`) : la connexion Google reste en place. Il faut se reconnecter seulement après une installation neuve, et la doc le dit déjà pour les réglages d'envoi.
- **Envoi :** l'interface `MailTransport` ne change pas pour le reste du code (`verify` puis `sendMail`) 💡 :
  - `verify()` obtient un jeton d'accès à partir du jeton de renouvellement. C'est le contrôle fait avant un envoi groupé (`sendInvitations`) : si l'accès a été retiré, **rien n'est envoyé et aucun lien ne change**, comme aujourd'hui quand le serveur SMTP ne répond pas ;
  - `sendMail()` construit le message MIME avec nodemailer (déjà en dépendance : `MailComposer` ou un transport en flux), puis l'envoie à l'API Gmail. 🔧 L'envoi de type `upload` (`/upload/gmail/v1/users/me/messages/send?uploadType=media`, `message/rfc822`) évite l'encodage en base64 et accepte des messages plus gros ; le PDF et le .ods joints restent petits de toute façon ;
  - 💡 appels HTTP faits avec `fetch`, sans ajouter la bibliothèque `googleapis` ;
  - le jeton d'accès est gardé en mémoire jusqu'à son expiration.
- **Accès retiré pendant un envoi groupé** 💡 : si Google répond `invalid_grant` au milieu des envois (par exemple après un changement de mot de passe du compte Gmail), l'envoi **s'arrête**. Le club en cours et les suivants sont notés « Non envoyé : accès au compte Google retiré » ; leur ancien lien reste actif et leur nouveau lien est désactivé, comme pour un mail en erreur aujourd'hui. L'écran du résultat dit en tête de liste qu'il faut se reconnecter puis relancer l'envoi pour les clubs restants.
- **Garder l'accès en vie** 💡 : Google abandonne un jeton de renouvellement **inutilisé pendant 6 mois**, et plus de 6 mois peuvent séparer deux compétitions. Sur le serveur, une tâche de fond renouvelle donc le jeton d'accès **une fois par mois** (au démarrage, puis tous les 30 jours) quand le mode Google est connecté. La date et le résultat du dernier essai sont enregistrés. Un échec `invalid_grant` passe l'état à « à reconnecter », visible dans les Réglages bien avant le prochain envoi. Une erreur réseau ne change pas l'état ; le prochain essai a lieu le lendemain.
- **Erreurs :** `invalid_grant` → message « reconnectez-vous » (§4) et état « à reconnecter » visible à l'écran. Les autres erreurs Google sont résumées en français avec le détail technique entre parenthèses, comme `errorText` aujourd'hui.
- **Limite d'envoi :** à peu près celle d'aujourd'hui (Gmail, environ 500 destinataires par jour). La pause entre deux mails (`mailPauseMs`) est conservée.
- **Tests** 🔧 : les adresses de Google (autorisation, jeton, révocation, envoi) doivent pouvoir être remplacées par un faux serveur dans les tests, comme `mailTransport` est déjà injectable dans `buildApp`. À couvrir au moins : `state` absent, faux ou expiré refusé ; jeton jamais renvoyé à l'écran ; jeton retiré des sauvegardes ; `invalid_grant` à la vérification → rien d'envoyé, aucun lien changé ; `invalid_grant` au milieu d'un envoi → arrêt, clubs restants notés « non envoyé » ; renouvellement mensuel → état « à reconnecter » en cas d'échec ; mode Google indisponible sans les variables.

## 7. Documentation d'installation

`docs/installation-serveur.md`, étape 4 « Envoi des mails » : le mode **Compte Google** devient la voie conseillée pour Gmail 💡. Le passage sur le mot de passe d'application est gardé en variante courte (« Autre serveur »). Une nouvelle section décrit, pas à pas et une seule fois, en se connectant à la console Google Cloud avec le compte expéditeur :
1. créer un projet ;
2. activer l'**API Gmail** ;
3. configurer l'écran de consentement OAuth : type **Externe**, nom « Shidokan France », adresse d'assistance, autorisations `gmail.send`, `openid` et `email`, puis **publier l'application** (passage en production) ;
4. créer un **ID client OAuth** de type « Application Web », avec comme adresse de redirection autorisée `https://competitions.shidokanfrance.com/…` (la route exacte du §3.3) ;
5. copier l'ID client et le code secret dans `compose.yaml`, puis lancer `docker compose up -d` ;
6. dans l'application : Réglages → Envoi des mails → Compte Google → « Se connecter avec Google », passer l'avertissement, puis « Envoyer un mail d'essai ».

Rappel dans la doc : pour une autre adresse que `competitions.shidokanfrance.com`, l'adresse de redirection déclarée chez Google doit aussi changer.

## 8. Laissé au constructeur 🔧

La forme du stockage, le nom des routes, le découpage en fichiers, la gestion du `state` (en mémoire ou en base), les libellés exacts de la console Google, et la façon de simuler Google dans les tests.
