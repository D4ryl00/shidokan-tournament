# Carte de réaffectation lisible, session finale dans le récapitulatif club

Design court, approuvé dans la conversation du 2026-11-20.

## 1. Carte de réaffectation : mettre en valeur le motif

**Pourquoi.** Sur une carte (section ② de Réaffectation), la ligne de rappel du combattant (« Seniors F · Shido-boxing Jiyu · -68 kg · ≈ 62 kg (non pesée) · accepte : … ») est en texte normal. Le motif de la carte (« Écart de poids de 6,0 kg dans la catégorie (max 5 kg) · catégorie actuelle : … ») est grisé. C'est l'inverse de ce qui compte.

**Décidé.** On inverse la hiérarchie :
- le motif (`c.detail`) juste sous le nom, en couleur d'attention (`var(--sk-warn-text)`) et semi-gras ; en neutre pour une carte « Retour possible » (badge neutre) ;
- « Catégorie actuelle : … » sur sa propre ligne, en texte normal ;
- le rappel du combattant (`FighterDetail`) en dernier, grisé.

**Laissé au constructeur.** Les `data-testid` existants (`case-fighter`…) sont gardés, et on ajoute `case-detail` sur le motif. Le reste de la carte (badge, boutons, propositions) ne change pas.

## 2. Récapitulatif club : la session finale quand elle change

**Pourquoi.** Une catégorie qui regroupe plusieurs tranches d'âge (« Juniors / Seniors F ») va dans la session de sa tranche la plus jeune. Un combattant recasé peut donc combattre dans une autre session que celle de son inscription, ce qui change son heure de convocation. Le club doit le savoir.

**Décidé (utilisateur).** Pas d'horaire. On écrit le nom de la session finale : « Déplacé dans la session Poussins - Pupilles ».

**Mes choix (à corriger si besoin).**
- La mention n'apparaît que lorsque la session change. Session d'inscription : celle de la catégorie naturelle de l'inscription si elle existe, sinon celle que lui donneraient les règles des sessions (tranche du combattant, discipline). Session finale : celle de la catégorie où il combat.
- Rien sans sessions, ni pour une ligne Absent / Ne combat pas / Pas encore placé, ni quand la session finale est « en attente ».
- Rendu : dans la colonne « Au final », sous « Changé (motif) », une ligne en gras « Déplacé dans la session X ». Une ligne dont la session change est toujours marquée « Changé ».
- `RecapLine` reçoit `session: string | null`, le nom de la session finale quand elle change.

## Approches

Une seule approche raisonnable : calculer la session côté serveur avec les fonctions existantes (`waveOfCategory` et la vague des catégories), puis la passer au domaine `recapLines`. Une colonne « Session » sur toutes les lignes a été écartée : elle alourdit le tableau et noie le seul cas utile, le changement de session.

## Vérification

TDD sur `recapLines` (session changée, inchangée, sans sessions, absent), sur le dépôt (catégorie regroupée de tranches de sessions différentes) et sur le PDF (texte présent). Puis Chrome : une carte « Écart de poids » et un récapitulatif téléchargé.
