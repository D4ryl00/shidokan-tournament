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
- **Les données** sont dans le dossier `data/`, à côté de `compose.yaml` : la base `data/shidokan.sqlite` et les sauvegardes automatiques dans `data/sauvegardes/` (toutes les 5 minutes quand quelque chose a changé, les 200 dernières gardées ; `BACKUP_INTERVAL_MIN` dans `compose.yaml`, 0 pour désactiver).
- **Pour copier `data/`** (clé USB, autre PC), arrêtez d'abord l'application. N'ouvrez jamais la base avec un autre programme pendant qu'elle tourne.
- Sauvegarder ou restaurer : voir [Sauvegarder et restaurer](#8-sauvegarder-et-restaurer).

## 3. Relier le PC au serveur (une fois)

1. **Sur le serveur**, connecté en organisateur : Réglages de l'application → **Synchronisation** → « Créer un jeton », nommé par exemple « PC compétition ». Copiez-le tout de suite.
2. **Sur le PC** : Réglages de l'application → **Synchronisation**. Collez l'adresse `https://competitions.shidokanfrance.com` et le jeton, puis « Enregistrer ».

Un PC perdu ou volé permet de lire toutes les compétitions du serveur : **révoquez son jeton** (même section, sur le serveur).

## 4. Préparer la compétition (en ligne)

Les onglets de l'étape **Préparer**, dans l'ordre habituel :

1. **Annuaire des clubs** (menu de l'application) : clubs, adresses e-mail (une ou plusieurs par club : coach, président, secrétariat… — Entrée ou virgule entre deux), et si possible le numéro d'affiliation FFK. Les coordonnées des coachs peuvent venir de vos contacts Google (voir plus bas).
2. Créez la compétition ; un clic sur son nom l'ouvre sur **Inscriptions**. Passez ensuite par **Réglages** (zones de combat, formats, ordre de passage des combats : « tour par tour » ou « catégorie par catégorie »…, la place des finales se règle dans l'onglet **Finales**) et **Catégories** (la grille âge / poids FFK est déjà remplie ; le bloc **Tableaux libres** crée des tableaux hors grille où l'on place des combattants à la main). Dans cet onglet, la section **Catégories ouvertes** ferme ce que vous n'ouvrez pas à cette compétition (par exemple pas de shido-mix chez les benjamins) : ces catégories disparaissent de la fiche club et de l'inscription en ligne. Un combattant déjà inscrit dans une catégorie fermée apparaît en Réaffectation.
3. **Sessions**, si la compétition se pèse et se lance en plusieurs fois (« Samedi matin », « Dimanche »…).
   - **Finales** (juste après Sessions, poste Organisation) : où et quand se joue la finale de chaque catégorie, session par session. Voir « Les finales : où et quand » plus bas.
4. **Fiche club** — les clubs inscrivent leurs combattants de l'une de ces façons :
   - **en ligne** (section « Inscriptions en ligne ») : date limite, « Ouvrir les inscriptions », inviter les clubs, puis « Envoyer le lien par mail ». **Inviter un club ne crée aucun lien** : il rejoint le tableau avec « 0 lien », et son lien se crée à l'envoi, ou par « Créer un lien » dans la colonne « Accès ». **Chaque envoi ajoute un nouveau lien** au club : les liens déjà envoyés restent valables. Un seul mail part par club ; pour un club qui a plusieurs adresses, la fenêtre d'envoi montre une case par adresse, seule la première cochée : cochez les autres si elles doivent aussi le recevoir (pour cet envoi seulement). À la date limite, « Figer les inscriptions ». Cette section n'existe que sur le serveur en ligne : un PC ne peut ni envoyer d'invitations ni ouvrir les inscriptions en ligne, et pour envoyer, la main doit être sur le serveur. Les mails partent du compte réglé dans Réglages de l'application → **Envoi des mails** (« Compte Google », voir plus bas, ou « Autre serveur ») ;
   - **par fichier** : envoyer le modèle (.ods) ou la fiche papier (PDF), puis importer ou saisir les fiches renvoyées. Pour **importer une fiche .ods**, le club est celui dont le nom écrit dans le fichier correspond à un club de la compétition (casse, accents et noms FFK connus ignorés). Sinon une étape « Club de la fiche » demande de choisir le club (ou de l'ajouter, la fenêtre étant pré-remplie avec le nom et le coach du fichier) avant l'aperçu ; aucun club n'est créé d'après le nom du fichier, et un club de l'annuaire n'entre dans la compétition qu'à « Importer ». Les coordonnées renseignées dans le fichier sont ajoutées au club (une case vide n'efface rien) et ce qui diffère de l'annuaire devient un changement à examiner (« Comparer »). Pour **saisir une fiche papier**, on choisit d'abord le club (un club de la compétition ou de l'annuaire, ou « Ajouter un club ») : la saisie ne demande ni coach, ni téléphone, ni e-mails et ne les modifie pas (ils se changent dans l'annuaire). Le pré-accord du coach est repris du club, décoché pour un club de l'annuaire, et reste modifiable ; un club de l'annuaire n'entre dans la compétition qu'à « Enregistrer la fiche ». Quand la compétition autorise plusieurs combats par combattant, plusieurs disciplines de combat se cochent sur une ligne, avec un seul règlement. Les fiches indiquent les catégories non ouvertes ; une fiche renvoyée qui en contient quand même est acceptée avec un avertissement, et ces combattants passent en Réaffectation.
5. **Import FFK**, à la clôture : aperçu, rapprochement avec les fiches des clubs, import.
6. **Inscriptions** et **Clubs** : vérifier, corriger, ajouter sur place. « Ajouter » ouvre d'abord le choix du club (un club de la compétition ou de l'annuaire, ou « Ajouter un club »), puis la fenêtre du combattant, la même que celle du coach : les inscriptions saisies ainsi portent la mention « sur place », et « Enregistrer et ajouter un autre » (ou la touche Entrée) confirme par une notification et rouvre une fenêtre vide pour le même club (rien n'est gardé, pour ne pas oublier de changer un champ) ; en modification, Entrée enregistre. Le crayon d'une ligne ouvre le combattant entier (toutes ses inscriptions) ; « Changer de club » le passe dans un autre club. Le brouillon de la fenêtre est gardé quand on passe par le choix du club. Pour un combattant dont un combat a commencé, ce qui a commencé ne se change plus dans cette fenêtre : sexe, âge, et dès qu'un combat a commencé, poids, règlement et reclassement ; ni « Supprimer » ni « Changer de club ». Le nom, le prénom, le grade et « Masquer le nom » se corrigent encore (la correction apparaît aussitôt sur les tableaux et la page publique), et on peut lui ajouter une autre discipline (combat ou kata) ou en retirer une qui n'a pas commencé. La catégorie d'une discipline se change dans Réaffectation ou Tableaux (« Déplacer vers… », planche), tant que sa session n'est pas lancée. L'organisateur peut choisir une catégorie non ouverte (marquée « non ouverte »), ou plusieurs combats quand le réglage de la compétition n'en prévoit qu'un : l'inscription est enregistrée avec un avertissement.

### Les finales : où et quand (Préparer → Finales)

Chaque session a son propre réglage des finales, pour les combats comme pour les katas. L'onglet **Finales** s'ouvre sur un sélecteur de session (absent s'il n'y a pas de session) et propose :

- **Zone des finales**, par session : une zone quelconque de la compétition (un ring d'honneur, un tatami déjà occupé par un autre tournoi, par exemple), ou « Aucune » : chaque finale reste alors sur la zone de sa catégorie. Choisir une zone met toutes les catégories de la session dessus ; « Aucune » fait disparaître la colonne « Où ».
- **Un tableau, une ligne par catégorie**, avec la zone actuelle de la catégorie et deux interrupteurs :
  - **Où** : « Sa zone » ou « [nom de la zone des finales] ». Une catégorie déjà sur la zone des finales affiche « sur [zone] ». Si la zone des finales n'accueille pas la discipline (zones limitées à certaines disciplines), « Où » reste sur « Sa zone » et la raison est écrite (« Tatami 3 n’accueille pas le kata »).
  - **Quand** : « Dès que finie » (la finale passe dès que sa catégorie est terminée) ou « Fin de session » (après tous les combats de la zone). Pour un kata, « finie » veut dire « tour 1 fini » ; sa finale est le tour 2.
- **Boutons « Tout… »** au-dessus de chaque colonne (« Tout sur [zone] », « Tout sur sa zone », « Tout dès que finie », « Tout en fin de session ») : un clic règle toutes les catégories de la session. Une catégorie qui apparaît plus tard (tableau libre, réaffectation) prend le dernier « Tout… » utilisé dans la session. Une catégorie qui change de session garde ses propres choix ; seul ce qui n'a jamais été choisi pour elle prend le dernier « Tout… » de sa nouvelle session.
- **Une poule unique n'a pas de finale** : une fois son tableau tiré, sa ligne le dit (« pas de finale (poule) ») et ses choix sont sans effet. Avant (avant la pesée, par exemple), chaque catégorie a ses deux interrupteurs.
- **Un résumé par zone** sous le tableau : ce que chaque zone jouera (combats, puis finales dès que prêtes, puis finales en fin de session).

Chaque changement s'enregistre tout seul. Sans toucher à rien, les valeurs reproduisent l'ancien comportement : « Dès que finie » en « catégorie par catégorie » sans zone des finales, « Fin de session » sinon. À « Figer et imprimer la session », les choix de chaque catégorie figée sont enregistrés tels qu'ils sont : changer ensuite l'ordre de passage des combats (Réglages) ne déplace plus ses finales.

**L'ordre qui en découle** (les numéros se calculent à « Figer et imprimer la session »)
- Sur la zone des finales : d'abord **tous ses combats propres**, sans exception, pour laisser ses combattants se reposer ; puis les finales « Dès que finie », dans l'ordre où leurs catégories se terminent ; puis les finales « Fin de session », dans l'ordre des catégories. Les finales de ses propres catégories passent avec les autres finales.
- Sur une autre zone : une finale « Sa zone » + « Dès que finie » passe juste après le dernier combat de sa catégorie ; « Fin de session », à la fin de la file de la zone.
- Un kata « Sa zone » + « Dès que finie » reste un seul passage (tour 1 et finale d'affilée) ; tout autre choix sépare le tour 1 et la finale.

**Session figée, puis rouverte**
- Une session figée est en **lecture seule** dans l'onglet Finales : « Rouvrez la session dans Combats pour changer », car changer une finale changerait des numéros déjà imprimés.
- Une fois la session rouverte, le tableau redevient modifiable. Une catégorie dont un choix a changé (Où, Quand, ou zone des finales de la session) redevient « à numéroter ». À « Refiger la session », les zones touchées sont **renumérotées « mélangés »** : les passages non joués de la zone prennent leur nouvelle place, les passages déjà joués gardent leur numéro. La fenêtre de refigeage le dit (« Les finales ont changé : les zones concernées sont renumérotées (mélangés). ») et nomme ces zones (« Zones renumérotées : Tatami 1, Tatami 3. ») ; « À la suite » y est grisé (non sélectionnable).

### Le message aux clubs

Réglages de l'application → **Message aux clubs** (modèle commun) ou, par compétition, « Message aux clubs de cette compétition ». L'éditeur propose gras, italique, souligné, couleur, surlignage, titres, listes, citation, alignement et lien. Il n'y a pas de choix de police ni de taille de texte, ni de tableau.

- **Lien** : `www.club.fr` devient `https://www.club.fr` et `contact@club.fr` une adresse e-mail ; les autres adresses (`club.fr`, `tel:…`) sont refusées avec un message. `{lien}` met le lien personnel du club derrière un mot.
- **Images** : bouton image, collage ou glisser-déposer ; trois tailles d'affichage (« Petite », « Moyenne », « Pleine largeur » : 200, 400 ou 600 px). 10 images au plus par message, JPEG, PNG, WebP ou GIF. Chaque image est réduite à 1200 px de large et 2 Mo au plus, et une photo JPEG perd ses informations cachées (appareil, position GPS) ; un GIF n'est jamais réduit et est refusé au-delà de 2 Mo. Pendant l'envoi d'une image, l'enregistrement attend.
- **Compétition importée sur une autre installation** : les images ne voyagent pas avec la compétition. Le message arrive sans elles et tout envoi est refusé tant qu'elles manquent : remettez-les dans l'éditeur et enregistrez.
- **Code source (HTML)** : on peut coller un message tout fait. Ce que le mail ne peut pas porter (scripts, images prises sur internet…) est retiré : un avis le dit en quittant le mode code, et l'enregistrement est indisponible tant que le mode code est ouvert. À l'enregistrement, « Retiré du message : … » dit aussi ce que le filtre a enlevé.
- **Modifications non enregistrées** : quitter l'onglet demande confirmation, et les fenêtres d'envoi et de messagerie préviennent que c'est la dernière version enregistrée qui partira.
- **Envoi par l'application** : message mis en forme, avec une version sans mise en forme. Un mail pèse 18 Mo au plus (images, fiches et pièces jointes) ; si c'est trop lourd ou si une image manque, rien ne part et aucun lien n'est créé.
- **« Ouvrir dans ma messagerie »** ne transmet que le texte : ni mise en forme ni images, et les pièces jointes sont à joindre soi-même.
- **Sur le serveur seulement** : un PC n'a ni cette section ni l'envoi de mails. Pour envoyer, la main doit être sur le serveur. Après l'installation, faites l'essai décrit dans [verification-mail-boites-reelles.md](verification-mail-boites-reelles.md).

### Le compte Google (mails et contacts)

Sur le serveur en ligne, Réglages de l'application → **Envoi des mails** → « Compte Google » → **« Se connecter avec Google »**, avec le compte de Shidokan France. Google demande en une fois deux autorisations : **envoyer des mails** (les invitations aux clubs) et **voir vos contacts** (lecture seule : l'application ne modifie jamais vos contacts). Google affiche « application non validée » : cliquez sur « Paramètres avancés », puis « Accéder ».

- Laissez les deux cases cochées. Si « contacts » est décochée, les mails fonctionnent mais la synchronisation des coachs non : la ligne « Contacts : non accordé » le rappelle dans les Réglages ; « Se reconnecter » corrige.
- Se reconnecter avec **un autre compte** Google efface les liens entre l'annuaire et les contacts (ils appartenaient à l'ancien compte).
- La préparation côté Google (une fois, par l'administrateur du serveur) est décrite dans `docs/installation-serveur.md`.

### Coordonnées des clubs : annuaire et compétitions

Un club de compétition est une **copie de sa fiche d'annuaire, faite à l'invitation**. Les deux ne se suivent pas tout seuls : c'est vous qui décidez.

- **Ce qui ne modifie pas une fiche d'annuaire existante** : ce qu'un coach saisit sur sa page d'inscription, et ce que vous changez dans l'onglet **Clubs** d'une compétition. (Un club qui n'avait pas de fiche en reçoit une, créée avec ses valeurs : il n'y a alors rien à examiner.) Le club de la compétition prend la valeur saisie ; si elle diffère de la fiche (nom du club, coach, téléphone, adresses e-mail, numéro d'affiliation), un **changement à examiner** est enregistré. Un coach n'est jamais bloqué par un changement en attente.
- **Où le voir** : dans l'**Annuaire**, un bandeau « N clubs diffèrent de l'annuaire » avec « **Voir les changements** », et sur chaque fiche concernée l'origine (modifié par le club, ou dans la compétition) et « **Comparer** ». Une fiche archivée n'affiche ni bandeau ni pastille. Dans l'onglet **Clubs**, après « Modifier » un club qui diffère de l'annuaire, une notification propose « **Comparer** » tout de suite ; la pastille de la ligne du club rappelle seulement l'origine. En tête de la **Fiche club** d'une compétition, un bandeau par club concerné (au-delà de 3 clubs, un seul bandeau qui en donne le nombre). « Voir les changements » ouvre le premier, puis enchaîne sur le suivant après chaque décision.
- **La fenêtre de comparaison** : une ligne par champ, avec la valeur de l'annuaire et celle de la compétition ; pour les adresses e-mail, une case par adresse. Trois sorties : « **Enregistrer dans l'annuaire** » applique vos choix ; « **Ignorer ce changement** » le ferme sans rien toucher ; « **Plus tard** » ferme la fenêtre et le garde. Le sous-titre donne la compétition et la date du changement. La case « **Appliquer aussi au club dans** *<nom de la compétition>* » reporte le résultat dans le club de la compétition. Si la fiche a changé pendant que la fenêtre était ouverte, rien n'est enregistré et la comparaison se recharge.
- **« Ignorer » dure jusqu'à une autre modification** : si le coach réenregistre les mêmes valeurs, rien ne revient ; si une valeur change, vous êtes prévenu de nouveau.
- **Un champ effacé est proposé** comme une modification : l'annuaire n'est vidé que si vous choisissez la valeur vide. Par défaut, la valeur de l'annuaire reste choisie, et si le coach a effacé toutes ses adresses, celles de la fiche restent cochées : il faut un clic (ou décocher les adresses) pour vider la fiche. Seules les valeurs modifiées par les enregistrements (page du club ou onglet Clubs) depuis la dernière décision sont proposées par défaut ; les autres différences, plus anciennes, gardent la valeur de l'annuaire, et une adresse seulement dans la compétition reste décochée (« seulement dans la compétition »). Le nom du club ne peut pas être vide.
- **Compétition gérée par un PC** : le club ne peut pas y être modifié depuis le serveur ; la case est désactivée avec « Gérée par … : à appliquer après le retour de la main », et l'annuaire reste modifiable. **Compétition passée** : seul l'annuaire est modifié.
- **Dans l'autre sens** : quand vous modifiez une fiche d'annuaire et que des clubs de compétitions **à venir** (date du jour ou après) y sont reliés et diffèrent, « **Appliquer aux compétitions à venir ?** » s'ouvre. Sans conflit, la ligne est cochée. En cas de conflit (le club avait une autre valeur que l'ancienne fiche), « **Garder le club** » est choisi par défaut, ou « **Prendre l'annuaire** ». « **Ne rien appliquer** » ferme la fenêtre ; la fiche, elle, est déjà enregistrée. Les compétitions passées ne sont pas proposées, et une compétition sous la main d'un PC est affichée sans pouvoir être modifiée.
- **Plus tard, depuis la fiche** : « **Appliquer aux compétitions à venir…** » (menu « … » d'une fiche) propose de nouveau les clubs de compétitions à venir qui diffèrent de la fiche, par exemple après une fenêtre fermée sans rien appliquer. Les valeurs d'avant n'étant plus connues, chaque ligne est un conflit : choisissez « Prendre l'annuaire » pour y reporter la fiche.
- **Ce qui ne crée aucun changement à examiner** : la synchronisation Google, l'import d'une fiche et l'import FFK. Après la synchronisation Google, « Appliquer aux compétitions à venir ? » s'ouvre pour chaque fiche modifiée dont des clubs de compétitions à venir diffèrent.
- **Sur un PC** : les bandeaux et la fenêtre fonctionnent pour les compétitions gérées sur ce PC, sans page en ligne.

### Coordonnées des coachs depuis Google Contacts

Rangez les contacts des coachs sous un **libellé** dans Google Contacts (par exemple « Coachs »). Le champ **Entreprise** d'un contact, s'il porte le nom du club, aide l'application à proposer le bon club.

Dans l'**Annuaire**, « **Synchroniser avec Google** » ouvre une page unique. **Rien ne change dans l'annuaire avant « Appliquer ».**

1. **Libellé** : choisissez-le en haut (ou « Tous les contacts ») ; il est repris la fois suivante.
2. **Différences avec l'annuaire** : pour chaque club déjà lié à un contact, le coach, le téléphone et les adresses e-mail qui diffèrent. **Google l'emporte** : chaque ligne est cochée. Décochez une ligne pour garder la valeur de l'annuaire — cela ne vaut que cette fois, la différence reviendra à la synchronisation suivante. Toutes les adresses d'un contact sont lues : celles qui manquent dans l'annuaire sont proposées **en ajout** (« + adresse »), et celles de l'annuaire absentes de Google **en retrait**, en rouge (« − adresse ») ; décochez la ligne pour garder les adresses de l'annuaire. Un contact sans adresse ne retire rien. Un champ vide dans Google n'efface jamais l'annuaire ; une valeur que l'annuaire refuserait (adresse mal écrite, texte trop long) est signalée « valeur Google non reprise ».
3. **Nouveaux contacts**, pour chacun :
   - **Lier à un club** : le club de l'annuaire qui a une adresse e-mail en commun, sinon le même téléphone, est déjà choisi ; un nom qui ressemble est seulement proposé (« Peut-être : … ? »). Un club déjà lié à un autre contact n'est jamais choisi d'office.
   - **Nouveau club** : saisissez le nom du club (pré-rempli avec « Entreprise ») ; la fiche est créée avec les coordonnées du contact (toutes ses adresses e-mail), et vous pourrez inviter ce club.
   - **Plus tard** : le contact est rangé dans « En attente d'un rattachement », où les mêmes choix restent possibles.
   - « + Lier aussi à un autre club » : pour un coach qui tient deux clubs.
4. **Appliquer** : tout est enregistré d'un coup. Si l'annuaire a été modifié entre-temps, rien n'est enregistré et la page se recharge : vérifiez, puis appliquez de nouveau.
5. **Compétitions à venir** : pour chaque fiche modifiée dont des clubs de compétitions à venir diffèrent, « **Appliquer aux compétitions à venir ?** » s'ouvre ensuite, fiche après fiche, comme après « Modifier » dans l'annuaire. Rien ne change dans les compétitions sans votre choix.

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
3. **Tableaux** : vérifier, déplacer ou échanger des combattants sur la planche (voir ci-dessous), « Marquer prête », imprimer.
4. **Combats** : quand les catégories d'une session sont prêtes, « Figer et imprimer la session » fixe les numéros de passage et imprime ses tableaux. Les résultats se saisissent zone par zone, le combat « à l'appel » en tête de chaque zone.
   - **Finale « Prête · peut passer plus tôt »** : quand les deux finalistes d'une finale sont connus alors que des passages la précèdent encore sur sa zone, elle porte cette mention. Son résultat se saisit comme d'habitude, hors ordre ; les numéros imprimés ne bougent jamais, et il n'y a pas de renumérotation automatique.

Pendant la journée, s'il y a internet : Réglages de la compétition → « Échanges avec le serveur » → « Envoyer une copie au serveur » (copie de secours ; le PC garde la main).

### Les heures et les durées (ce que voit le public)

Si la compétition est **publique** (Réglages), les spectateurs voient des heures de passage. Elles sont **estimées** à partir des durées que vous réglez ; rien n'est à saisir pour qu'elles apparaissent, mais plus vous renseignez, plus elles sont justes.

**Où saisir**
- **Durées des combats** : Réglages de la compétition → carte « Durées des combats ». Pour chaque tranche d'âge (moins de 14 ans, 14 à 17 ans, 18 ans et plus, triathlon) : round, repos et prolongation, écrits `m:ss`, secondes sur deux chiffres (par exemple `1:30` ou `1:05`). Une durée mal écrite est signalée en rouge et « Enregistrer » attend qu'elle soit corrigée. Plus « Changement entre deux combats » (60 s par défaut) et « Kata : durée d'un passage » (90 s). Tout s'enregistre avec « Enregistrer » de la page. La prolongation n'entre pas dans les heures : un combat est compté en rounds et repos seulement.
- **Une catégorie différente** : Jour J → Tableaux, bloc « Durées des combats » de la catégorie (par exemple des finales plus longues). Un réglage de catégorie passe avant celui de la compétition, et un réglage de combat passe avant les deux.
- **Heures d'une session** : Jour J → Combats, ligne « Horaires » de la session. « Début prévu » se saisit à tout moment (c'est ce que le public voit avant le lancement : « Session 1 · 9:30 » sur l'accueil, dans « À venir »). Une fois la session lancée apparaissent « Démarrée à », avec le bouton « Maintenant », et « Finales à ». Chaque heure s'enregistre en sortant du champ (« Horaire enregistré ») ; vider le champ l'efface. La Table centrale peut aussi les saisir.

**Comment l'heure est estimée**
- Chaque session se calcule **seule** : le retard de l'une n'est pas reporté sur la suivante tant qu'elle n'a pas démarré (saisissez son « Début prévu »).
- **Début d'une session lancée** : l'heure de « Démarrée à » si vous l'avez saisie ; sinon une estimation tirée du premier résultat saisi (« démarrée vers … ») ; sinon le « Début prévu ». Sans aucune de ces trois informations, le public ne voit aucune heure.
- Les combats se suivent zone par zone, dans l'ordre des sessions puis des numéros. Chaque passage dure la durée du combat, plus le temps de changement après lui. Un résultat saisi dans le désordre ne fait jamais reculer l'heure.
- **Combat en cours** : le premier combat sans résultat d'une zone est considéré comme sur le tatami. Sa fin est estimée, et jamais avant « maintenant » ; s'il dure plus que prévu, les suivants glissent d'autant. « Maintenant » ne pousse que les sessions **démarrées** (« Maintenant » cliqué dans « Démarrée à », ou un premier résultat saisi), et seulement le jour de la compétition : une session pas encore démarrée garde ses heures prévues.
- **Résultat saisi en retard** : un passage sans résultat placé avant des passages déjà joués (par exemple un kata dont les notes arrivent après le combat suivant) n'a pas d'heure, et ne décale rien, jusqu'à ce que son résultat soit saisi.
- **Finales** : sur la zone des finales, la première finale « Fin de session » attend la fin de tous les combats éliminatoires de la session, ou l'heure « Finales à » si elle est saisie (« Finales à » ne peut que la retarder). Sur les autres zones, la première finale « Fin de session » de chaque zone attend aussi « Finales à » quand il est saisi ; sans « Finales à », elle se joue simplement à la fin de la file de sa zone. Le champ « Finales à » reste donc affiché même sans zone des finales. Une fois la première finale jouée, les suivantes s'enchaînent.
- **Finale jouée en avance** (voir « Prête · peut passer plus tôt ») : les passages restants de la zone se **décalent** automatiquement, repartent de la fin de cette finale (plus le changement), et ne sont pas comptés « saisis en retard » ; aucune heure estimée ne tombe dans le passé.
- « Prévoir une pause » dans l'ordre de passage n'entre pas dans le calcul.

**Ce que voit le spectateur**
- Accueil : l'heure prévue de chaque session à venir.
- Onglet **Zones** : en-tête « Session 1 · prévue 9:30 · démarrée 9:41 » (« démarrée vers » si l'heure est estimée), « vers 10:05 » sur chaque passage (jamais une heure déjà passée : ce passage-là est sur le tatami), une pastille « en retard de N min » (« en retard de 1 h 05 » au-delà d'une heure), « en avance de N min » ou « à l’heure » (écart de moins de 3 minutes) par zone, et « Finales de la session … à partir de … » (placé avant la première finale « Fin de session » de la zone des finales ; les autres finales portent la pastille « Finale »).
- Onglet **Suivis** : « Zone · n° · vers 10:05 » et « Durée prévue : 2 × 1 min 30 » pour le prochain combat d'un combattant suivi (sans heure quand c'est le combat en cours sur le tatami).
- Onglet **Tableaux** : la durée des combats et l'heure estimée de la finale de chaque catégorie (rien une fois la finale jouée).
- Une compétition passée (Historique) n'affiche ni heures ni durées. Les heures se recalculent dans le navigateur de chaque spectateur à chaque résultat saisi : elles avancent toutes seules.

### La planche des tableaux (Jour J → Tableaux)

L'onglet **Tableaux** s'ouvre sur la **Planche** : toutes les catégories d'un coup, une carte par catégorie, avec les combattants en pastilles (nom et club). Le sélecteur « Planche / Liste » ramène à l'ancienne page, la **Liste**, qui sert aux réglages d'une catégorie (format, repêchage, « Marquer prête », impression). Un poste est retenu dans son choix.

- **Retrouver une catégorie** : la barre du haut propose la session, une recherche (« Chercher une catégorie ou un combattant », qui surligne les combattants trouvés), « Classer par » **Catégorie** ou **Zone**, et « Seulement à traiter » (cartes sans adversaire ou avec un cas à traiter). Une ligne de raccourcis sous la barre fait défiler jusqu'à un groupe. « Agrandir » sur une carte montre le vrai tableau.
- **Bac « Sans adversaire »** : à gauche, un combattant par catégorie qui n'en a qu'un. Vide, il dit « Tout le monde a un adversaire. ». On le glisse comme une pastille.

**Déplacer ou échanger, à la souris (glisser-déposer)** : prenez une pastille et déposez-la.
- **Sur un autre combattant du même tableau** : les deux échangent leur place, tout de suite.
- **Sur un combattant d'une autre catégorie** : échange. Chacun prend la place exacte de l'autre ; la fenêtre « Échanger deux combattants » demande de confirmer. C'est une seule action dans l'historique.
- **Sur une carte d'une autre catégorie** : déplacement manuel (fenêtre « Déplacement manuel »). Le combattant prend une place libre. Un **tableau libre** vide accepte aussi un dépôt : il garde toujours sa carte.
- **Sur sa propre carte** : rien ne se passe. **Sur une catégorie lancée** : refusé (« Catégorie lancée : déverrouillez-la d’abord »).

Les fenêtres de confirmation montrent « De … ➜ Vers … » pour chaque combattant, les règles enfreintes (orange) et un éventuel changement de session (bleu). Dans les deux tableaux, les autres combattants gardent leur place ; ils ne sont refaits qu'à un « Nouveau tirage ».

**Sur écran tactile (ou sans glisser) : clic-clic.** Cliquez sur une pastille : un bandeau dit « Sélection : X. Cliquez sur un autre combattant pour échanger, ou sur une catégorie pour l’y déplacer. (Échap pour annuler) ». Cliquez ensuite sur la destination ; mêmes effets que ci-dessus. Échap, ou un second clic sur la pastille, annule le choix.

**« Annuler » juste après** : après chaque action, un message en bas de l'écran propose « Annuler » pendant 5 secondes ; cela défait cette action seule.

**Même club au premier tour** : si deux combattants du même club se rencontrent au premier combat d'un tableau à élimination, le nom du club est en orange sur les deux pastilles et dans le tableau, la carte porte « Même club », et la fenêtre ou le message le dit. C'est un avertissement, jamais un blocage : aucun acquittement à donner. Rien en poule ni en kata, et rien à l'impression.

**Poste Zone** : la planche est en lecture seule (pas de glisser, pas de choix).

### L'historique et l'annulation en cascade

Le bouton **Historique (n)** (planche et Liste) ouvre un panneau qui liste, du plus récent au plus ancien, tout ce qui change qui est dans quel tableau : plan appliqué, réaffectations, déplacements manuels, échanges, « Ne combat pas », échanges de places, nouveaux tirages, changements de format et de tableau libre, quelle que soit la page d'où ils viennent. Les filtres sont « Tout », « Plan », « À la main » et « Tableaux ». Ne sont pas inclus : « Marquer prête », déverrouiller, régénérer, pesée, inscriptions, présences et résultats. Dans l'onglet **Réaffectation**, ce panneau remplace « Réaffectations validées ».

- **Voir** fait défiler la planche jusqu'aux cartes concernées et les entoure environ 2 secondes.
- **Annuler…** remet les catégories touchées exactement comme avant. Si des actions **plus récentes** touchent les mêmes catégories, elles sont **annulées aussi, en premier** : c'est la cascade. Une ligne annulée reste, barrée, avec « Annulée à hh:mm » ; il n'y a pas de « Rétablir ».
- **Mise en évidence** : en survolant « Annuler… » (ou au clavier), l'action choisie est marquée « Sera annulée » et celles de la cascade « Sera annulée aussi » ; sur la planche, les cartes concernées sont entourées en orange. Sous le bouton, « Annule aussi : … » liste toujours ces actions, même sans souris.
- **La fenêtre « Annuler cette action ? »** (ou « Annuler tout le plan d’ensemble ? ») donne les actions dans l'ordre où elles seront annulées, ce qui revient pour chacune, et ce qui reste en place. Boutons « Garder » ou « Annuler ces n actions ».
- **Ce qui bloque** : une catégorie lancée ou terminée, ou une session lancée. Le bouton est grisé et la raison écrite ; déverrouillez la catégorie pour annuler. Un échange de places ou un tirage ne s'annule plus si les inscrits du tableau ont changé depuis (pesée, absence) ; refaites le tirage ou échangez à la main.
- **Supprimer un tableau libre** renvoie ses combattants d'où ils viennent, par la même annulation en cascade et la même fenêtre.

**« Repartir de zéro »** (onglet Réaffectation) garde son rôle pour la session choisie : réaffectations, déplacements manuels et échanges entre catégories sont annulés et effacés de l'historique. C'est aussi une cascade : les échanges de places, tirages et changements de format plus récents qui touchent les mêmes catégories partent avec, mis en évidence dans la fenêtre ; ceux qui n'en dépendent pas restent. Impossible si la session est lancée ; un combattant dans une catégorie commencée reste où il est.

### Si le réseau de la salle tombe

- **Une zone avec portable** : sur le portable, ouvrir http://localhost:3000, la compétition, puis « Continuer sans réseau (zone …) ». Seuls les résultats de cette zone se saisissent. Au retour du réseau, « Repasser en ligne » renvoie les saisies au PC principal.
- **Sans réseau du tout** : sur le portable, « Exporter le journal (fichier) » ; sur le PC principal, onglet Combats, « Importer un journal de zone (fichier) ». Une saisie déjà reçue n'est jamais appliquée deux fois ; les saisies en conflit apparaissent dans « À trancher ».
- **Le PC principal tombe en panne** : sur le second PC, restaurez la dernière copie (Réglages de l'application → Copie de secours), puis ouvrez l'adresse de ce PC sur les postes.

## 7. Après la compétition

1. **Podiums** (étape Après) : podiums, classement des clubs, feuilles de résultats, exports .xlsx / .ods.
2. Sur le PC : Réglages de la compétition → « Échanges avec le serveur » → « **Rendre la main au serveur** ». Le serveur reprend la compétition entière, avec ses résultats ; le PC garde une copie en lecture seule.

Sans internet : « Exporter la compétition (fichier) » sur le PC, puis sur le serveur « Importer une compétition (fichier) » et confirmer « Reprendre la main ».

**PC perdu ou en panne** : sur le serveur, « Échanges avec le serveur » → « Reprendre la main » (à partir de la version du serveur, ou de la dernière copie reçue pendant la journée), et révoquez le jeton du PC. Si un autre PC a continué la compétition, exportez-la en fichier depuis ce PC, puis importez-la en ligne.

**Supprimer une compétition** (une démo, une erreur) : liste des compétitions → « Supprimer », puis retapez son nom. Tout ce qu’elle contient est effacé de cette installation seulement, et une sauvegarde est faite juste avant. Pour revenir en arrière : Réglages de l'application → Sauvegardes ; la restauration remet toutes les compétitions dans l’état de ce moment-là. La suppression ne se propage jamais : supprimée sur le serveur, la compétition reste sur les PC qui en ont une copie ; supprimée sur le PC principal, elle reste sur les portables de zone. Ces copies ne sont plus mises à jour (« La compétition a été supprimée… ») et se suppriment de la même façon, sauf un portable en zone autonome (repassez d’abord en ligne). Sur le serveur, une compétition dont un PC a la main ne peut pas être supprimée.

## 8. Sauvegarder et restaurer

Une sauvegarde concerne **toute l'installation**, pas une seule compétition. Elle se gère dans **Réglages de l'application → Sauvegardes**, en organisateur.

**Ce qu'elle contient** : toutes les compétitions, l'annuaire, les comptes, les réglages (dont le message aux clubs), les images du message et les pièces jointes des mails.

**Ce qu'elle ne contient pas** : les sessions de connexion, les jetons de synchronisation, le mot de passe d'envoi des mails et la clé du compte Google.

Le fichier contient des données personnelles et les comptes, avec leurs mots de passe chiffrés : gardez-le en lieu sûr.

### Depuis l'écran

- **Sauvegarder** : « Sauvegarder maintenant » ajoute une copie à la liste. Des copies se font aussi toutes seules quand quelque chose a changé ; la liste montre les 10 plus récentes.
- **Garder une copie ailleurs** : « Télécharger une sauvegarde complète », ou « Télécharger » sur une ligne de la liste.
- **Restaurer** : « Restaurer une sauvegarde… », choisissez le fichier, puis confirmez. Pour revenir à une copie de la liste, téléchargez-la d'abord.

### En ligne de commande

Ces commandes ne passent ni par le navigateur ni par le serveur web, et n'ont donc pas de limite de taille. Lancez-les dans le dossier de `compose.yaml` :

```sh
docker compose exec -it app node dist/server/cli.js backup
docker compose exec -it app node dist/server/cli.js list-backups
docker compose exec -it app node dist/server/cli.js restore shidokan-20261105-120000-000.sqlite
docker compose restart app
```

- `backup` écrit la copie dans `data/sauvegardes/`.
- `restore` prend le nom d'une copie de ce dossier, ou le chemin d'un fichier vu du conteneur : un fichier posé dans `data/` se trouve à `/data/mon-fichier.sqlite`. La confirmation se fait en tapant `oui` ; ajoutez `--oui` à la fin pour un script.
- Après `restore`, redémarrez l'application et rechargez les pages ouvertes.

### Ce que fait une restauration

- **Tout est remplacé** par le contenu du fichier : ce qui a été saisi depuis, y compris par les clubs en ligne, n'est plus dans l'application. Une sauvegarde de l'état actuel est faite juste avant : c'est elle qu'il faut restaurer pour annuler.
- **Comptes** : ceux du fichier remplacent les comptes actuels. Si votre compte n'y est pas, vous êtes déconnecté. Un fichier sans organisateur, comme une sauvegarde d'un PC ou d'une version plus ancienne, laisse les comptes actuels en place.
- **Mot de passe d'envoi et compte Google** : ils restent en place si le fichier désigne le même compte. Sinon, ressaisissez le mot de passe ou reconnectez le compte Google dans **Envoi des mails**.
- **Liens de cette machine** (serveur relié, copie suivie, PC principal, portable de zone) : ils ne changent jamais, et les jetons de synchronisation restent ceux de l'installation.
- **Anciennes sauvegardes** : elles se restaurent toujours, mais sans leurs comptes ni leurs pièces jointes. Une pièce jointe déjà présente sur l'installation est gardée si la sauvegarde la cite encore.
- **Sauvegarde d'une version plus récente** : refusée ; mettez d'abord l'application à jour.

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
