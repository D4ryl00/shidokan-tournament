# Fiche d'un combattant dans Tableaux (planche, liste, galaxie) — conception courte

Date : 2026-11-18. ✅ = décidé par l'utilisateur, 💡 = choix du concepteur.

## Pourquoi

Dans Réaffectation, un clic sur un nom des « Détails » déplie la fiche du combattant (`FighterSheet`). L'utilisateur veut la
même chose dans Jour J → Tableaux : voir les détails d'un combattant en un clic, sans quitter la page, dans les trois vues
(planche, liste, galaxie). ✅

## Contrainte

Dans les trois vues, le clic sur un nom sert déjà : planche et galaxie, choisir la pastille pour le clic-clic (seul moyen de
déplacer au doigt) ; liste, choisir l'inscrit pour l'échange de places et ouvrir « Déplacer ». Ces gestes ne doivent pas changer.

## Approches

1. **Icône ⓘ à côté de chaque nom, fiche dans une bulle.** Le clic sur le nom garde son rôle. ✅ Retenue.
2. Fiche montrée au premier clic du clic-clic : écartée, cliquer un deuxième nom pour le voir lancerait un échange.
3. Clic = fiche, déplacement au glisser seulement : écartée, plus de déplacement sur téléphone ni d'échange en deux clics dans
   la liste.

## Conception

- Un composant `FighterInfoButton` (bouton ⓘ discret, `aria-label` « Fiche de NOM Prénom ») ouvre une bulle Mantine
  (`Popover`) ancrée au nom : en tête « **NOM Prénom** · Club », puis `FighterSheet` tel quel (mêmes lignes qu'en Réaffectation).
  Une bulle à la fois ; elle se ferme par un clic ailleurs, Échap, ou un nouveau clic sur ⓘ. 💡
- Le clic, l'appui sur Entrée ou Espace et le glisser sur ⓘ ne remontent pas à la pastille ni à la case : ni choix clic-clic,
  ni échange, ni déplacement, ni glisser. 💡
- Où : `FighterChip` (cartes de la planche, bac « Sans adversaire », cartes compactes de la galaxie) et les cases du tableau
  de `BracketView` (vue Liste, carte agrandie de la planche). ✅ (les trois vues)
- `BracketView` ne montre ⓘ que sur demande (nouvelle prop, ex. `fighterInfo: competitionId`) : rien ne change pour
  l'impression, la vue publique, la saisie des combats (Matches) ni les Détails de Réaffectation (où le clic montre déjà la fiche). 💡
- Aussi sur un poste de Zone (lecture seule) : la fiche se lit sans rien modifier. Le clic sur le nom n'y ouvre pas la fiche :
  un seul geste partout, l'icône. 💡
- Cible tactile assez grande pour le doigt (≈ 24 px), sans élargir les pastilles ; bulle qui tient dans un écran de téléphone
  (largeur bornée, retour à la ligne). 💡
- Thème clair et sombre : variables `--sk-*` seulement.

## Non-objectifs

- Modifier le combattant depuis la fiche (lecture seule).
- Coordonnées du club dans la fiche (comme en Réaffectation).

## Laissé au constructeur

Nom exact des composants et des `data-testid`, placement précis de l'icône dans la pastille et la case, tests (unitaires si
utiles, e2e Playwright : ⓘ ouvre la fiche dans les trois vues, le clic sur le nom choisit toujours la pastille ou l'inscrit),
vérification sur Chrome et dans le simulateur iOS.
