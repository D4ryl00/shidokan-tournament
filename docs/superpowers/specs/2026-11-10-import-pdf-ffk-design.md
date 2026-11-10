# Import du PDF « État des inscriptions » FFK — design

Date : 2026-11-10 (révisé le 2026-11-11 après maquettes). Statut : décisions de l'organisateur intégrées, en attente de son
accord. Maquette retenue : `.superpowers/brainstorm/5727-1794351050/content/import-coach-v2.html` (non versionnée).

## 1. Pourquoi

Les clubs inscrivent d'abord leurs combattants sur le site de la FFK. Ce site produit un PDF « ÉTAT DES INSCRIPTIONS », un par
discipline. Aujourd'hui, le coach doit ensuite **tout retaper** sur sa page d'inscription (`/inscription/:token`), et
l'organisateur fait de même quand un coach lui envoie le PDF.

L'organisateur veut que ce PDF **pré-remplisse** les fiches des combattants ; le coach (ou l'organisateur) complète ce que le PDF
ne donne pas. L'import doit marcher :

- sur une liste vide **comme** sur une liste déjà saisie à la main ;
- **plusieurs fois** : la liste FFK évolue jusqu'à la date limite, le coach peut réimporter un PDF plus récent.

D'où une gestion des conflits quand la FFK et la fiche existante divergent.

## 2. Objectifs

1. Page du coach : un bouton « Importer le PDF de la FFK » (à côté de « Ajouter un combattant ») ouvre le parcours d'import.
2. Onglet **Fiche club** de l'organisateur : le même parcours, dans sa propre section, en plus de « Saisir une fiche papier ».
3. Les PDF « En cours » (non finalisé) et « Inscrits » (finalisé) se lisent **exactement de la même façon**.
4. Le parcours montre **combattant par combattant** la fenêtre habituelle « Ajouter un combattant » (`ClubLineForm`),
   **pré-remplie** par l'import, avec une barre de progression (« Fiche 3 sur 5 »).
5. Pour un combattant qui a déjà une fiche, cette même fenêtre sert à **choisir, champ par champ, quoi garder** (FFK ou fiche).
6. Il est clair qu'**il n'y a qu'une fiche par combattant**, même inscrit dans plusieurs disciplines (combat(s) et kata).
7. Les combattants absents du PDF sont **signalés sans gêner** (chaque PDF ne couvre qu'une discipline).

## 3. Non-objectifs

- **Pas de numéro de licence** (décision) : ni lu pour rapprocher, ni enregistré.
- **Pas de lecture du club dans le PDF** (décision) : côté coach, c'est le club du lien ; côté organisateur, il le choisit. Un PDF
  ne contient qu'un club (chaque coach n'exporte que le sien, décision) ; aucun contrôle des entités du PDF.
- **Pas de lecture de la discipline dans le PDF** (décision) : elle est choisie pour tout l'import, et peut être changée sur la
  fiche d'un combattant (puces « Disciplines » de la fenêtre).
- Pas de changement de l'import Excel FFK de l'organisateur (`FfkImportPage`).
- Pas de grade, poids exact, reclassement, « Masquer le nom » venant du PDF : le coach les complète dans la fenêtre.

## 4. Anti-objectifs

- Un combattant ou une discipline retirés sans que personne ne l'ait demandé.
- Un import qui bloque ou qui alarme parce que des combattants d'une autre discipline sont absents du PDF.
- Une deuxième fiche créée pour un combattant qui en a déjà une.
- Des noms réels (le PDF contient des mineurs) dans le dépôt : les tests utilisent un PDF **fabriqué** avec des noms inventés,
  jamais les fichiers fournis par l'organisateur.

## 5. Ce que contient le PDF

Quatre exemples fournis : karaté « Coupe Shidokan Karate - Combats » (versions « En cours » et « Inscrits »), « Coupe Shidokan
Boxe - Combats », « Coupe Shidokan Kata - Katas ». Même mise en page pour tous.

Page 1 : « ÉTAT DES INSCRIPTIONS », nom FFK de la compétition et date, totaux, résumé par entité. Pages suivantes : l'entité
(`0060057 NOM DU CLUB`), puis chaque catégorie FFK :

