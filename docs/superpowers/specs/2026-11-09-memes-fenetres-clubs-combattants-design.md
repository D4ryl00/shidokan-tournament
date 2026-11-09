# Mêmes fenêtres pour les clubs et les combattants — design

Date : 2026-11-09. Statut : décisions de l'organisateur intégrées, en attente de son accord.

## 1. Pourquoi

Aujourd'hui, un club et un combattant s'ajoutent de façon différente selon l'écran, et pas toujours proprement :

- **Inscriptions** : taper un nom inconnu puis « Ajouter le club « … » » crée le club dans la compétition et, en silence, une
  fiche d'annuaire réduite à son nom (`linkClubResult` crée l'entrée).
- **Import d'une fiche .ods** : le club est retrouvé par son nom exact (casse et accents ignorés, alias FFK) ; sinon il est créé,
  avec les coordonnées du fichier. Une petite différence d'écriture crée un club en double, sans prévenir. Un club existant
  reçoit les coordonnées du fichier (écrasées).
- **Saisir une fiche papier** : le club se tape à la main, avec Coach / Téléphone / E-mails. Des champs laissés vides
  **effacent** les coordonnées du club (`upsertClubSync` écrit les `null`).
- **Inscriptions** a son propre formulaire de combattant (une inscription = une discipline), différent de la fenêtre du coach
  sur sa page en ligne (un combattant = un combat et/ou le kata, avec reclassement).

L'organisateur veut **les mêmes parcours et les mêmes composants partout** : une seule fenêtre « Ajouter un club » (celle de
l'annuaire), une seule fenêtre de combattant (celle du coach), et des coordonnées de club qui se modifient **dans l'annuaire**,
nulle part ailleurs.

## 2. Objectifs

1. Une seule fenêtre « Ajouter un club » : celle de l'annuaire (`EntryModal` de `DirectoryPage.tsx` : Nom*, N° d'affiliation FFK,
   Coach, Téléphone, E-mails, Notes). Elle s'ouvre depuis tous les endroits où l'on choisit le club d'une compétition. Le club
   créé va dans l'annuaire **et** dans la compétition (comme `clubs/from-directory`).
2. Un seul **choix du club** : une liste qui propose les clubs de la compétition, puis les clubs de l'annuaire qui n'y sont pas
   encore, et un bouton « Ajouter un club » qui ouvre la fenêtre du point 1. Plus de nom de club tapé librement qui crée un club.
3. Une seule **fenêtre de combattant** : celle du coach (`ClubLineForm`), pour le coach en ligne et pour l'organisateur dans
   Inscriptions, en ajout comme en modification.
4. Les coordonnées d'un club (coach, téléphone, e-mails) ne sont plus écrites par la saisie d'une fiche papier, ni par l'import
   d'une fiche .ods : elles se modifient dans l'annuaire (le report vers les compétitions existe déjà, étape 36).

## 3. Non-objectifs

- **Import FFK** : inchangé, automatique. Il retrouve les clubs par numéro d'affiliation, sans risque de doublon, et une fenêtre
  par club pour des dizaines de clubs serait lourde (proposé par Claude, l'organisateur n'a pas objecté).
- Fiche papier PDF et modèle .ods : contenu inchangé.

## 4. Anti-objectifs (ce qui serait un échec même si « ça marche »)

