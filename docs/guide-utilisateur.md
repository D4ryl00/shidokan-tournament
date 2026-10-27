# Guide de l'organisateur

Ce guide explique comment les installations de l'application travaillent ensemble, de la préparation d'une compétition jusqu'aux podiums. Le détail de chaque écran est dans l'application elle-même : la phrase sous chaque onglet et le bouton ⓘ.

L'installation du serveur en ligne est décrite à part : [installation-serveur.md](installation-serveur.md).

## 1. Vue d'ensemble

```
serveur en ligne  ⇄ jeton ⇄  PC principal  ⇄ réseau de la salle ⇄  postes (navigateur)
(inscriptions des clubs)     (le jour J)                           portables de zone
```

- **Le serveur en ligne** (`https://competitions.shidokanfrance.com`) sert avant et après la compétition : annuaire des clubs, inscriptions en ligne, mails, palmarès. On s'y connecte avec un compte (e-mail et mot de passe).
- **Le PC principal** fait tourner l'application dans la salle, sans internet. Il ne demande **aucune connexion** : la personne devant l'écran a tous les droits. Il ne doit donc jamais être exposé sur internet, et le réseau de la salle doit être de confiance.
- **Les postes** (table centrale, zones) n'installent rien : ils ouvrent l'adresse du PC principal dans leur navigateur.
- **Les portables de zone**, s'il y en a, font tourner leur propre copie de l'application, tenue à jour par le PC principal. Ils permettent à une zone de continuer si le réseau de la salle tombe.

Une compétition n'est modifiable qu'à un seul endroit à la fois : **là où est la main** (le serveur ou le PC). Ailleurs, elle est en lecture seule, et un bandeau le dit.

Ce qui permet à ces installations de se parler :

| Liaison | Comment | Où la régler |
|---|---|---|
| PC principal → serveur | un **jeton de synchronisation**, créé sur le serveur | Réglages de l'application → Synchronisation, des deux côtés |
| Postes → PC principal | rien : l'adresse du PC dans le navigateur | — |
| Portable de zone → PC principal | rien : l'adresse du PC | Réglages de l'application → Portable de zone, sur le portable |

Le jeton ne sert qu'à échanger des compétitions : il ne donne accès ni à l'interface ni aux comptes. Il ne s'affiche qu'une fois, se révoque à tout moment, et n'est jamais copié dans les sauvegardes. Les comptes, les jetons, les réglages d'envoi des mails et la mention sur les données ne voyagent jamais : chaque installation garde les siens.

## 2. Installer le PC de la compétition

**Prérequis :** Docker Desktop (Windows ou macOS, virtualisation activée) et Google Chrome.

Dans le dossier de l'application :

```bash
docker compose up -d --build   # démarrer
docker compose down            # arrêter
```

Puis ouvrir **http://localhost:3000** dans Chrome.

- **Il n'y a pas d'internet au gymnase** : construisez l'image **avant** d'y aller, sur le PC qui servira le jour J, et vérifiez qu'elle démarre.
- **Les données** sont dans le dossier `data/`, à côté de `compose.yaml` : la base `data/shidokan.sqlite` et les sauvegardes automatiques dans `data/sauvegardes/` (toutes les 5 minutes, les 30 dernières gardées ; `BACKUP_INTERVAL_MIN` dans `compose.yaml`, 0 pour désactiver).
- **Pour copier `data/`** (clé USB, autre PC), arrêtez d'abord l'application. N'ouvrez jamais la base avec un autre programme pendant qu'elle tourne.
- Sauvegarder, télécharger la base complète ou restaurer une sauvegarde : onglet **Podiums**, section des sauvegardes.

## 3. Relier le PC au serveur (une fois)

1. **Sur le serveur**, connecté en organisateur : Réglages de l'application → **Synchronisation** → « Créer un jeton », nommé par exemple « PC compétition ». Copiez-le tout de suite.
2. **Sur le PC** : Réglages de l'application → **Synchronisation**. Collez l'adresse `https://competitions.shidokanfrance.com` et le jeton, puis « Enregistrer ».

Un PC perdu ou volé permet de lire toutes les compétitions du serveur : **révoquez son jeton** (même section, sur le serveur).

