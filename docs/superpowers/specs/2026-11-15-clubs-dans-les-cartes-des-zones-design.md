# Clubs dans les cartes des zones — design (court)

Approuvé par l'organisateur le 2026-11-15.

## Pourquoi

Jour J → Combats : la table d'appel appelle un combattant à se présenter et le suivant à se préparer. Elle a besoin du
club de chacun (« X, de Shidokan Paris ») pour l'appel et pour le retrouver dans la salle. Aujourd'hui les cartes des
zones ne montrent que les noms, et un bloc de kata seulement « N katakas ».

## Objectifs

1. **Combat à l'appel** : le club en petit sous chaque nom.
2. **Lignes « Ensuite » d'un combat** (les 5 suivantes, et les finales « peut passer plus tôt ») :
   « NOM Prénom · Club contre NOM Prénom · Club ».
3. **Bloc de kata à l'appel** : « kataka 3 sur 8 », puis « Se présente : NOM Prénom · Club » et « Se prépare : NOM Prénom
   · Club » (pas de ligne « Se prépare » pour le dernier). Se présente : le premier kataka présent, dans l'ordre de passage,
   qui n'a pas encore de notes dans ce tour ; les absents sont sautés. La carte avance dès que ses notes sont enregistrées.
   Tour 1 : ordre du tirage (`bracket.order`) ; finale : ordre du tableau de notation de la finale (`finalists` de
   `resolveKata`). Un bloc « kata entier » (tour 1 puis finale sur la même zone) suit le tour 1, puis la finale.
4. **Bloc de kata dans « Ensuite »** (choix B de l'organisateur) : la liste numérotée de tous les katakas présents du bloc,
   avec leur club, dans l'ordre de passage. Une finale de kata dont les finalistes ne sont pas encore connus garde
   « N katakas » sans liste.
5. Club absent : « Sans club » (comme partout).
6. Aide `combats.zone` mise à jour.

## Non-objectifs

- L'écran public (onglet Zones des spectateurs) : inchangé.
- L'ordre des passages, la limite de 5 lignes « Ensuite », les boutons.

## Approches considérées

- **Serveur enrichit la file (retenu)** : `schedule()` (`src/server/repositories/results.ts`) a déjà les noms, les clubs
  (`labels`), l'ordre des katas, les notes et les absents ; il ajoute `aClub`/`bClub` et, pour un kata, la liste des
  katakas (nom, club, noté ou non) du bloc. L'écran affiche.
- Écran qui recoupe la file avec les inscriptions et les résultats : écarté, il faudrait charger les résultats de chaque
  catégorie de kata dans l'écran et refaire la logique de l'ordre.

## Contraintes

- Ne rien casser des tests e2e existants (`3 katakas`, `next-kata`, `next-match`).
- Lisible sur téléphone (vérifié sur le simulateur iOS) et sur Chrome.

## Laissé au constructeur

- Mise en page exacte (tailles, couleurs `dimmed`), forme des champs ajoutés à `QueueItem`.