- Deux fenêtres qui se ressemblent mais divergent (une copie de `ClubLineForm` pour l'organisateur) : le composant doit être
  **le même**, avec au plus le choix du club en étape préalable.
- Un club créé en double parce qu'un nom de fichier diffère d'une lettre, sans que l'organisateur ait pu choisir le bon.
- Des coordonnées de club effacées ou modifiées par une saisie de fiche.

## 5. Ce qui a été décidé

### 5.1 Choix du club (composant partagé)

- Une liste cherchable : clubs de la compétition d'abord, puis clubs de l'annuaire pas encore dans la compétition (même source
  que `RegistrationForm` aujourd'hui : `useClubs` + `useDirectoryClubs`). Un club de l'annuaire choisi entre dans la compétition
  avec ses coordonnées (`useClubFromDirectory`) au moment où la saisie est enregistrée, ou au moment du choix (au constructeur).
- Un bouton « Ajouter un club » à côté de la liste ouvre la fenêtre de l'annuaire (§2.1), qui devient un composant partagé. Une
  fois enregistré, le club est choisi dans la liste.
- Pas d'option « Ajouter le club « … » » à partir du texte tapé (elle disparaît du formulaire d'Inscriptions).
- Le même composant sert à : Saisir une fiche papier, Inscriptions (étape « club »), l'étape « club » de l'import .ods.

### 5.2 Saisir une fiche papier

- Le champ texte « Club » devient le choix du club (§5.1).
- Les champs Coach, Téléphone et E-mails disparaissent. La saisie n'envoie plus de coordonnées ; le serveur n'en écrit plus
  (`paperEntrySchema` sans coach/téléphone/e-mails, ou ignorés).
- La case « Pré-accord du coach » reste. Quand on choisit le club, elle prend la valeur du club dans la compétition
  (`clubs.pre_approval` : cochée si le coach l'a cochée en ligne ou si une fiche précédente l'a cochée). Elle reste modifiable ;
  sa valeur est enregistrée avec la fiche, comme aujourd'hui. Un club de l'annuaire pas encore dans la compétition arrive
  décoché (supposition de Claude).
- Le reste ne change pas : « Vérifier », « Enregistrer la fiche », saisie page par page sans rien retirer.

### 5.3 Import d'une fiche .ods

- Après le choix du fichier, si le nom du club du fichier ne correspond à **aucun club de la compétition** (même règle de
  correspondance qu'aujourd'hui : nom normalisé, alias FFK), une étape apparaît avant l'aperçu : « Club de la fiche : « X » ».
  On y choisit un club existant (§5.1) ou on ouvre « Ajouter un club », **pré-remplie** avec le nom, le coach, le téléphone et
  les e-mails lus dans le fichier.
- Un club qui correspond est pris directement, sans étape (supposition de Claude : l'étape ne gêne que quand il y a un doute).
- L'import utilise le club choisi (par identifiant), pas le nom du fichier. Le pré-accord du fichier est enregistré (c'est la
  réponse du coach sur sa fiche), comme aujourd'hui.
- Coordonnées du fichier (coach, téléphone, e-mails) pour un club déjà dans la compétition : elles ne sont plus écrites
  directement. Ce qui diffère devient un **changement à examiner** (mécanisme existant des `club_changes`, bouton
  « Comparer »), comme quand le coach modifie ses coordonnées en ligne (décision de l'organisateur).

### 5.4 Inscriptions : la fenêtre du coach

- **Ajouter** : « Ajouter un combattant » ouvre une fenêtre en deux étapes. 1) Choix du club (§5.1), « Suivant ».
  2) La fenêtre du coach, **identique**, pour ce club. Le formulaire d'ajout ouvert en permanence en haut d'Inscriptions
  disparaît.
- **Modifier** : ouvrir une inscription ouvre la fenêtre du coach sur **le combattant entier** (combat(s) et/ou kata,
  reclassement). Décocher le kata retire l'inscription kata, comme pour le coach. Un lien « Changer de club » (hors du
  composant partagé, dans l'enveloppe à deux étapes) ramène à l'étape club : c'est ainsi qu'on change le club d'un combattant
  (choix de Claude).
- La fenêtre modifie **ce qui a été déclaré** (logique du coach) : pour une inscription réaffectée, la catégorie d'origine
  (`originalJson`) ; le placement réel se corrige dans Réaffectation (déplacement manuel, planche). Décision de l'organisateur.
- **Catégories non ouvertes** : l'organisateur les voit, marquées « (non ouverte) », et peut les choisir ; l'enregistrement
  passe avec l'avertissement d'aujourd'hui et le cas part en Réaffectation. Le coach ne les voit toujours pas (sauf une valeur
  déjà enregistrée). Décision de l'organisateur.
