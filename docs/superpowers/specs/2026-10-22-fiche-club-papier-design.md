# Fiche club : version papier à cocher et présentation Shidokan France — conception

**Date :** 2026-10-22 · **Complète :** `docs/superpowers/specs/2026-10-21-tableaux-shidokan-design.md` §7 (fiche de pré-inscription club).
**Échéance :** la fiche part aux clubs vers le **29 octobre 2026**.
**Maquette validée :** `.superpowers/brainstorm/35458-1792661973/content/fiche-a-v7.html` (non versionnée ; la description ci-dessous fait foi).

Légende : ✅ décidé par l'organisateur · 💡 choix du rédacteur (à vérifier en relisant) · 🔧 laissé au constructeur.

---

## 1. Pourquoi

Certains coachs remplissent la fiche **à la main** : ils l'impriment, la remplissent au stylo, puis la scannent ou la photographient. La fiche actuelle (.ods) ne s'y prête pas : 38 cm de large pour une page A4 de 28 cm utiles, aucune case tracée, aucune mise en page d'impression, des listes déroulantes inutiles sur papier. Elle n'a pas non plus l'allure d'un document Shidokan France.

**Réussi si :** un coach remplit une ligne en quelques secondes en cochant des cases ; la feuille imprimée est lisible, belle, au logo Shidokan France, et ressemble à l'ancien formulaire d'engagement que les clubs connaissent ; l'organisateur ressaisit une fiche scannée sans ambiguïté.

**Échec même si « ça marche » :** une feuille qui déborde sur deux pages ou se coupe à l'impression ; des cases trop petites pour un stylo ; une question que le coach comprend de travers (la priorité en shobu, par exemple) ; une fiche qui demande une information que l'app ne sait pas exploiter.

## 2. La fiche papier ✅

### 2.1 Allure
Dans l'esprit de l'ancien formulaire d'engagement (« allure A ») :
- **A4 paysage**, marges de 1 cm, la feuille occupe toute la page ;
- **logo Shidokan France aux deux coins** du haut (`assets/brand/shidokan-france-logo.webp`) ;
- **titre encadré** d'un trait épais : « FICHE DE PRÉ-INSCRIPTION », et en dessous le nom et la date de la compétition (et le lieu s'il est renseigné) ;
- quadrillage noir, en-têtes de colonnes en gras sur fond gris clair ; toujours en noir et blanc imprimable (pas de couleur indispensable).

### 2.2 En-tête du club
Cases encadrées à remplir : **Club**, **Coach**, **Téléphone**, **E-mail**, et « **Le coach accepte d'avance les reclassements de ses combattants :** ☐ Oui ☐ Non ».

### 2.3 Tableau : 10 combattants par feuille, une ligne par combattant
| Colonne | Contenu |
|---|---|
| Nom | à écrire |
| Prénom | à écrire |
| Sexe | ☐ F ☐ M |
| Catégorie d'âge (une seule case) | une case par tranche **proposée** (1.4), en abrégé : P, Pu, B, Mi, C, J, S, V1…V5 ; deux rangées |
| Poids actuel (kg) | à écrire — **remplace la catégorie de poids**, que l'organisateur déduit du poids |
| Disciplines (kata et/ou une discipline de combat) | ☐ Karaté ☐ Boxing ☐ Mix ☐ Triathlon ☐ Kata — un combattant en kata **et** en combat coche deux cases sur la **même ligne** |
| Grade (si kata) | à écrire |
| Règlement (combat) | ☐ Jiyu ☐ Shobu |
| Si reclassement : autres disciplines, numéroter 1, 2 | trois petites cases à numéroter : Karaté, Box., Mix |
| Shobu : si reclassement, garder en priorité (une seule case) | ☐ 1. les règles shobu ☐ 2. la discipline |

- Lignes d'environ 11 mm de haut ; texte des cases autour de 9-10 pt imprimé ; cases à cocher d'environ 3 mm.
- **Bas de page** : légende des abréviations d'âge avec les âges (« P poussins (6-7 ans) · … ») ; explication de la priorité shobu : « les règles shobu » = changer de discipline plutôt que passer en jiyu ; « la discipline » = passer en jiyu plutôt que changer de discipline ; « Boxing = shido-boxing, Mix = shido-mix martial ».
- 💡 Pas de verso : tout tient au recto. 💡 Une mention « Page … / … » à remplir par le coach, pour les clubs de plus de 10 combattants (il imprime plusieurs feuilles).

### 2.4 Où la trouver 💡
- Dans l'onglet **Fiche club**, section « 1. Envoyer le modèle aux clubs » : un bouton **« Fiche papier (PDF) »** à côté du modèle .ods.
- Il ouvre une page d'impression comme les autres (`/competitions/:id/impression/fiche-club`), une feuille vierge, avec « Imprimer » (ou « Enregistrer au format PDF ») ; l'organisateur envoie ce PDF aux clubs qui le veulent.
- 🔧 Le constructeur peut aussi générer le PDF côté serveur s'il le juge plus simple ; le rendu doit rester celui décrit ici.