```
Poussin Masculin -25 KG                      ← titre de catégorie
  En cours | Inscrits                         ← état, ignoré
  N° Licencié  Nom Prénom   Ligue régionale (sur 3 lignes)   Rattachement
  117…D        DUPONT LÉO   LIGUE …                          NOM DU CLUB
Poussin Masculin -30 KG
  Aucune inscription
Séniors jiyu ippon kumite Masculin -75 KG
Séniors shobu ippon kumité Masculin -75 KG
Vétéran 1 Feminine +68 KG
Pupille Masculin                              ← kata : pas de poids
Seniors Débutants Shindo Masculin             ← kata : catégorie propre à la FFK
```

Utile : **« Nom Prénom »** (un seul champ, majuscules) et le **titre de catégorie** : tranche d'âge (Poussin, Pupille,
Benjamin, Minime, Cadet, Junior, Séniors/Seniors, Vétéran 1, Vétéran 2), sexe (Masculin / Feminine), poids (`-25 KG`, `+45 KG`,
absent en kata), règlement pour les Séniors (« jiyu ippon kumite » / « shobu ippon kumité » — présent aussi dans le PDF boxe).
Le reste (licence, ligue, rattachement, totaux, en-têtes de tableau, pieds de page « 10/11/2026 - Page N ») est ignoré.

Pièges vus dans les exemples :
- l'extraction du texte peut coller des mots (« Vétéran2 Masculin-75 KG », « - Page4 ») : la lecture du titre doit tolérer les
  espaces manquants ou en trop ;
- « Séniors » avec ou sans accent ; « kumite » / « kumité » ;
- un combattant peut tomber au début de la page suivante, sous un en-tête de tableau resté en bas de la précédente ;
- un même combattant peut avoir des tranches d'âge différentes selon les PDF (ex. réel : Séniors en karaté, Vétéran 1 en kata).
  Chez nous la tranche d'âge est unique par fiche : le second import le montrera en conflit (§7.4).

## 6. Le parcours

### 6.1 Départ

Une fenêtre « Importer le PDF de la FFK » :

1. **Discipline de ce PDF** (obligatoire, sans valeur par défaut — *mon choix*) : karaté, shido-boxing, shido-mix, triathlon,
   kata, parmi celles que la page du coach propose déjà.
2. **Fichier** (`.pdf`). Le serveur le lit et renvoie les lignes FFK (§8). PDF illisible ou sans combattant : message clair.
3. **Compte** : « N nouveaux · N fiches existantes à revoir · N déjà à jour », puis « Commencer (N fiches) ». Les « déjà à jour »
   sont sautés. S'il n'y a rien à revoir, on passe directement à la fin (§6.4).
4. Côté **organisateur**, une étape **Club** vient d'abord : le `ClubPicker` existant (clubs de la compétition, annuaire,
   « Ajouter un club »), comme la fiche papier. Un club de l'annuaire pas encore dans la compétition y est ajouté au moment où la
   première fiche est enregistrée (ou dès le choix — au choix du builder, tant qu'un abandon immédiat ne laisse pas de club vide
   gênant ; le parcours actuel de la fiche papier sert de référence).

Côté coach, le bouton n'existe que si la page est modifiable (`view.editable`). L'organisateur n'a pas de date limite.

### 6.2 Une fiche à la fois

Pour chaque combattant à revoir, dans l'ordre du PDF : la fenêtre `ClubLineForm` (mode `coach` ou `organiser` selon l'écran),
avec en plus :

- une **barre de progression** « Fiche k sur N » ;
- en pied : « ← Précédent », « Enregistrer · suivant → », et un bouton discret à gauche : « Ne pas l'ajouter » (nouveau) ou
  « Laisser la fiche telle quelle » (existante). La croix ferme le parcours (ce qui est enregistré le reste).
- **Enregistrement fiche par fiche** (décision) : « Enregistrer · suivant » enregistre la fiche par les routes habituelles
  (création / modification de ligne, avec la version de la ligne). Ce n'est **pas** tout-ou-rien : on peut arrêter à tout moment.
  Réimporter le même PDF reprend naturellement là où on s'était arrêté, puisque les fiches enregistrées sont alors « à jour ».
- « Précédent » rouvre la fiche précédente telle qu'elle est maintenant (déjà enregistrée : c'est une modification ordinaire).
- Une fiche modifiée ailleurs entre-temps (409 sur la version) : message habituel, la fiche est relue et réaffichée avec la
  comparaison recalculée.
