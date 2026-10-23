# Inscriptions en ligne, plusieurs postes et synchronisation — conception

**Date :** 2026-10-23 · **Complète :** `docs/superpowers/specs/2026-10-21-tableaux-shidokan-design.md` (§7 fiche club, §15 architecture) et `docs/superpowers/specs/2026-10-22-fiche-club-papier-design.md`.
**Calendrier :** rien de ce document n'est nécessaire pour la Coupe du **22 novembre 2026**. Seule l'**étape 0** (données) est à faire maintenant, pour que les bases d'aujourd'hui restent compatibles. Les autres étapes viendront plus tard, dans l'ordre du §11.

Légende : ✅ décidé par l'organisateur · 💡 choix du rédacteur (à vérifier en relisant) · 🔧 laissé au constructeur.

---

## 1. Pourquoi

Aujourd'hui, les clubs renvoient une fiche (.ods ou papier) que l'organisateur importe ou ressaisit. L'application ne tourne que sur un seul PC, sans internet, et un seul poste l'utilise.

On veut, à terme :
- que **chaque club inscrive lui-même ses combattants en ligne**, avec un lien personnel reçu par mail ✅ ;
- garder une compétition **qui fonctionne sans internet le jour J** ✅ ;
- pouvoir travailler à **plusieurs postes**, un par zone de combat, sur le réseau local ou en ligne ✅ ;
- et un jour, peut-être, des **PC de zone autonomes** qui se rejoignent ensuite ✅.

**Réussi si :**
- un coach retrouve ses combattants, ligne par ligne, chaque fois qu'il rouvre son lien, et peut les modifier jusqu'au gel ;
- l'organisateur envoie le message à tous les clubs en quelques clics ;
- le jour J se déroule entièrement sur le PC, même si internet tombe ;
- après la compétition, l'archive se retrouve en ligne ;
- **une base créée aujourd'hui passe telle quelle par toutes les étapes suivantes**, sans ressaisie ni perte.

**Échec même si « ça marche » :**
- deux machines modifient la même compétition, et l'une écrase l'autre sans que personne ne le voie ;
- un coach modifie une inscription après le gel, et elle n'arrive jamais au PC ;
- un résultat incohérent, par exemple un vainqueur saisi pour un combat dont un combattant a été déplacé entre-temps, produit par une fusion automatique ;
- des données de mineurs accessibles sans autorisation ;
- une panne d'internet ou de serveur qui arrête la compétition ;
- un PC qui sert aussi de zone et dont l'opérateur, en fermant une fenêtre, coupe toutes les zones.

## 2. Principe directeur : une seule machine a la main 💡

Il y a **une seule application**, la même partout : en ligne sur un serveur, ou sur le PC de la compétition (Docker). Seuls les réglages au démarrage diffèrent (§8.1).

Pour une compétition donnée, **une seule machine peut écrire à la fois** : c'est celle qui « a la main ». Les autres ne la voient qu'en lecture. On ne fusionne jamais deux bases. On se **passe la main**, et la compétition entière voyage avec.

| Phase | Qui a la main | Ce qui se passe |
|---|---|---|
| Préparation et inscriptions | Le serveur en ligne | Les clubs s'inscrivent avec leur lien ; l'organisateur importe la FFK et prépare la grille |
| Gel des inscriptions et prise de main | Le PC | Le PC récupère toute la compétition ; en ligne, elle passe en lecture seule, avec le bandeau « Gérée par le PC <nom> depuis le … » |
| Jour J | Le PC | Pesée, réaffectations, résultats. Un changement de dernière minute se fait sur place |
| Après la compétition | Le serveur | Le PC renvoie la compétition entière ; elle remplace la version en ligne et sert d'archive |

**Pourquoi ne pas synchroniser dans les deux sens en continu :** les données sont liées entre elles (tableaux, réaffectations, sessions lancées, numéros de passage figés). Une fusion ligne par ligne, où la dernière modification gagne, peut produire un état faux sans qu'aucun conflit ne soit détecté.

Plusieurs postes qui partagent **la même base** (réseau local ou tout en ligne, §7) ne sont pas une synchronisation. Ce sont plusieurs navigateurs sur un même serveur. Le seul cas où deux bases doivent vraiment se rejoindre est celui des PC de zone autonomes (§10), et il passe par un journal d'opérations, pas par une fusion de bases.

## 3. Étape 0 — à faire maintenant : les données ✅ (contenu 💡)

But ✅ : modifier dès maintenant la base pour que toutes les étapes suivantes ne fassent qu'**ajouter** des choses. Ces changements ne modifient rien de visible pour l'organisateur.