- **Sexe et âge d'un combattant confirmé par l'export FFK** : modifiables par l'organisateur **et par le coach**, tant que les
  inscriptions en ligne sont ouvertes pour le coach (ensuite sa page est en lecture seule, comme aujourd'hui). Le refus
  `FFK_IDENTITY` disparaît. Décision de l'organisateur.
- **Sans club** : l'étape club exige un club. Un combattant existant sans club passe d'abord par l'étape club (choix de Claude).
- Une inscription ajoutée depuis Inscriptions est **« sur place »** (`source = 'onsite'`) : on ajoute dans Inscriptions ce qui
  arrive le jour même ; le reste passe par la fiche club ou l'import FFK. La case « Inscription sur place » disparaît.
  Une modification garde la source des inscriptions existantes (FFK, fiche, en ligne…) ; une inscription **nouvelle** créée en
  modifiant (kata ajouté à un combattant FFK…) est « sur place » (choix de Claude).
- « Masquer le nom sur la page publique » entre dans la fenêtre partagée : le coach peut aussi le demander pour un de ses
  combattants. Il s'applique au combattant (toutes ses inscriptions, comme aujourd'hui).
- Saisie en série (choix de Claude, à confirmer) : un bouton « Enregistrer et ajouter un autre » rouvre la fenêtre sur le même
  club, à vide.

### 5.5 Ouvrir une compétition

- Dans « Compétitions », cliquer sur le nom d'une compétition ouvre « Inscriptions » (aujourd'hui « Réglages »). L'adresse
  `/competitions/:id` seule mène aussi à « Inscriptions » (poste Organisation ; les postes Table centrale et Zone gardent leur
  onglet par défaut). Le bouton « Réglages » de la ligne reste.

### 5.6 Plusieurs disciplines de combat

Décision de l'organisateur : quand le réglage « Autoriser plusieurs disciplines de combat le même jour » est activé, un
combattant peut être inscrit dans **plusieurs combats**, partout : fenêtre partagée (coach et organisateur), fiche papier PDF,
modèle .ods, saisie d'une fiche papier, import .ods. Réglage désactivé : un seul combat, comme aujourd'hui.

- La ligne d'un combattant (`ClubFormLine`) passe d'un combat à une liste de combats ; `registrationsToLine` ne marque plus
  un combattant à deux combats en lecture seule (`TWO_COMBATS_REASON` disparaît quand le réglage le permet).
- Un règlement (jiyu / shobu) **par combat** (choix de Claude : karaté shobu et boxing jiyu doivent pouvoir coexister). La
  catégorie de poids est commune (la grille ne dépend pas de la discipline).
- Reclassement : une seule liste de choix pour le combattant, sans ses propres disciplines de combat (choix de Claude) ;
  « Que lui proposer d'abord ? » (shobu) s'applique à chacun de ses combats en shobu.
- Fiche papier PDF et .ods, réglage activé : les cases de combat permettent d'en cocher plusieurs ; une colonne « Règlement »
  par combat ou équivalent (forme laissée au constructeur, lisible par l'import, qui lit toujours les anciennes fiches).
- Réglage désactivé après coup : un combattant déjà inscrit dans deux combats les garde et les voit (comme une valeur déjà
  enregistrée) ; on ne peut que les réduire.

## 6. Laissé au constructeur

- Où vit le composant partagé de la fenêtre de l'annuaire et du choix du club ; le nom des routes organisateur qui enregistrent
  une ligne de combattant (l'API `/api/inscription/:token/lines` est réservée au serveur en ligne et au coach ; l'organisateur
  a besoin de l'équivalent sous `/api/competitions/:id/…`, avec les mêmes contrôles : version, verrou d'une catégorie commencée,
  doublon de nom).
- Les tests (unitaires, e2e) et la mise à jour du guide utilisateur et de l'aide à l'écran.