### 2.5 Ce que la fiche papier change dans l'app
- **Tranches d'âge proposées** 💡 : la fiche n'affiche que les tranches **proposées aux clubs**. Nouvelle case par tranche dans l'éditeur de grille : « Proposée sur la fiche club » (cochée par défaut ; pour la Coupe 2026, décochée pour les mini-poussins et les espoirs ✅). Une tranche non proposée reste dans la grille (passages d'âge, import FFK).
- **Grade** ✅ : nouveau champ texte facultatif du combattant, **seulement pour informer les arbitres** (aucun effet sur les catégories). Saisi dans le formulaire d'inscription ; affiché sur l'écran de notation du kata et sur le tableau de kata imprimé.
- **Priorité shobu** : « 2. la discipline » = la valeur actuelle « accepte le jiyu en priorité » à Oui ; « 1. les règles shobu » = Non. Le libellé du formulaire d'inscription reprend la même formulation 💡.
- **Poids actuel au lieu de la catégorie de poids** : à la ressaisie, l'organisateur entre le poids ; la catégorie de poids est déduite du poids, de l'âge et du sexe (`weightClassForWeight`, domaine existant) et reste modifiable.

## 3. La fiche électronique (.ods) ✅
- **Même présentation** que la fiche papier : logo Shidokan France, titre encadré, bordures, en-têtes en gras, mise en page d'impression A4 paysage (une page en largeur, en-tête du tableau répété).
- **Même contenu** que la fiche papier : une ligne par combattant ; colonnes dans le même ordre ; listes déroulantes à la place des cases (sexe, catégorie d'âge parmi les tranches proposées, règlement, priorité shobu, pré-accord) ; disciplines : kata et/ou une discipline de combat sur la même ligne 🔧 (par exemple une colonne « Discipline de combat » en liste et une colonne « Kata » Oui/Non) ; autres disciplines numérotées 1, 2 ; grade ; poids actuel.
- **Import** :
  - une ligne qui coche le kata et une discipline de combat donne **deux inscriptions** du même combattant ;
  - la catégorie de poids est **déduite du poids actuel**, de l'âge et du sexe (`weightClassForWeight`, avec la tolérance de pesée des réglages) ; 💡 sans poids actuel, une inscription de combat est **en erreur** dans l'aperçu (l'app exige une catégorie de poids pour placer un combattant) — le kata n'en a pas besoin ;
  - le grade est enregistré sur le combattant ;
  - 💡 les fiches déjà renvoyées au **format actuel** restent importables (l'import reconnaît l'ancien et le nouveau format à leurs en-têtes).

## 4. Saisie d'une fiche papier ✅
- Nouvel écran dans l'onglet **Fiche club** 💡 (« 3. Saisir une fiche papier ») qui suit la fiche ligne par ligne : en-tête du club (club, coach, téléphone, e-mail, pré-accord), puis un tableau dans le même ordre que la fiche, avec des cases à cocher et des champs courts ; une ligne = un combattant.
- Le club est saisi une fois pour toute la fiche ; on ajoute des lignes au fil de la saisie.
- À l'enregistrement, même traitement qu'un import de fiche club : aperçu (erreurs, remarques), puis enregistrement ; kata et combat sur une ligne → deux inscriptions ; catégorie de poids déduite du poids.
- Une fiche papier de plusieurs pages se saisit **page par page** : chaque saisie **s'ajoute** aux inscriptions déjà enregistrées pour ce club, une ligne déjà saisie (même combattant, même discipline) est mise à jour ; rien n'est retiré (un retrait se fait dans l'onglet Inscriptions). *(Corrigé après relecture : « remplacer la fiche précédente » effaçait la page 1 en saisissant la page 2.)*

## 5. Hors périmètre
- Lecture automatique des fiches scannées (reconnaissance d'écriture).
- Date de naissance, numéro de licence (non demandés ; l'export FFK les apporte).
- Couleur indispensable à l'impression.

## 6. Laissé au constructeur 🔧
- Technique de rendu (page HTML imprimée par Chrome comme les autres impressions, ou PDF serveur), tant que la feuille tient exactement sur une page A4 paysage, sans débordement, avec 10 lignes.
- Insertion du logo dans le .ods (image dans le fichier) et réglages d'impression du .ods.
- Migration de base pour le grade et la case « proposée sur la fiche club ».
- Abréviations des tranches d'âge (P, Pu, B, Mi, C, J, S, V1…V5) : table fixe pour les codes de la grille FFK, et pour une tranche ajoutée à la main, ses premières lettres 💡 ; la légende du bas de page les reprend avec les âges de la grille.