**Ce qui est déjà bon (à garder) :**
- Tous les identifiants sont des UUID (`crypto.randomUUID()`), donc des lignes créées sur deux machines n'entrent jamais en collision. Seule exception : `age_links.id`, un entier auto-incrémenté (traité au §3.6).
- Toutes les données d'une compétition portent `competition_id`, donc une compétition peut voyager seule.
- Une restauration accepte une sauvegarde d'une version plus ancienne (migrations appliquées) et refuse une plus récente. Le transfert entre machines reprend cette règle (§9.4).

### 3.1 Identité de l'installation
- Nouvelle table `instance`, avec une seule ligne : `id` (UUID), `name`, `created_at`. La ligne est créée **au démarrage de l'application**, si elle n'existe pas. Elle n'est pas créée dans une migration, car les migrations tournent aussi sur la copie temporaire d'une restauration.
- 💡 Nom par défaut : la variable d'environnement `INSTANCE_NAME`, sinon `COMPUTERNAME` transmise par `compose.yaml`, sinon « PC ». Dans Docker, le nom d'hôte du conteneur est un identifiant illisible, donc on ne l'utilise pas. Le nom sera modifiable dans les réglages (étape A).
- **Une restauration ne touche pas à cette table** : `restoreFrom` l'exclut des tables copiées. En revanche, une copie brute du dossier `data/` emporte la même identité. La fiche jour J (§7.5) et l'aide de la restauration le disent : pour reprendre sur un autre PC, on **restaure** une sauvegarde, on ne copie pas le dossier.

### 3.2 Annuaire des clubs
- Nouvelle table `club_directory`, indépendante des compétitions. Colonnes : `id` (UUID), `name`, `name_key` (même normalisation que `clubs.name_key`, **non unique**), `affiliation_number` (numéro d'affiliation FFK du club, 7 chiffres, nullable, **unique quand renseigné**) ✅, `ffk_entity` (texte complet de l'entité FFK, par exemple `0060808 ISSA KYOKUSHIN SCHOOL`, nullable), `coach_name`, `coach_phone`, `coach_email` (tous nullables), `notes` (nullable), `archived` (booléen, faux par défaut), `created_at`.
- `clubs` reçoit `directory_club_id` (nullable, référence `club_directory.id`, `on delete set null`). Le club d'une compétition reste une **copie propre à la compétition** : coordonnées du coach au moment de l'inscription, pré-accord des reclassements. L'annuaire porte la fiche durable.
- **Comment on reconnaît un club** 💡 : un même club arrive sous deux orthographes, celle de l'export FFK et celle que le coach a tapée. `club_aliases` relie déjà les deux. La règle de rapprochement, dans l'ordre :
  1. même **numéro d'affiliation** ✅ : les chiffres en tête de l'entité FFK du club, ou de celle que `club_aliases` donne pour son nom. Le numéro ne change pas, alors que le nom peut changer ou être mal orthographié ;
  2. sinon, même `name_key`, à condition que l'entrée trouvée n'ait pas un **autre** numéro d'affiliation ;
  3. sinon, une nouvelle entrée.
