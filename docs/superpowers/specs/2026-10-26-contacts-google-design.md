# Coachs synchronisés avec Google Contacts — conception

**Date :** 2026-10-26 · **Complète :** `docs/superpowers/specs/2026-10-26-envoi-avec-google-design.md` (connexion Google) et `docs/superpowers/specs/2026-10-23-inscriptions-en-ligne-et-synchronisation-design.md` §3 (annuaire des clubs).

Légende : ✅ demandé ou validé par l'organisateur · 💡 choix du rédacteur (à vérifier en relisant) · 🔧 laissé au constructeur.

---

## 1. Pourquoi

Les coordonnées des coachs (nom, téléphone, mail) vivent déjà dans les **contacts Google** du compte Shidokan France. Dans l'application, elles sont recopiées à la main dans l'**annuaire des clubs**, qui sert à inviter les clubs aux compétitions.

✅ Le besoin : **synchroniser les coachs de l'annuaire avec Google Contacts**, en pouvant **cibler un libellé** (par exemple « Coachs »). On réutilise la connexion Google déjà faite pour l'envoi des mails.

✅ La synchronisation sert aussi à **ajouter des coachs** : un contact Google qui n'est pas encore dans l'annuaire peut devenir un nouveau club, qu'on pourra ensuite inviter.

**Réussi si :** l'organisateur ouvre l'écran, choisit le libellé, voit ce qui va changer, rattache les nouveaux contacts, clique sur « Appliquer », et l'annuaire est à jour. Une seule connexion Google suffit pour les mails et les contacts.

**Échec même si « ça marche » :**
- il faut se connecter à Google une deuxième fois, ou avec un deuxième bouton, pour les contacts ✅ ;
- l'annuaire change sans que l'organisateur ait vu les différences avant ✅ ;
- on ne peut pas garder une ancienne valeur quand Google en propose une autre ✅ ;
- l'application modifie les contacts Google ;
- la synchronisation remet les coordonnées d'un club archivé, effacées au titre du RGPD.

## 2. Hors sujet

- Pas d'écriture vers Google : la synchronisation va **seulement de Google vers l'annuaire** 💡 (droit en lecture seule).
- Pas de synchronisation automatique ou programmée 💡 : on la lance à la main, puisqu'il faut relire les différences.
- Pas de plusieurs coachs par club : l'annuaire garde un coach par club (nom, téléphone, mail), comme aujourd'hui.
- Le nom du club, le numéro d'affiliation, l'entité FFK et les notes ne sont jamais modifiés par la synchronisation 💡.
- Pas de « Autres contacts » de Gmail (adresses collectées automatiquement) : seulement les contacts enregistrés.

## 3. Connexion Google