## 4. Préparer la compétition (en ligne)

Les onglets de l'étape **Préparer**, dans l'ordre habituel :

1. **Annuaire des clubs** (menu de l'application) : clubs, adresses e-mail (une ou plusieurs par club : coach, président, secrétariat… — Entrée ou virgule entre deux), et si possible le numéro d'affiliation FFK. Les coordonnées des coachs peuvent venir de vos contacts Google (voir plus bas).
2. Créez la compétition, puis **Réglages** (zones de combat, formats, ordre de passage…) et **Grille âge / poids** (la grille FFK est déjà remplie). Dans la grille, la section **Catégories ouvertes** ferme ce que vous n’ouvrez pas à cette compétition (par exemple pas de shido-mix chez les benjamins) : ces catégories disparaissent de la fiche club et de l’inscription en ligne. Un combattant déjà inscrit dans une catégorie fermée apparaît en Réaffectation.
3. **Sessions**, si la compétition se pèse et se lance en plusieurs fois (« Samedi matin », « Dimanche »…).
4. **Fiche club** — les clubs inscrivent leurs combattants de l'une de ces façons :
   - **en ligne** (section « Inscriptions en ligne ») : date limite, « Ouvrir les inscriptions », inviter les clubs, puis « Envoyer le lien par mail ». **Chaque envoi crée un nouveau lien** et désactive le précédent. Un seul mail part par club ; pour un club qui a plusieurs adresses, la fenêtre d'envoi montre une case par adresse, toutes cochées : décochez celles qui ne doivent pas le recevoir (pour cet envoi seulement). À la date limite, « Figer les inscriptions ». Les mails partent du compte réglé dans Réglages de l'application → **Envoi des mails** (« Compte Google », voir plus bas, ou « Autre serveur ») ;
   - **par fichier** : envoyer le modèle (.ods) ou la fiche papier (PDF), puis importer ou saisir les fiches renvoyées. Les fiches indiquent les catégories non ouvertes ; une fiche renvoyée qui en contient quand même est acceptée avec un avertissement, et ces combattants passent en Réaffectation.
5. **Import FFK**, à la clôture : aperçu, rapprochement avec les fiches des clubs, import.
6. **Inscriptions** et **Clubs** : vérifier, corriger, ajouter sur place.

### Le compte Google (mails et contacts)

Sur le serveur en ligne, Réglages de l'application → **Envoi des mails** → « Compte Google » → **« Se connecter avec Google »**, avec le compte de Shidokan France. Google demande en une fois deux autorisations : **envoyer des mails** (les invitations aux clubs) et **voir vos contacts** (lecture seule : l'application ne modifie jamais vos contacts). Google affiche « application non validée » : cliquez sur « Paramètres avancés », puis « Accéder ».