- **Reprise des données existantes**, dans la migration : on applique cette règle à tous les `clubs` existants. Les coordonnées d'une entrée sont prises dans le club de la compétition la plus récente (par date de compétition) qui les renseigne, et tous les `clubs` sont reliés à leur entrée. 🔧 La migration peut être une migration SQL écrite à la main, ou une étape de code jouée une seule fois au démarrage.
- **Création de clubs à partir de maintenant** : `upsertClubSync` dans `registrations.ts`, et la création de club dans `ffk-import.ts`. Tout nouveau club de compétition est relié à une entrée selon la même règle. Quand un club reçoit son entité FFK (lien fait à l'import FFK), son entrée reçoit l'entité et le numéro d'affiliation, si elle ne les a pas.
- Les coordonnées de l'annuaire ne sont **pas** écrasées par une fiche importée ; elles sont seulement complétées si elles sont vides. Elles ne changent que par une modification dans l'annuaire, ou par le coach lui-même sur sa page (§5.2).
- **Renommer un club de compétition** ne change pas son entrée d'annuaire.
- Il restera des doublons que la règle ne peut pas voir, par exemple deux orthographes sans numéro d'affiliation. Ils se corrigent avec la **fusion d'entrées** de l'étape B (§4).
- 💡 Plus tard (étape B) : la page d'inscription en ligne et les fiches pourront demander le numéro d'affiliation au coach, pour reconnaître directement un club qui ne passe pas par l'import FFK.
- `club_aliases` reste tel quel. Le rattachement à l'entité FFK pourra plus tard migrer vers `club_directory.ffk_entity` 🔧.

### 3.3 Qui a la main sur la compétition
Nouvelles colonnes dans `competitions` :
- `owner_instance_id` : **vide = « gérée ici »**. On ne le remplit que lorsqu'une **autre** installation a la main : sur le PC, pour une copie reçue du serveur en lecture seule ; sur le serveur, avec l'identité du PC qui a pris la main. Les compétitions existantes et les nouvelles restent vides. La migration n'a donc besoin d'aucune identité d'installation. 💡
- **Restauration** : une compétition dont la main appartient à l'installation d'où vient la sauvegarde (son `instance.id` se lit dans le fichier restauré) devient « gérée ici », de même qu'une compétition notée au nom de l'installation locale elle-même (une installation n'est jamais « l'autre » pour elle-même). Restaurer, c'est reprendre la main sur ce qu'elle gérait. Les autres compétitions gardent leur valeur. Une installation sans serveur relié gère donc toujours toutes ses compétitions, y compris après une reprise sur un second PC (§7.4).
- `last_sync_at` : date du dernier transfert (nullable ; reste vide jusqu'à l'étape D).
- `club_entry_status` : `closed` | `open` | `frozen`, `closed` par défaut. Ce sont les inscriptions en ligne : pas encore ouvertes, ouvertes, figées.
- `club_entry_deadline` : date limite affichée aux clubs (nullable).

Rien ne lit ces colonnes à l'étape 0. Elles existent pour que les étapes B et D n'aient pas à deviner, plus tard, à qui appartenait une compétition créée aujourd'hui.

### 3.4 Version et date de modification des lignes
- **Toutes les tables de données d'une compétition** reçoivent `version` (entier) et `updated_at` (horodatage ISO, comme `created_at`). Ce sont `competitions`, plus toutes les tables qui ont `competition_id` sauf `uploads`, plus `club_directory`. La règle de garde (§3.5) vérifie que toute nouvelle table de compétition les a aussi.
- **Une version ne se répète jamais** 💡. Plusieurs lignes sont effacées puis recréées au lieu d'être modifiées : résultat effacé puis ressaisi, départages recalculés, zones et sessions réenregistrées. Avec un simple compteur par ligne, la ligne recréée reprendrait la version 1, et une modification périmée passerait. La version est donc tirée d'un **compteur unique pour toute la base** (table `change_counter`, une ligne), augmenté à chaque création ou modification de ligne.
- **Tenues automatiquement par la base** 💡 : des déclencheurs SQLite `AFTER INSERT` et `AFTER UPDATE` sur chaque table augmentent le compteur, puis écrivent sa valeur dans `version` et l'heure courante dans `updated_at`. Aucun code existant n'a à y penser. Les déclencheurs récursifs sont désactivés par défaut dans SQLite, et l'application ne les active pas, donc la mise à jour faite par le déclencheur ne le relance pas.
- **Attention aux migrations futures** : quand drizzle-kit modifie une table SQLite, il la reconstruit souvent (`__new_<table>` puis renommage), ce qui **supprime ses déclencheurs sans prévenir**. Un test vérifie que chaque table concernée a bien ses deux déclencheurs. Une migration qui reconstruit une table doit les recréer, et le test le rappelle.
- Les dates de modification ne pourraient pas être reconstituées après coup. Elles commencent à s'accumuler dès maintenant.
- Usage plus tard : refuser une modification faite sur une version périmée (§7.2), et montrer « modifié à 14 h 32 ».

### 3.5 Règle de garde : une compétition se suffit à elle-même
- Un test vérifie que **chaque table** a une colonne `competition_id`, ou figure dans une liste explicite : `competitions` (son `id` est la compétition) et les tables globales `instance`, `change_counter`, `club_directory`, `club_aliases`, `import_mappings`, `grid_templates`, `__drizzle_migrations`. Les tables internes de SQLite (`sqlite_%`, par exemple `sqlite_sequence`) sont ignorées.
- Une future table oubliée dans cette règle casse le test. Elle ne casse pas, des mois plus tard, le transfert d'une compétition.
- `uploads` a une colonne `competition_id`, mais ce sont des fichiers temporaires : ils ne voyagent pas (§9.3).

### 3.6 `age_links`
On ne la change pas. Au transfert d'une compétition (§9.3), ses lignes voyagent sans leur `id`, et l'installation qui les reçoit les renumérote. 💡

### 3.7 Valeur `online` pour l'origine d'une inscription
La valeur `online` est ajoutée à `registrations.source` (inscription faite par le club sur sa page). C'est une énumération TypeScript sans contrainte en base, donc l'ajout n'a pas de coût. On la prévoit dès maintenant pour que les écrans et exports qui affichent l'origine la connaissent.

## 4. Annuaire des clubs (étape B) ✅

- Nouvelle page **Clubs**, hors de toute compétition, à côté de la liste des compétitions. On y trouve la liste, la recherche, la création, la modification et l'archivage (un club archivé n'est plus proposé, mais reste lié à ses anciennes compétitions).
- Les organisateurs **créent les fiches à l'avance** ✅. Les imports (fiche club, FFK, saisie papier) complètent l'annuaire automatiquement (§3.2).
- Dans une compétition, onglet **Fiche club**, nouvelle section « Inviter des clubs ». On coche des clubs de l'annuaire : chacun reçoit un club de compétition (copie de ses coordonnées) et un **lien personnel**.
- **Fusion de deux entrées** 💡 (doublons que la règle du §3.2 n'a pas vus) : on choisit l'entrée à garder ; les clubs de compétition reliés à l'autre sont reliés à celle qu'on garde, et l'autre est supprimée.
- 💡 Plus tard : « reprendre mes combattants de l'an dernier » sur la page du club.

## 5. Inscription en ligne par le club (étape B) ✅

### 5.1 Le lien personnel
- 💡 **Un lien par club et par compétition** (et non un lien par club valable pour toutes les compétitions). Il cesse de fonctionner tout seul au gel, peut être révoqué ou régénéré, et chaque mail correspond à une compétition.
- Nouvelle table `club_invitations` : `id`, `competition_id`, `club_id` (club de la compétition), `token_hash`, `created_at`, `sent_at`, `revoked_at`, `last_used_at`.
- Le jeton est tiré au hasard sur au moins 128 bits et encodé pour une adresse web. **On ne garde que son empreinte** (SHA-256). L'organisateur peut copier le lien au moment où il est créé ou régénéré ; régénérer invalide l'ancien.
- Adresse : `/inscription/<jeton>`. La page ne montre **que** ce club et cette compétition.

### 5.2 La page du club
- En haut : nom de la compétition, date, lieu, **date limite**, état (« Inscriptions ouvertes jusqu'au … » ou « Inscriptions closes : contactez l'organisateur »).
- **En-tête du club**, modifiable tant que c'est ouvert : coach, téléphone, e-mail, « Le coach accepte d'avance les reclassements de ses combattants », et **N° d'affiliation FFK, facultatif** ✅ (2026-10-23). Le numéro (7 chiffres) complète l'annuaire. S'il est déjà celui d'une autre entrée, ou si l'entrée du club a déjà un autre numéro, il est refusé (« contactez l'organisateur ») : seul l'organisateur rapproche deux fiches (fusion), pour qu'un coach ne puisse pas se faire passer pour un autre club et recevoir ses invitations. *(Corrigé après relecture, 2026-10-23 : le club était d'abord relié à l'entrée qui porte le numéro.)* 💡 Le coach, le téléphone et l'e-mail modifiés ici mettent aussi à jour l'**annuaire** : ce sont les coordonnées les plus récentes, données par le club lui-même. L'invitation suivante partira donc à la bonne adresse.
- **Combattants affichés** ✅ (2026-10-23) : **tous** les combattants du club dans cette compétition, quelle que soit leur origine (en ligne, fiche .ods ou papier, import FFK, saisie de l'organisateur). C'est une seule liste qui fait foi : le coach peut corriger ce que l'organisateur a ressaisi.
- **Présentation** ✅ (2026-10-23) : une ligne résumée par combattant (nom, sexe, âge, poids, disciplines et règlement) avec « Modifier », et « Ajouter un combattant ». Les deux ouvrent un **formulaire d'un seul combattant** (Enregistrer, Annuler, Supprimer), lisible sur téléphone.
- **Un combattant par ligne** ✅, avec les mêmes champs et les mêmes règles que la fiche papier : nom, prénom, sexe, catégorie d'âge (tranches proposées), poids actuel, disciplines (kata et/ou une discipline de combat sur la même ligne), grade si kata, règlement, autres disciplines numérotées, priorité shobu.
- **Chaque ligne s'enregistre seule** ✅ : le coach ajoute, modifie ou supprime une ligne, et elle est aussitôt enregistrée. Quand il revient plus tard avec le même lien, il retrouve toutes ses lignes.
- Validation identique à l'import de fiche club (`src/domain/club-form.ts`). Une ligne en erreur n'est pas enregistrée et l'erreur est affichée sur la ligne. Une ligne kata + combat donne deux inscriptions. La catégorie de poids est déduite du poids, comme pour la fiche papier.
- Une fois les inscriptions **figées** (`club_entry_status = frozen`), ou si la compétition n'est plus gérée par ce serveur (§9), la page est **en lecture seule** ✅.
- Page lisible sur téléphone : beaucoup de coachs l'ouvriront depuis leur mail.
- Les inscriptions créées ainsi ont pour origine `online`. Elles apparaissent dans l'onglet Inscriptions comme les autres, et l'organisateur peut les corriger. Si le coach et l'organisateur modifient la même ligne, la vérification de version (§7.2) s'applique.
- 💡 Une ligne supprimée par le coach supprime ses inscriptions, mais seulement tant que les inscriptions sont ouvertes. Après le gel, tout retrait se fait par l'organisateur.

### 5.3 Ouverture et gel
- Dans l'onglet **Fiche club**, l'organisateur règle la date limite, puis **ouvre** les inscriptions et, plus tard, les **fige**. Il peut les rouvrir tant que personne d'autre n'a pris la main (§9).
- 💡 La date limite est indicative. Le gel est un geste explicite de l'organisateur ; il n'est pas automatique.
- Les liens fonctionnent aussi **sur le réseau local**, avant toute mise en ligne. Cela permet d'essayer la page sur place.

## 6. Envoi des mails (étape C) ✅

- **Réglages d'envoi** (globaux, page Réglages de l'application) : serveur SMTP, port, chiffrement, identifiant, mot de passe, nom et adresse de l'expéditeur. Un bouton **« Envoyer un mail d'essai »**.
- Aide affichée pour **Gmail** : il faut activer la validation en deux étapes et créer un **mot de passe d'application**, car le mot de passe normal ne fonctionne pas en SMTP. Gmail accepte environ 500 destinataires par jour, ce qui suffit.
- **Message modifiable** ✅ : objet et texte, avec des variables `{club}`, `{coach}`, `{competition}`, `{date}`, `{lieu}`, `{date_limite}`, `{lien}`. 💡 Un modèle par défaut global, copié dans chaque compétition et modifiable pour elle.
- **Un nouveau lien à chaque envoi** ✅ (2026-10-23) : seule l'empreinte des liens est gardée, donc un envoi (premier mail, relance, « Ouvrir dans ma messagerie ») crée un lien neuf et désactive le précédent. Un coach qui ouvre un lien remplacé voit : « Ce lien a été remplacé : utilisez celui du dernier mail reçu. »
- **Envoi à un ou plusieurs clubs** ✅ : on coche des clubs invités (filtres « jamais envoyé », « sans inscription », « avec e-mail »), on voit un aperçu du message pour un club, puis on envoie.
- Chaque envoi est noté (table `mail_log` : club, adresse, date, envoyé ou erreur avec son message). L'état apparaît à côté de chaque club : « Envoyé le … », « Erreur : … ».
- Sans réglages SMTP, ou en cas de problème, on dispose de deux boutons par club : **« Copier le lien »** et **« Ouvrir dans ma messagerie »** (lien `mailto:` avec l'objet et le texte déjà remplis).
- Le mot de passe SMTP ne quitte jamais le serveur qui l'utilise. Il n'est pas transféré au PC (§9.3) et n'est jamais renvoyé à l'écran.
- 🔧 Bibliothèque d'envoi (nodemailer, a priori) ; envoi un par un, avec une courte pause entre les mails.

## 7. Plusieurs postes sur une même base (étapes A et E) ✅

C'est le même fonctionnement en réseau local et tout en ligne. Le serveur est soit le PC principal, soit le serveur en ligne. Les autres postes ne sont que des navigateurs.

### 7.1 Mise à jour automatique des écrans
Aujourd'hui, les pages ne se rafraîchissent pas toutes seules. Désormais, quand une donnée d'une compétition change, les autres postes qui l'affichent la voient en quelques secondes, sans recharger : les vainqueurs à la table centrale, une catégorie déplacée sur l'écran d'une zone, etc.
- 🔧 Un canal d'événements du serveur (« la compétition X a changé »), qui invalide les données en cache de react-query ; ou à défaut un rafraîchissement régulier.

### 7.2 Protection contre les écrasements
- Toute modification d'une ligne qui a une `version` (§3.4) envoie la version lue. Si la ligne a changé entre-temps, le serveur refuse (409). Le poste affiche alors « Modifié entre-temps par un autre poste », recharge, et n'écrase rien.
- Concerne en priorité : saisie et effacement de résultats, notes de kata, départages, inscriptions et combattants, déplacements de catégories, sessions et zones.
- 💡 La création d'un résultat pour un combat sans résultat est refusée si un résultat a été créé entre-temps.

### 7.3 Postes et rôles
- Rôles : **organisateur** (tout), **table centrale** (inscriptions, pesée, réaffectations, résultats de toutes les zones), **zone** (résultats et notes de kata de sa zone seulement).
- **En réseau local** 💡 : pas de mot de passe. Chaque navigateur choisit son poste (« Table centrale », « Zone Tatami 1 »…), et le choix est retenu par le navigateur. Le rôle sert à simplifier l'écran et à éviter les erreurs, pas à protéger. La protection vient du Wi-Fi fermé.
- **En ligne** : comptes avec mot de passe (§8.2), et chaque compte a un rôle.
- Le **PC principal peut aussi être le poste d'une zone** ✅ : son navigateur est un poste comme les autres.

### 7.4 Copie de secours sur un autre poste
- Une seconde installation peut être réglée pour **recopier régulièrement** la base du PC principal à travers le réseau (`/api/backup.sqlite`, toutes les N minutes). Les copies sont rangées dans ses propres sauvegardes.
- En cas de panne du PC principal, on restaure la dernière copie sur la seconde installation, et les zones changent d'adresse. Au pire, on perd les quelques minutes de saisie qui ont suivi la dernière copie.
- 🔧 Réglage au démarrage (par exemple `MIRROR_FROM=http://192.168.1.10:3000`).

### 7.5 Fiche « Préparer le jour J » (aide à l'écran)
Routeur Wi-Fi sans internet ; adresse fixe réservée pour le PC principal ; pare-feu Windows ouvert sur le port 3000 ; PC principal toujours branché, sans veille ; Windows Update suspendu pour la journée ; **ne jamais quitter Docker Desktop** ; adresse à ouvrir sur les autres postes, affichée en grand dans l'application.

## 8. Mise en ligne (étape C)

### 8.1 Une application, deux rôles
Un réglage au démarrage choisit le rôle de l'installation : `local` (par défaut, comme aujourd'hui) ou `serveur`. 🔧 Variable d'environnement.
- **serveur** : connexion obligatoire pour toute la gestion, HTTPS, pages publiques limitées à `/inscription/<jeton>`, envoi des mails.
- **local** : comme aujourd'hui, avec en plus l'adresse du serveur et le jeton de synchronisation (§9.1) s'il est relié à un serveur.

