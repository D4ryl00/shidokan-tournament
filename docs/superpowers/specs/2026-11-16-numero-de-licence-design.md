# Numéro de licence FFK partout où l'on saisit un combattant

Petit changement, prérequis de la refonte de l'Import FFK (`2026-11-16-import-ffk-refonte-design.md`).

## Pourquoi

Le numéro de licence FFK est le seul moyen sûr de reconnaître un combattant à l'import de l'export FFK (le nom varie :
« MARTINI » / « MARTINNI », prénom et nom inversés…). La base l'a déjà (`fighters.licence`), mais seul l'import FFK le
remplit : il n'est visible ni modifiable nulle part. Si le club le donne dès l'inscription, le premier import FFK
rapproche ses combattants à coup sûr.

## Objectifs

- Un champ **« N° de licence » facultatif** partout où l'on saisit un combattant :
  - la fenêtre « Ajouter / Modifier un combattant » (`ClubLineForm`), pour l'organisateur et sur la page en ligne du
    club (coach) ;
  - la fiche club **ODS** : une colonne « N° de licence (facultatif) », relue à l'import de la fiche renvoyée ;
  - la fiche club **PDF** et le tableau de saisie de la fiche papier dans l'app (`PaperEntryTable`), qui en suit la
    disposition ;
  - l'import de la fiche renvoyée : une licence différente de celle de l'app est un écart à choisir (cases « Fiche
    renvoyée » / « Votre fiche »), comme les autres champs ; une licence vide d'un côté n'est pas un écart (on garde
    celle qui existe).

## Hors du sujet

- Le contrôle du format (texte libre) et toute recherche en ligne de la licence.
- L'affichage dans les listes (Inscriptions, page publique) : jamais en public, comme aujourd'hui.
- La refonte de l'Import FFK elle-même (étape suivante) ; l'import actuel continue d'écrire la licence de l'export.

## À ne pas faire

- Rendre la licence obligatoire, ou bloquer un enregistrement à cause d'elle.
- Casser la lecture des fiches ODS déjà envoyées aux clubs (sans la colonne).
- Effacer une licence existante parce qu'une saisie l'a laissée vide (comme aujourd'hui : absente = conservée).

## Approches

Une seule voie raisonnable : ajouter le champ au modèle de saisie existant (`ClubFormLine`) et le faire circuler là où
ce modèle circule déjà (fenêtre, ODS, PDF, saisie papier, import de la fiche renvoyée). Un champ à part, hors de
`ClubFormLine`, obligerait à doubler chaque chemin d'enregistrement.

## Ce qui a été décidé

- **PDF : une colonne de plus** « N° de licence (facultatif) », juste après Prénom, ≈ 22 mm (option A, choisie le
  2026-11-16). La place est prise sur les autres colonnes (Nom, Prénom, Catégorie d'âge, Si seul, Shobu ≈ 2 mm
  chacune) ; la feuille reste une A4 paysage, mêmes lignes par page.
- **ODS** : la même colonne, au même endroit (après Prénom), dans le modèle téléchargé et joint aux mails.
- Saisie (mon choix) : texte libre, enregistré en majuscules sans espaces ; vide = rien.
- Conservation et confidentialité : inchangées (effacée avec le poids et le grade ; jamais publique).

## Laissé au constructeur

- `ClubFormLine.licence: string | null` et son passage dans `saveClubLine`, la lecture d'une ligne (`lineOf`) et
  l'enregistrement de l'organisateur ; absente = conservée.
- Lecture ODS : repérer la colonne par son titre plutôt que par sa position (les fiches sans la colonne, et l'ancien
  format, restent lisibles) ; la détection actuelle par position (`Poids actuel` en 5e colonne) est à adapter.
- Comparaison à l'import de la fiche renvoyée : ajouter la licence aux écarts (`ImportField`).
- Largeurs exactes des colonnes PDF (`COLUMNS` de `club-form-pdf.ts`), vérifiées sur un rendu.
- Aides (`help.ts`) qui listent les colonnes de la fiche.
- Tests : lecture ODS avec et sans la colonne, fenêtre (coach et organisateur), écart à l'import de la fiche, rendu du
  PDF ; vérification sur Chrome (fenêtre, page du club, fiche PDF ouverte) et à largeur de téléphone.
