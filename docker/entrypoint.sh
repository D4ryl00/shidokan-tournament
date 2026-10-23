#!/bin/sh
# Démarre l'application sans les droits d'administrateur (utilisateur « node ») quand c'est possible.
# Si le dossier des données ne peut pas être rendu accessible à « node » (certains partages de dossiers de Docker Desktop),
# l'application continue comme avant, pour ne jamais empêcher la compétition de tourner.
set -e
if [ "$(id -u)" = "0" ]; then
  DATA_DIR="$(dirname "${DATABASE_PATH:-/data/shidokan.sqlite}")"
  mkdir -p "$DATA_DIR"
  chown -R node:node "$DATA_DIR" 2>/dev/null || true
  if setpriv --reuid=node --regid=node --init-groups sh -c "test -w '$DATA_DIR' && { [ ! -e '$DATA_DIR/shidokan.sqlite' ] || test -w '$DATA_DIR/shidokan.sqlite'; }"; then
    exec setpriv --reuid=node --regid=node --init-groups "$@"
  fi
  echo "Avertissement : les données ne sont pas accessibles à l'utilisateur node ; l'application tourne en administrateur." >&2
fi
exec "$@"
