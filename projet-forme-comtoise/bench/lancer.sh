#!/bin/sh
# Lance les 4 campagnes du protocole (planning et statistique, sans puis avec cache).
# A lancer depuis la racine du projet, pile deja demarree :  sh bench/lancer.sh
# Seul Docker est necessaire : le script de charge tourne dans un conteneur node.
set -e

API=http://localhost:3000
PLANNING="$API/clubs/1/planning?debut=2026-10-05"
STATISTIQUE="$API/statistiques/activites?debut=2024-09-01&fin=2027-03-01"

mkdir -p bench/resultats

# redemarre seulement l'api avec la valeur du cache, attend qu'elle reponde, vide Redis
redemarrer_api() {
  CACHE_ACTIF=$1 docker compose up -d --no-deps --force-recreate api
  for i in $(seq 1 30); do
    curl -s -f "$API/sante" > /dev/null && break
    sleep 1
  done
  docker compose exec -T redis redis-cli FLUSHALL
}

# $1 = url, $2 = nom du fichier de mesures, $3 = ligne du tableau
campagne() {
  docker run --rm --network host --user "$(id -u):$(id -g)" \
    -v "$PWD/bench:/bench" -w /bench node:22-slim \
    node charge.mjs "$1" "resultats/$2.csv" "$3"
}

echo "=== sans cache"
redemarrer_api 0
campagne "$PLANNING" planning-sans-cache "planning | sans"
campagne "$STATISTIQUE" statistique-sans-cache "statistique | sans"

echo "=== avec cache"
redemarrer_api 1
campagne "$PLANNING" planning-avec-cache "planning | avec"
campagne "$STATISTIQUE" statistique-avec-cache "statistique | avec"