### 8.2 Comptes
- Table `users` : identifiant (e-mail), empreinte du mot de passe (fonction lente, par exemple scrypt de Node), rôle, zone éventuelle, date de création. Plus une table de sessions.
- Le premier compte organisateur est créé en ligne de commande, ou au premier lancement en mode serveur 🔧.
- Les comptes ne voyagent pas avec les compétitions.

### 8.3 Sécurité et données personnelles
- HTTPS obligatoire. Nombre de requêtes limité sur `/inscription/*` et sur la connexion (contre les essais de jetons ou de mots de passe).
- Ce sont des **données de mineurs** (nom, âge, poids). La page du club affiche une courte mention : qui traite les données, dans quel but, combien de temps, et qui contacter.
- **Texte proposé par défaut** ✅ (2026-10-23), modifiable dans les réglages de l'application : « Les informations saisies sur cette page sont traitées par Shidokan France pour organiser la compétition (inscriptions, catégories, tableaux). Le poids, le grade et les coordonnées du coach sont effacés 13 mois après la compétition ; les résultats (nom, club, catégorie, classement) sont conservés comme archive sportive. Pour toute question, ou pour exercer vos droits sur ces données : {contact}. » L'adresse de contact est à compléter dans les réglages avant d'ouvrir les inscriptions ; tant qu'elle est vide, l'organisateur est prévenu.
### 8.4 Durée de conservation ✅
- **Effacement automatique, sans avertissement** ✅ : un délai réglable (**13 mois** par défaut) après la date de la compétition. Une fois le délai passé, l'application efface d'elle-même les données qui ne servaient qu'à organiser la compétition, sans prévenir l'organisateur :
  - le poids (pesée et poids approximatif), la licence et le grade des combattants ;
  - la **copie** du téléphone et de l'e-mail du coach gardée dans le club de cette compétition. Les coordonnées de l'**annuaire** ne sont pas touchées : elles servent à recontacter le club pour les compétitions suivantes ✅ ;
  - les liens personnels (`club_invitations`) et le journal des mails (`mail_log`) ;
  - les fichiers importés (`uploads`).