- Laissez les deux cases cochées. Si « contacts » est décochée, les mails fonctionnent mais la synchronisation des coachs non : la ligne « Contacts : non accordé » le rappelle dans les Réglages ; « Se reconnecter » corrige.
- Se reconnecter avec **un autre compte** Google efface les liens entre l'annuaire et les contacts (ils appartenaient à l'ancien compte).
- La préparation côté Google (une fois, par l'administrateur du serveur) est décrite dans `docs/installation-serveur.md`.

### Coordonnées des coachs depuis Google Contacts

Rangez les contacts des coachs sous un **libellé** dans Google Contacts (par exemple « Coachs »). Le champ **Entreprise** d'un contact, s'il porte le nom du club, aide l'application à proposer le bon club.

Dans l'**Annuaire**, « **Synchroniser avec Google** » ouvre une page unique. **Rien ne change dans l'annuaire avant « Appliquer ».**

1. **Libellé** : choisissez-le en haut (ou « Tous les contacts ») ; il est repris la fois suivante.
2. **Différences avec l'annuaire** : pour chaque club déjà lié à un contact, le coach, le téléphone et les adresses e-mail qui diffèrent. **Google l'emporte** : chaque ligne est cochée. Décochez une ligne pour garder la valeur de l'annuaire — cela ne vaut que cette fois, la différence reviendra à la synchronisation suivante. Toutes les adresses d'un contact sont lues : celles qui manquent dans l'annuaire sont proposées **en ajout** (« + adresse »), et une adresse de l'annuaire absente de Google n'est jamais retirée. Un champ vide dans Google n'efface jamais l'annuaire ; une valeur que l'annuaire refuserait (adresse mal écrite, texte trop long) est signalée « valeur Google non reprise ».
3. **Nouveaux contacts**, pour chacun :
   - **Lier à un club** : le club de l'annuaire qui a une adresse e-mail en commun, sinon le même téléphone, est déjà choisi ; un nom qui ressemble est seulement proposé (« Peut-être : … ? »). Un club déjà lié à un autre contact n'est jamais choisi d'office.
   - **Nouveau club** : saisissez le nom du club (pré-rempli avec « Entreprise ») ; la fiche est créée avec les coordonnées du contact (toutes ses adresses e-mail), et vous pourrez inviter ce club.
   - **Plus tard** : le contact est rangé dans « En attente d'un rattachement », où les mêmes choix restent possibles.
   - « + Lier aussi à un autre club » : pour un coach qui tient deux clubs.
4. **Appliquer** : tout est enregistré d'un coup. Si l'annuaire a été modifié entre-temps, rien n'est enregistré et la page se recharge : vérifiez, puis appliquez de nouveau.

Un club lié porte la marque « Google » dans l'annuaire ; « **Ne plus synchroniser avec Google** » (menu « … » du club) retire le lien sans rien effacer. Archiver un club retire aussi son lien.

## 5. La veille : passer la compétition au PC

Avec internet, sur le PC :
1. Liste des compétitions → « Récupérer depuis le serveur ».
2. Sur la compétition → « **Prendre la main** ». Le PC devient le seul endroit où la modifier ; en ligne, elle passe en lecture seule et les inscriptions des clubs sont figées.

Sans internet : sur le serveur, onglet Réglages de la compétition → « Échanges avec le serveur » → « Exporter la compétition (fichier) » en cochant « et donner la main au PC qui l'importera » ; sur le PC, « Importer une compétition (fichier) ».

Puis préparez la salle avec la fiche Réglages de l'application → **Préparer le jour J**. Si vous avez un second PC, réglez-y Réglages de l'application → **Copie de secours** avec l'adresse du PC principal : il en garde une copie récente.

## 6. Le jour J

### Les postes

1. Le PC principal et les postes sont sur le même réseau (Wi-Fi de la salle).
2. Chaque poste ouvre `http://<adresse du PC>:3000` dans Chrome, puis choisit son **poste** en haut de l'écran d'une compétition : Organisation, Table centrale, ou une zone. Les écrans se mettent à jour tout seuls.
3. **À vérifier avant le début** : depuis un poste, l'adresse du PC s'ouvre bien. Sinon, autorisez le port 3000 dans le pare-feu du PC (Windows), et vérifiez que Docker Desktop tourne.

### Les portables de zone (facultatif)

Sur chaque portable, avant le début : Réglages de l'application → **Portable de zone**. Indiquez l'adresse du PC principal (par exemple `http://192.168.1.10:3000`), « Chercher », choisissez la compétition et la zone, puis enregistrez. L'arbitre continue à travailler sur le PC principal dans son navigateur ; le portable garde une copie à jour en arrière-plan.

### Le déroulé

Les onglets de l'étape **Jour J** :
1. **Pesée** : poids et présence ; « Clôturer la pesée » marque absents les non-pesés.
2. **Réaffectation** : une carte pour chaque combattant seul, hors de sa catégorie, ou inscrit dans une catégorie fermée (propositions, aperçu, validation). Pour une catégorie fermée, vous pouvez aussi choisir « Ne combat pas » : le coach le voit sur sa page d’inscription, et « Annuler » dans l’historique le remet en place. « Mettre de côté » écarte une carte que vous ne pouvez pas trancher tout de suite (une note facultative rappelle pourquoi) : elle ne compte plus dans les cas à traiter, se retrouve dans « Mises de côté », et le lancement de la session vous la rappelle.
3. **Tableaux** : vérifier, « Marquer prête », imprimer.
4. **Combats** : quand les catégories d'une session sont prêtes, « Figer et imprimer la session » fixe les numéros de passage et imprime ses tableaux. Les résultats se saisissent zone par zone, le combat « à l'appel » en tête de chaque zone.

Pendant la journée, s'il y a internet : Réglages de la compétition → « Échanges avec le serveur » → « Envoyer une copie au serveur » (copie de secours ; le PC garde la main).

### Si le réseau de la salle tombe

- **Une zone avec portable** : sur le portable, ouvrir http://localhost:3000, la compétition, puis « Continuer sans réseau (zone …) ». Seuls les résultats de cette zone se saisissent. Au retour du réseau, « Repasser en ligne » renvoie les saisies au PC principal.
- **Sans réseau du tout** : sur le portable, « Exporter le journal (fichier) » ; sur le PC principal, onglet Combats, « Importer un journal de zone (fichier) ». Une saisie déjà reçue n'est jamais appliquée deux fois ; les saisies en conflit apparaissent dans « À trancher ».
- **Le PC principal tombe en panne** : sur le second PC, restaurez la dernière copie (Réglages de l'application → Copie de secours), puis ouvrez l'adresse de ce PC sur les postes.

## 7. Après la compétition

1. **Podiums** (étape Après) : podiums, classement des clubs, feuilles de résultats, exports .xlsx / .ods.
2. Sur le PC : Réglages de la compétition → « Échanges avec le serveur » → « **Rendre la main au serveur** ». Le serveur reprend la compétition entière, avec ses résultats ; le PC garde une copie en lecture seule.

Sans internet : « Exporter la compétition (fichier) » sur le PC, puis sur le serveur « Importer une compétition (fichier) » et confirmer « Reprendre la main ».

**PC perdu ou en panne** : sur le serveur, « Échanges avec le serveur » → « Reprendre la main » (à partir de la version du serveur, ou de la dernière copie reçue pendant la journée), et révoquez le jeton du PC. Si un autre PC a continué la compétition, exportez-la en fichier depuis ce PC, puis importez-la en ligne.

**Supprimer une compétition** (une démo, une erreur) : liste des compétitions → « Supprimer », puis retapez son nom. Tout ce qu’elle contient est effacé de cette installation seulement, et une sauvegarde est faite juste avant. Pour revenir en arrière : onglet Podiums d’une autre compétition → Sauvegardes ; la restauration remet toutes les compétitions dans l’état de ce moment-là. La suppression ne se propage jamais : supprimée sur le serveur, la compétition reste sur les PC qui en ont une copie ; supprimée sur le PC principal, elle reste sur les portables de zone. Ces copies ne sont plus mises à jour (« La compétition a été supprimée… ») et se suppriment de la même façon, sauf un portable en zone autonome (repassez d’abord en ligne). Sur le serveur, une compétition dont un PC a la main ne peut pas être supprimée.

## Variante : le jour J tout en ligne, avec le PC en secours

S'il y a internet dans la salle, la compétition peut se dérouler directement sur le serveur : la table centrale et chaque zone ouvrent `https://competitions.shidokanfrance.com` et se connectent avec leur compte.

**La veille :**
1. Sur le serveur, menu **Comptes** : un compte **Table centrale**, et un compte **Zone** par zone de la compétition (les rôles : [installation-serveur.md](installation-serveur.md#3-créer-le-premier-compte-organisateur)).
2. Sur le PC de la salle, relié au serveur : « Récupérer une copie » de la compétition, puis cochez « **Garder cette copie à jour** » (Réglages de la compétition → « Échanges avec le serveur »). Le PC la récupère toutes les quelques minutes, en lecture seule.

**Si internet tombe :**
1. Sur le PC : « **Prendre la main en secours** ». La copie devient modifiable tout de suite.
2. Les postes ouvrent l'adresse du PC sur le réseau de la salle (section 6), et reprennent les saisies faites depuis la dernière copie.

**Quand internet revient**, sur le PC : « **Prévenir le serveur** ».
- Si rien n'a changé en ligne depuis la copie du PC, la main passe au PC. La suite est la même que d'habitude : « Rendre la main au serveur » à la fin.
- Sinon, le serveur refuse et l'explique. « **Remplacer la version en ligne** » met alors la version du PC en ligne ; celle du serveur reste dans la sauvegarde qu'il fait juste avant.