- Entrée (raccourci « Enregistrer et ajouter un autre » de la saisie en série) vaut ici « Enregistrer · suivant ».
- Les règles habituelles de la fenêtre restent valables (champs obligatoires, une seule discipline de combat si le réglage
  l'impose côté coach, avis côté organisateur, catégories fermées, avertissement de poids…).

### 6.3 Nouveau combattant

Titre « Nouveau combattant ». Le formulaire est rempli avec : nom, prénom, sexe, tranche d'âge, catégorie de poids (combat),
discipline (puce de la discipline de l'import, ou case Kata), règlement (Séniors). Chaque champ rempli par l'import porte une
petite marque « FFK ». Le reste est vide comme pour un ajout à la main (poids actuel, kata, grade, masquer le nom, reclassement).

- Nom / prénom : coupés **avant le dernier mot** (`splitFullName`), avec sous les champs une phrase « La FFK écrit
  « DA SILVA SANTOS INES » : corrigez la coupure nom / prénom si besoin. » Casse : comme une saisie à la main (reprendre la
  normalisation existante).
- Une valeur FFK qui ne se traduit pas dans la grille (tranche ou poids inconnu, « Seniors Débutants Shindo »…) laisse le champ
  vide, avec sous le champ « La FFK indique « … » : choisissez la catégorie. » Le champ obligatoire empêche d'enregistrer tant
  qu'il est vide, comme d'habitude. Hors Séniors, le règlement suit la règle habituelle de la fenêtre.
- « Ne pas l'ajouter » : rien n'est créé.

### 6.4 Fiche existante

Un combattant du PDF correspond à une fiche existante du club si **nom + prénom (normalisés, coupure indifférente : on compare
la suite complète des mots) et sexe** sont égaux. Homonymes (plusieurs fiches possibles) : la fenêtre demande d'abord laquelle
(ou « c'est un autre combattant » → nouveau) — *mon choix*, cas rare.

Titre = le nom du combattant. En tête, un encadré : « **Fiche déjà créée.** Une seule fiche par combattant : <Prénom> est
inscrit(e) en <disciplines actuelles>. Ce que vous choisissez ici vaut pour toutes ses disciplines. »

Le formulaire est rempli avec **la fiche**, sauf pour les champs où la FFK diffère :

- sous chaque champ différent (tranche d'âge, catégorie de poids, règlement), deux cases côte à côte : « **FFK** <valeur> » et
  « **Votre fiche** <valeur> ». **FFK choisie par défaut** (*mon choix*) ; cliquer une case met sa valeur dans le champ ; le champ
  reste modifiable à la main.
- un champ égal affiche discrètement « identique à la FFK » ou rien (au builder).
- si la fiche n'est pas inscrite dans la discipline de l'import, la puce (ou la case Kata) est **cochée** et marquée « FFK » :
  la discipline est ajoutée. Si la compétition n'autorise qu'une discipline de combat et que le coach en a déjà une autre, la
  puce n'est pas cochée ; une phrase l'explique (« Déjà inscrit en Shido-mix : une seule discipline de combat à cette
  compétition. Cochez Karaté pour changer. ») — *mon choix*.
- les autres disciplines de la fiche restent cochées et sont dites « gardées (pas dans ce PDF) ».
- rien de ce que le PDF n'a pas (poids actuel, grade, reclassement, masquer le nom) n'est effacé.
- « Laisser la fiche telle quelle » : rien n'est écrit.

Tranche d'âge, catégorie de poids et règlement valent pour **toutes** les disciplines de la fiche (`ClubFormLine`) : l'encadré
de tête le dit, et c'est la raison du conflit Séniors / Vétéran 1 vu en §5.

**Fiche verrouillée** (combattant commencé) : la fenêtre s'ouvre comme aujourd'hui pour une ligne verrouillée (lecture seule pour
le coach ; pour l'organisateur, ce qu'il peut encore changer) ; la comparaison FFK est affichée pour information.

### 6.5 Fin

- Récapitulatif : « N ajoutés · N mis à jour · N laissés tels quels ».
- **Absents du PDF** : « Inscrits en <discipline> chez nous, absents du PDF ». Phrase neutre : « Normal s'ils ne sont pas inscrits
  à la FFK en <discipline>. Cochez seulement ceux qui ne viendront pas en <discipline>. » Une case **décochée** par combattant,
  avec ses autres disciplines. Cocher retire **seulement la discipline de l'import** de sa fiche ; une fiche qui n'a plus aucune
  discipline est supprimée (comme dans la fenêtre). Les absents sont calculés pour la discipline de l'import seulement.
- Une fiche ajoutée à la discipline par l'import, puis décochée à la main sur sa fiche, n'est pas « absente ».
- « Terminer » applique les retraits cochés (avec les versions) puis ferme ; la liste se rafraîchit, notification de résumé.

## 7. Règles de comparaison (logique pure)

Pour la discipline D de l'import et chaque ligne FFK :

| Cas | Montré ? |
|---|---|
| aucune fiche correspondante | oui, « Nouveau combattant » |
| fiche correspondante, pas inscrite en D | oui, fiche existante (D ajoutée) |
| fiche inscrite en D, tranche / poids (si D a un poids) / règlement (si donné) différents | oui, fiche existante avec conflit |
| fiche inscrite en D, tout égal | non, « déjà à jour » |
| fiche verrouillée | oui, pour information (§6.4) — ou comptée à part, au builder |

Deux lignes du PDF pour la même personne (nom + sexe) dans la même discipline : la seconde est ignorée et signalée au départ.

## 8. Technique (contraintes ; le reste au builder)

- Lecture du PDF **côté serveur**, avec une bibliothèque d'extraction de texte avec positions (ex. `pdfjs-dist` en build Node,
  ou `unpdf`) — nouvelle dépendance, version épinglée. `pdf-lib` (déjà là) ne lit pas le texte. Le découpage s'appuie sur les
  positions (colonnes « Nom Prénom » / « Ligue régionale »). La route renvoie les lignes FFK lues (nom brut, coupure proposée,
  sexe, tranche d'âge, poids, règlement, valeurs FFK brutes non traduites) ; elle n'écrit rien.
- Routes de lecture : côté coach sous `/api/inscription/:token/…` (mêmes contrôles que les autres routes du coach, taille de
  fichier bornée) ; côté organisateur sous `/api/competitions/:id/…` (permissions habituelles).
- La comparaison et la traduction dans la grille sont une **logique pure** dans `src/domain/`, testée sans PDF ; elle peut
  tourner dans le navigateur à partir des lignes FFK et des fiches du club (la page du coach les a déjà ; côté organisateur, les
  lignes du club choisi).
- Les écritures passent par les routes existantes des lignes (coach / organisateur), avec leurs versions : aucune nouvelle route
  d'écriture n'est nécessaire.
- `ClubLineForm` reçoit ce qu'il faut pour le pré-remplissage, les marques « FFK », les choix FFK / fiche par champ, l'encadré et
  le pied du parcours (il a déjà `title`, `footerExtra`, `onEnter`).
- La page du coach n'existe que sur le serveur en ligne (`clubServices`) ; la section de l'organisateur existe partout où la Fiche
  club existe.
- Tests : unitaires sur la lecture (PDF fabriqué avec `pdf-lib` dans le test, mise en page imitant l'exemple, y compris un
  combattant à cheval sur deux pages et des espaces collés) et sur la comparaison ; e2e coach (liste vide, puis réimport avec un
  conflit et un absent ; arrêt au milieu puis reprise) et organisateur (club choisi). e2e du coach sur le port 3101
  (`SERVER_SESSION`), attention à la limite de connexions.
- Vérification sur Chrome (Claude in Chrome) et sur l'iPhone simulé pour la page du coach (fenêtre plein écran sur téléphone).

## 9. Mes choix (à vérifier en lisant)

- Discipline obligatoire, sans valeur par défaut.
- Conflit : « FFK » choisie par défaut, champ toujours modifiable.
- Homonymes : la fenêtre demande quelle fiche, ou « autre combattant ».
- Catégorie FFK non traduisible : champ laissé vide avec la valeur FFK affichée ; l'enregistrement exige de la choisir.
- Une seule discipline de combat autorisée et déjà une autre : la puce de l'import n'est pas cochée d'office.
- Absents : seulement pour la discipline de l'import ; seule cette discipline est retirée si l'on coche.
- Ordre des fiches : celui du PDF.
