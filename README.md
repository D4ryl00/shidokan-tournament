# Shidokan France — gestion des compétitions

Application de gestion des compétitions Shidokan (karaté, shido-boxing, shido-mix-martial, triathlon, kata) : inscriptions, pesée, recasement assisté, tableaux, résultats et podiums. Elle fonctionne **entièrement hors ligne** sur un PC.

- Conception : `docs/superpowers/specs/2026-10-21-tableaux-shidokan-design.md`
- Feuille de route : `docs/superpowers/plans/2026-10-21-00-feuille-de-route.md`

## Lancer l'application (Docker)

**Prérequis :** Docker Desktop sous Windows et macOS (virtualisation activée), Docker sous Linux.

```bash
docker compose up -d --build
```

Ouvrir ensuite **http://localhost:3000** dans **Google Chrome**.

Pour arrêter l'application :

```bash
docker compose down
```

### Données et sauvegardes

Toutes les données sont dans le dossier **`data/`**, à côté de ce fichier (`data/shidokan.sqlite`, sauvegardes dans `data/sauvegardes/`). Pour copier ce dossier sur une clé USB, **arrêtez d'abord l'application** (ou utilisez « Télécharger la base complète » dans l'onglet Podiums).

### ⚠️ Avant le jour de la compétition

Il n'y a **pas d'internet sur place** : construisez l'image (`docker compose up -d --build`) **avant** d'arriver au gymnase, sur le PC qui servira le jour J, et vérifiez qu'elle démarre.

## Déroulé d'une compétition

1. **Réglages** et **grille âge / poids** (grille FFK par défaut, modifiable, enregistrable comme modèle).
2. **Fiche club** : télécharger le modèle .ods, l'envoyer aux clubs, importer les fiches renvoyées.
3. **Import FFK** à la clôture : aperçu, rapprochement avec les fiches club, import.
4. **Recasement anticipé** des combattants déjà seuls (onglet Recasement).
5. Jour J — **Pesée** (présence, poids ; « Clôturer la pesée » marque absents les non-pesés).
6. **Recasement** : propositions classées, aperçu, validation unitaire ou « Classer automatiquement ».
7. **Tableaux** : vérifier, marquer prêts, imprimer pour le gymnase.
8. **Combats** : affecter les catégories aux tatamis, saisir les résultats (correction possible), noter les katas, départager les égalités.
9. **Podiums** : podiums, classement des clubs, feuilles de résultats, exports .xlsx / .ods.

### Sauvegardes

- Une copie de la base est faite **automatiquement toutes les 5 minutes** dans `data/sauvegardes/` (30 dernières gardées). Réglable avec `BACKUP_INTERVAL_MIN` (0 = désactivé).
- Onglet **Podiums** → « Sauvegarder maintenant », « Télécharger la base complète », « Restaurer une sauvegarde… » (une copie de l'état actuel est faite avant de restaurer).
- Pour changer de PC : copier le dossier `data/` (application arrêtée), ou restaurer une sauvegarde téléchargée.

### Variables

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` | 3000 | Port HTTP |
| `DATABASE_PATH` | `./data/shidokan.sqlite` (Docker : `/data/shidokan.sqlite`) | Fichier de la base |
| `BACKUP_INTERVAL_MIN` | 5 | Minutes entre deux sauvegardes automatiques |

## Développement

Node.js **22.12 ou plus** (voir `.tool-versions`).

```bash
npm ci
npm run dev          # serveur (port 3000) + interface Vite (http://localhost:5173)
npm test             # tests unitaires (domaine, serveur)
npm run test:e2e     # tests d'interface sur Google Chrome (Playwright)
npm run typecheck
npm run build && npm start
```

Le fichier `coupe-shidokan.xlsx` contient des données personnelles : il n'est **jamais commité**.