- **Le palmarès est gardé** ✅ : nom, prénom, club, catégorie, tableaux, résultats des combats et notes de kata, places et podiums, tant que l'organisateur ne supprime pas la compétition. C'est une archive sportive, comme sur les plateformes de compétition (Smoothcomp garde aussi les vainqueurs) ✅ (2026-10-23).
- **Annuaire** ✅ : un club qui n'a participé à aucune compétition depuis **3 ans** est archivé, et ses coordonnées (coach, téléphone, e-mail, notes) sont effacées automatiquement. 💡 L'effacement est fait, comme le reste, sans avertissement.
- Le délai de 13 mois laisse le temps de traiter les contestations, et permet de reprendre les combattants de l'an dernier à l'édition suivante.
- 💡 S'applique **sur toutes les installations** (serveur et PC), au démarrage puis une fois par jour. Les **sauvegardes** plus anciennes que le délai sont supprimées, sauf la plus récente.
- La **mention** de la page du club (§8.3) reprend ces durées. Son texte est modifiable dans les réglages. 💡 Un texte par défaut est proposé, et il est à faire valider par Shidokan France s'ils ont un référent RGPD.
- 🔧 Où se règlent les délais (réglages de l'application), et comment on marque une compétition comme déjà effacée.

### 8.5 Hébergement ✅
Sur un **serveur existant** de l'organisation ✅. Il faut :
- Docker ;
- un nom de domaine ou un sous-domaine ;
- un certificat HTTPS automatique (par exemple Caddy) ;
- les sauvegardes automatiques existantes, plus une copie hors du serveur. 🔧

Les caractéristiques précises du serveur seront à voir avant l'étape C.

## 9. Passage de main et synchronisation (étape D) ✅ (protocole 💡)

### 9.1 Relier le PC au serveur
Dans les réglages du PC (installation `local`) : l'adresse du serveur et un **jeton de synchronisation**. Ce jeton est créé en ligne par un organisateur, révocable, et n'a qu'un seul usage : la synchronisation.

### 9.2 Les gestes, dans l'ordre
1. **Récupérer une copie**, possible à tout moment. Le PC télécharge la compétition et la garde **en lecture seule**. Bandeau : « Copie du serveur — synchronisé le … ». Le PC peut récupérer plusieurs fois, pour préparer ou vérifier.
2. **Prendre la main** (en principe juste après le gel des inscriptions). Le serveur note `owner_instance_id` = le PC, fige les inscriptions en ligne (si ce n'est pas déjà fait) et envoie la compétition. Sur le PC, la compétition devient modifiable. En ligne, elle passe en lecture seule, avec le bandeau « Gérée par le PC <nom> depuis le … ».
3. **Envoyer une copie au serveur**, pendant ou après la journée, s'il y a internet. Le serveur la range comme **archive** ; il ne remplace rien et le PC garde la main. Le PC affiche « Copie envoyée le … ». 💡
4. **Rendre la main**, après la compétition. Le PC envoie la compétition entière. Le serveur vérifie que ce PC a bien la main, **remplace** sa version par celle reçue (après une sauvegarde) et reprend la main. Sur le PC, la compétition repasse en lecture seule.

Chaque écran de compétition indique où est la main : « Gérée ici », « Gérée par <nom> », « Synchronisé le … ».

### 9.3 Ce qui voyage
- **Le paquet d'une compétition** : toutes les lignes des tables qui ont son `competition_id` (§3.5), sauf `uploads`, `club_invitations` et `mail_log`. On y ajoute les entrées d'annuaire reliées à ses clubs, la version de l'application et le nombre de migrations.
- 🔧 Format : un fichier JSON, éventuellement compressé.
- **Recevoir un paquet** remplace entièrement la compétition de même `id` sur la machine qui le reçoit, dans une seule transaction, après une sauvegarde automatique. Chaque entrée d'annuaire reçue est rapprochée des entrées locales : d'abord par `id`, puis selon la règle du §3.2. Si elle correspond à une entrée locale, les clubs de la compétition sont reliés à cette entrée, qui n'est **pas écrasée**. Sinon, elle est ajoutée.
- **Sans internet**, le même paquet peut aussi passer **par fichier** (clé USB) : « Exporter la compétition » et « Importer une compétition ». Les règles de main sont les mêmes.

### 9.4 Versions et refus
- Un paquet venant d'une **version plus récente** de l'application est refusé, avec le message « mettez à jour cette installation ». Un paquet plus ancien est accepté s'il est lisible. 🔧 Conversion entre versions.
- Le serveur refuse « Rendre la main » d'un PC qui ne l'a pas.

### 9.5 Reprise forcée
- **PC perdu ou en panne, côté serveur** : un organisateur peut **reprendre la main** en ligne, après confirmation. Le serveur repart de sa dernière version, ou de la dernière copie reçue (geste 3), au choix. Le PC verra ensuite son « Rendre la main » refusé, avec un message expliquant la situation. Il pourra encore exporter un fichier pour qu'un organisateur le récupère à la main.
- **Reprise par un second PC** (§7.4) : ce PC restaure la copie, mais son identité est différente (§3.1). Pour rendre la main, il faut qu'un organisateur accepte la reprise en ligne (« Le PC <B> remplace le PC <A> pour cette compétition »).

## 10. Plus tard : PC de zone autonomes (étape F) ✅ (principes 💡)

Ce cas ne se justifie que **s'il n'y a ni internet ni réseau local**. Dans tous les autres cas, les postes partagent une seule base (§7).

- **Chaque zone a la main sur ses propres combats** (et ses blocs de kata). Le découpage par zone et les numéros de passage figés existent déjà.
- Les zones n'envoient pas leur base. Elles envoient un **journal d'opérations** : « résultat du combat M de la catégorie C : vainqueur A, par KO, saisi par la zone 2 à 14 h 32, sur la base de la version V de la catégorie ». Le poste central rejoue chaque opération à travers les règles normales de l'application (mêmes vérifications que si elle avait été saisie sur place).
- **Un vrai conflit est montré à un humain**, jamais résolu tout seul. Par exemple : deux résultats différents pour un même combat, ou un résultat pour un combat dont les combattants ont changé depuis. On le présente sous forme de cartes, comme pour les réaffectations.
- Ce que l'étape 0 prépare pour ce cas : l'identité de chaque installation (§3.1), les versions de lignes (§3.4) et le fait qu'une compétition se suffise à elle-même (§3.5). `match_results` garde déjà les deux combattants au moment de la saisie, ce qui permet de détecter un combat qui a changé.
- 🔧 Forme exacte du journal. À concevoir le jour où le besoin se confirme.

## 11. Ordre des étapes ✅

| Étape | Contenu | Utile sans serveur |
|---|---|---|
| **0** | Données (§3) : identité, annuaire en base, main, versions, règle de garde | Oui (invisible) |
| **B** | Annuaire des clubs (§4) et page d'inscription du club (§5), utilisables d'abord en local | Oui |
| **C** | Mise en ligne (§8) et mails (§6) | — |
| **D** | Passage de main, transfert par le réseau ou par fichier (§9) | Transfert par fichier : oui |
| **A** | Plusieurs postes en réseau local (§7, sans comptes) : mise à jour automatique, protection contre les écrasements, postes, copie de secours, fiche jour J | Oui |
| **E** | Tout en ligne le jour J : étape A sur le serveur, avec des comptes par rôle, et prise de main par le PC en secours (§9.5) | — |
| **F** | PC de zone autonomes (§10), seulement si le besoin se confirme | — |

Ordre choisi ✅ (2026-10-23) : **0 → B → C → D → A → E → F**. Les inscriptions en ligne sont la priorité ; elles sont utilisables par les clubs à la fin de l'étape C, et une compétition inscrite en ligne se déroule hors ligne le jour J à partir de l'étape D (transfert par fichier au minimum). Les lettres gardent leur nom d'origine.

Seule l'étape 0 est à faire avant le 22 novembre ✅.

## 12. Hors périmètre et anti-objectifs
- Fusion automatique de deux bases, et règle « la dernière modification gagne ».
- Paiement en ligne des inscriptions.
- Comptes pour les coachs : le lien personnel suffit.
- Application mobile installable : la page web suffit.
- Synchronisation en continu, en arrière-plan, entre le PC et le serveur. Les gestes du §9 sont explicites.

## 13. Questions à trancher par l'organisateur
Réponses du 2026-10-23 :
1. Étape A pour le 22 novembre ? **Non** ✅ : seule l'étape 0 est faite d'ici là.
2. Hébergement : **un serveur existant** ✅ (§8.5). Ses caractéristiques seront à voir avant l'étape C.
3. Conservation : **13 mois** pour les données d'organisation, palmarès gardé, 3 ans pour l'annuaire, **effacement automatique sans avertissement** ✅ (§8.4).

Reste ouvert, avant l'étape C : la validation du texte de la mention sur les données personnelles par Shidokan France.

## 14. Laissé au constructeur 🔧
- Forme exacte des déclencheurs et de la migration de reprise de l'annuaire (§3.2, §3.4).
- Mécanisme de mise à jour des écrans (§7.1).
- Format du paquet et conversion entre versions (§9.3, §9.4).
- Bibliothèque d'envoi des mails, et chiffrement éventuel du mot de passe SMTP en base (§6).
- Hébergement, HTTPS et proxy (§8.5).
