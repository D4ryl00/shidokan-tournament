# Finales dès que la catégorie est finie — conception (à reprendre)

Date : 2026-11-08. Né pendant la conception du mode spectateur (`2026-11-08-mode-spectateur-design.md`) ; ✅ à traiter
**après** le mode spectateur, comme un chantier à part. Touche l'ordre de passage
(`2026-10-22-ordre-de-passage-et-aides-design.md`, code `src/domain/passages/`).
✅ = décidé par l'utilisateur, 💡 = choix du concepteur (à vérifier en lisant).

État : décisions recueillies, **pas encore relu par un constructeur ni approuvé**. À reprendre avec l'utilisateur avant le plan.

## 1. Aujourd'hui

- Ordre « catégorie par catégorie » sans zone des finales : la finale passe sur la zone de la catégorie, juste après elle.
- Ordre « tour par tour » sans zone des finales : les finales passent en dernier sur chaque zone (même distance à la fin).
- Avec une zone des finales (`settings.finalsZoneId`) : toutes les finales de la vague passent sur cette zone, après ses
  propres combats, dans l'ordre des catégories (`orderWave` dans `src/domain/passages/plan.ts`).

## 2. Ce que veut l'utilisateur

Exemple ✅ : les finales se font sur le **ring**, qui accueille aussi les combats de **shido-boxing**. Un ring d'honneur où
l'on joue chaque finale dès qu'elle est prête, devant tout le monde ✅.

Un réglage de la compétition, deux choix :

1. **Finales à la fin de la session** ✅ (garder ce qui existe : « il faut garder la possibilité de faire les finales à la
   fin de la session »).
2. **Finales dès que la catégorie est finie** ✅ :
   - **Sans zone des finales** : la finale passe sur la zone de la catégorie, juste après son dernier combat, quel que soit
     l'ordre de passage (« tour par tour » compris) 💡.
   - **Avec une zone des finales** : la zone des finales joue d'abord **tous ses propres combats** (le shido-boxing du
     ring), puis les finales ✅ (« on pourra faire les finales des autres zones une fois que les combats de shido-boxing
     sont finis »). Les finales des **catégories de la zone des finales elle-même** passent avec les autres finales, après
     tous ses combats ✅, pour laisser les combattants du ring se reposer.
   - Les finales sont rangées dans l'ordre où leurs catégories se terminent, d'après les heures estimées du mode spectateur
     💡 (ordre des catégories à défaut d'heures).
   - Si la zone des finales n'a aucun combat à elle, chaque finale y passe dès que sa catégorie est terminée 💡.

## 3. Une zone en avance ✅

✅ « Si une zone prend de l'avance, on pourrait choisir de commencer sa finale avant pour gagner du temps. »

💡 Proposition : les numéros figés ne bougent pas (ils sont imprimés). La zone des finales peut appeler une finale **prête**
(ses deux finalistes connus) avant son tour ; sa file la signale « prête, peut passer plus tôt ». Le résultat se saisit
comme d'habitude, hors ordre. Le calcul des heures du mode spectateur doit accepter des combats joués hors ordre.

## 4. À trancher avec l'utilisateur avant le plan

- Le réglage vaut-il pour toute la compétition, ou par vague ?
- Kata : ses finales suivent-elles le même choix (aujourd'hui `kataFinalsOnFinalsZone`) ?
- Vérifier la proposition §3 (pas de renumérotation) avec l'utilisateur.
