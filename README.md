# Shidokan France — gestion des compétitions

Application de gestion des compétitions Shidokan (karaté, shido-boxing, shido-mix-martial, triathlon, kata) : inscriptions des clubs, pesée, réaffectation assistée, tableaux, résultats et podiums.

Elle fonctionne **entièrement hors ligne** sur le PC de la salle le jour J, et en ligne sur un serveur pour les inscriptions des clubs.

## Essayer

Avec Docker (Docker Desktop sous Windows et macOS) :

```bash
docker compose up -d --build   # puis ouvrir http://localhost:3000 dans Google Chrome
docker compose down            # pour arrêter
```

Avec une compétition de démonstration déjà remplie (Node.js 22.12 ou plus, voir `.tool-versions`), dans une base à part qui ne touche pas `data/` :

```bash
npm ci
DATABASE_PATH=tmp/demo.sqlite npm run seed:dev
npm run build && DATABASE_PATH=tmp/demo.sqlite npm start   # http://localhost:3000
```

## Documentation

- [Guide de l'organisateur](docs/guide-utilisateur.md) : les installations (serveur, PC, postes, portables de zone), préparer une compétition, le jour J, les coupures de réseau.
- [Installer le serveur en ligne](docs/installation-serveur.md).
- Dans l'application : la phrase sous chaque onglet et le bouton ⓘ.

## Développement

```bash
npm run dev          # serveur (port 3000) + interface Vite (http://localhost:5173)
npm test             # tests unitaires (domaine, serveur)
npm run test:e2e     # tests d'interface sur Google Chrome (Playwright)
npm run typecheck
npm run seed:dev     # ajoute une compétition de démonstration à la base (-- --seed 42 : autre tirage)
```

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` | 3000 | Port HTTP |
| `DATABASE_PATH` | `./data/shidokan.sqlite` (Docker : `/data/shidokan.sqlite`) | Fichier de la base |
| `BACKUP_INTERVAL_MIN` | 5 | Minutes entre deux sauvegardes automatiques (0 : aucune) |
| `INSTANCE_ROLE` | (PC, sans connexion) | `serveur` : connexion obligatoire, pages des clubs, mails |

Conception et feuille de route : `docs/superpowers/`.

Le fichier `coupe-shidokan.xlsx` contient des données personnelles : il n'est **jamais commité**.