### 3.1 Toutes les autorisations à la première connexion ✅
Le bouton **« Se connecter avec Google »** existant (Réglages de l'application → Envoi des mails) demande désormais, en une fois :
- `gmail.send`, `openid`, `email` (inchangés) ;
- `https://www.googleapis.com/auth/contacts.readonly` : voir les contacts et leurs libellés, sans pouvoir les modifier.

Il n'y a **pas de second bouton** ✅. Le compte qui envoie les mails est celui dont on lit les contacts ✅.

💡 **Mode d'envoi à la reconnexion** : aujourd'hui, toute connexion passe l'envoi en mode Google (`setGoogleSender(…, 'google')` dans `src/server/routes/google.ts`). Désormais, seule la **première** connexion (aucun compte connecté avant) passe en mode Google. Une reconnexion garde le mode choisi : un organisateur en SMTP qui se reconnecte pour accorder les contacts reste en SMTP.

### 3.2 Droit sur les contacts décoché ✅
L'écran d'autorisation de Google laisse décocher chaque droit séparément.
- `gmail.send` reste obligatoire, comme aujourd'hui (sinon « envoi-refuse »).
- Si `contacts.readonly` n'est pas accordé, la connexion est quand même enregistrée et les mails fonctionnent. L'application retient quels droits ont été accordés 🔧 (aujourd'hui `GoogleSender` ne les garde pas).
- L'écran de synchronisation affiche alors : « Le droit de lire les contacts n'a pas été accordé à l'application. Reconnectez-vous avec Google et laissez la case "contacts" cochée. », avec un lien vers Réglages → Envoi des mails.
- Les Réglages affichent aussi, sous « Connecté : xxx@gmail.com », une ligne « Contacts : accès accordé » ou « Contacts : non accordé — reconnectez-vous » 💡.

### 3.3 Connexion déjà existante ✅
Un compte connecté avant cette version n'a que `gmail.send`. Il apparaît comme « Contacts : non accordé » et il suffit de se reconnecter une fois. Le cas ne devrait pas se présenter : la connexion n'a pas encore été faite sur le serveur.

### 3.4 Où la synchronisation existe 💡
Seulement là où le mode Google est **disponible** (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `PUBLIC_URL` définis), c'est-à-dire le serveur en ligne, et seulement quand un compte Google est connecté. Le mode d'envoi choisi (Google ou SMTP) n'a pas d'importance : il faut juste un compte Google connecté avec le droit sur les contacts. Ailleurs, le bouton de synchronisation n'apparaît pas.

## 4. Lien entre un contact et un club

- Un club de l'annuaire peut être **lié** à un contact Google. Le lien est retenu (🔧 par exemple une colonne `google_contact_id` dans `club_directory`, avec l'identifiant `people/c…` de Google).
- 💡 Un même contact peut être lié à **plusieurs clubs** (un coach qui en tient deux). Un club n'est lié qu'à un seul contact. Pour lier un contact à un second club, voir §5.5 « Contacts déjà liés ».
- 💡 **Club archivé** (par l'effacement automatique RGPD de `retention.ts` ou à la main) : son lien est **effacé** en même temps que ses coordonnées. S'il est désarchivé, il n'est plus lié ; son ancien contact redevient un nouveau contact (s'il n'est lié à aucun autre club) et peut être relié en connaissance de cause.
- 💡 **Changement de compte Google** : les identifiants de contact n'ont de sens que dans un compte. L'application retient l'adresse du compte avec lequel les liens ont été faits. Si on se reconnecte avec **un autre compte**, tous les liens et la liste « en attente » sont effacés au moment de la reconnexion (ils pointeraient vers des contacts qui n'existent pas). La phrase d'aide de « Se reconnecter » le dit. Se reconnecter avec le **même** compte ne touche à rien.
- La synchronisation ne touche qu'aux clubs **liés**. Les clubs sans lien ne changent pas.
- ✅ « Entreprise » est rarement rempli dans Google : on ne s'en sert pas pour rattacher. 💡 S'il est rempli, il sert seulement à pré-remplir le nom d'un nouveau club et à suggérer un club existant.
- Le lien suit le club lors d'une **fusion** de deux fiches de l'annuaire 💡 : si la fiche gardée n'a pas de lien, elle prend celui de la fiche fusionnée.
- On peut **retirer le lien** depuis la fiche du club dans l'annuaire 💡 (« Ne plus synchroniser avec Google »). Le contact revient alors parmi les nouveaux contacts à la synchronisation suivante.

## 5. L'écran de synchronisation

Ouvert depuis l'**Annuaire**, par un bouton **« Synchroniser avec Google »**. ✅ **Tout tient sur une page**. Rien ne change avant le clic sur « Appliquer » ✅.

### 5.1 En haut
- **Libellé** : une liste avec « Tous les contacts » et les libellés créés dans Google ✅. 💡 Le dernier libellé choisi est retenu (réglage de l'application) et présélectionné la fois suivante.
- Le compte lu et le nombre de contacts trouvés (« shidokanfranceofficiel@gmail.com · 42 contacts »).
- Changer de libellé relit Google et recalcule la page.

### 5.2 Différences avec l'annuaire
Pour chaque club **lié** dont le contact (dans le libellé choisi) diffère de l'annuaire, une ligne par champ qui diffère :

| ☑ | Club | Champ | Annuaire | Google |
|---|------|-------|----------|--------|

- Champs comparés : **nom du coach**, **téléphone**, **mail**.
- ✅ Google l'emporte : chaque ligne est **cochée par défaut** (« prendre Google »). On **décoche** une ligne pour garder la valeur de l'annuaire.
- ✅ Une ligne décochée est ignorée **seulement cette fois** : rien n'est retenu, et la même différence revient à la synchronisation suivante tant que Google et l'annuaire ne concordent pas.
- 💡 Un champ **vide dans Google** n'efface pas la valeur de l'annuaire : ce n'est pas une différence. Un champ vide dans l'annuaire et rempli dans Google en est une (cochée par défaut).
- 💡 Deux téléphones qui ne diffèrent que par l'écriture (espaces, points, `+33 6…` contre `06…`) ne sont pas une différence. Deux mails qui ne diffèrent que par les majuscules non plus. La valeur prise est celle de Google telle qu'écrite.
- 💡 Pour un contact qui a plusieurs mails ou téléphones, on prend le **principal** (celui marqué comme tel dans Google, sinon le premier).
- 💡 Nom du coach : le nom affiché du contact (`displayName`).
- 💡 Clubs **archivés** : laissés de côté, jamais affichés ni modifiés (leurs coordonnées ont été effacées au titre du RGPD). Si leur contact est encore dans Google, il n'apparaît pas non plus parmi les nouveaux contacts.
- 💡 Un club lié dont le contact n'est plus dans le libellé, ou a été supprimé de Google : rien ne change dans l'annuaire, et le lien est gardé.

### 5.3 Nouveaux contacts
Chaque contact du libellé qui n'est lié à **aucun** club (archivé ou non) et qui n'est pas « en attente » est montré avec son nom, son mail et son téléphone. Pour chacun, un choix :

- **Lier à un club existant** ✅ : liste des clubs non archivés de l'annuaire. 💡 Un club déjà lié à un autre contact y figure avec la mention « lié à <contact> » ; le choisir remplace son lien.
  - 💡 **Présélection seulement sur une concordance exacte** : le club dont le coach a le même mail, sinon le même téléphone (écritures équivalentes, §5.2), est présélectionné avec la raison (« même mail »).
  - 💡 Un nom proche (nom du coach, ou nom du club qui ressemble à « Entreprise ») est seulement **proposé** (« Peut-être : Shidokan Est ? », un clic pour le choisir), jamais présélectionné : un mauvais rattachement écraserait les coordonnées d'un autre coach.
  - ✅ S'il n'y a aucun coach correspondant, rien n'est présélectionné.
  - 💡 Juste en dessous, les champs qui diffèrent entre ce contact et le club choisi sont affichés, avec les mêmes cases que §5.2 (cochées par défaut). Les champs vides du club sont simplement remplis.
- **Nouveau club** ✅ : on saisit le **nom du club** (💡 pré-rempli avec « Entreprise » s'il existe). À l'application, une fiche est créée dans l'annuaire avec ce nom et les coordonnées du contact, et liée au contact. 💡 Si le nom correspond à un club existant de l'annuaire (même normalisation que `name_key`), l'écran le signale (« Un club porte déjà ce nom : le lier plutôt ? ») sans l'interdire.
- **Plus tard** ✅ : rien n'est créé. Le contact est rangé « en attente ».
- 💡 Choix par défaut : « Lier » si une concordance exacte existe, sinon « Plus tard ». Ainsi « Appliquer » ne crée jamais de club sans qu'on ait saisi un nom, et ne lie jamais sur une simple ressemblance de nom.
- 💡 « + Lier aussi à un autre club » permet de choisir plusieurs clubs pour le même contact (coach de deux clubs).

### 5.4 En attente
✅ Les contacts laissés « Plus tard » sont retenus 🔧 (liste d'identifiants Google dans l'application) et rangés dans une liste **repliée** « En attente d'un rattachement (n) », sous les nouveaux contacts. Dépliée, elle offre les mêmes choix (lier, nouveau club). 💡 Un contact en attente qui n'est plus dans le libellé n'est pas affiché ; il reste retenu.

### 5.5 Contacts déjà liés 💡
Une seconde liste **repliée**, « Contacts déjà liés (n) », montre les contacts du libellé avec le ou les clubs auxquels ils sont liés. Chaque ligne offre « Lier aussi à un autre club » (même liste qu'au §5.3). C'est le moyen de lier un contact à un second club après coup. Retirer un lien se fait depuis la fiche du club (§4).

### 5.6 Appliquer
- Un bouton unique, avec un récapitulatif : « Appliquer : 3 différences, 1 lien, 1 nouveau club » (💡 compte des différences gardées si > 0 : « 1 gardée »).
- Tout est appliqué **d'un bloc** (une transaction) 💡.
- 💡 Si une fiche de l'annuaire a changé entre l'affichage et le clic (version de ligne, §7.2 de la spec inscriptions en ligne), rien n'est appliqué : « L'annuaire a changé entre-temps : la page a été rechargée, vérifiez puis appliquez de nouveau. »
- Après application, la page se recharge et affiche le résultat (« Annuaire mis à jour »).

### 5.7 Erreurs
- Accès Google retiré ou expiré (`invalid_grant`) : même message et même état « à reconnecter » que pour l'envoi des mails.
- Droit sur les contacts absent : §3.2.
- Autre erreur Google : résumée en français, détail technique entre parenthèses, comme pour l'envoi.

## 6. Qui peut synchroniser 💡
Les mêmes comptes que ceux qui peuvent modifier l'annuaire (`src/server/auth/permissions.ts`). L'organisateur en fait partie.

## 7. Côté serveur

- **API Google People** 💡, avec `fetch` comme le reste du client Google (`src/server/google/client.ts`), sans la bibliothèque `googleapis` :
  - libellés : `contactGroups.list` (ne garder que les libellés créés par l'utilisateur, `groupType = USER_CONTACT_GROUP`) ;
  - contacts : `people.connections.list` avec `personFields=names,emailAddresses,phoneNumbers,organizations,memberships`, toutes les pages, puis filtrage par libellé via `memberships` 🔧 (ou `contactGroups.get` + `people.getBatchGet`).
- **Calcul à part de l'application** 💡 : une fonction pure reçoit les contacts et les fiches de l'annuaire et rend les différences, les nouveaux contacts, les suggestions et les contacts en attente. C'est elle qu'on teste à fond.
- **Deux routes** 🔧 : une qui lit Google et rend l'aperçu (avec les versions des fiches), une qui applique les choix envoyés par la page. L'application relit Google 💡 pour être sûre de prendre les valeurs à jour, ou s'appuie sur les valeurs envoyées par la page 🔧, au choix du constructeur, mais ne doit jamais appliquer une valeur que l'organisateur n'a pas vue.
- **Stockage** 🔧 : le lien club ↔ contact, la liste « en attente », le dernier libellé choisi, et les droits accordés lors de la connexion Google.
- Le lien club ↔ contact fait partie de la fiche de l'annuaire et voyage avec elle dans les paquets de synchronisation vers le PC, sans conséquence là-bas 💡.
- **Sauvegardes** : rien de nouveau à retirer (aucun secret).
- **Tests** 🔧 : faux serveur Google comme pour l'envoi (`tests/helpers/fake-google.ts`). À couvrir au moins : droit absent → message, rien d'autre ; filtrage par libellé ; différences (vide Google ≠ différence, écritures de téléphone équivalentes, principal choisi) ; ligne décochée → valeur gardée et différence reproposée ensuite ; nouveau club créé et lié ; « Plus tard » → en attente ; clubs archivés ignorés ; annuaire modifié entre-temps → rien d'appliqué ; fusion → lien conservé ; archivage (RGPD ou à la main) → lien effacé ; reconnexion avec un autre compte → liens et « en attente » effacés, même compte → rien ne change ; reconnexion → mode d'envoi gardé ; ressemblance de nom seule → rien de présélectionné ; contact lié à deux clubs → les deux mis à jour.

## 8. Documentation

- `docs/installation-serveur.md`, déclaration dans la console Google Cloud : activer aussi l'**API People** et ajouter l'autorisation `contacts.readonly` à l'écran de consentement. L'avertissement « application non validée » reste le même.
- Aide de l'écran (`src/web/help.ts`) : Annuaire et nouvel écran de synchronisation ; Réglages → Envoi des mails (ligne « Contacts »).

## 9. Laissé au constructeur 🔧

La forme du stockage, le nom des routes et des fichiers, la façon exacte de filtrer par libellé côté Google, la mise en page fine de l'écran (la maquette « tout sur une page » validée sert de base), et la simulation de Google dans les tests.
