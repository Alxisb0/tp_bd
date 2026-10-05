# Forme Comtoise — nouvelle API des clubs

## 1. Lancement

Seul Docker (avec le plugin compose) est necessaire. Les commandes, dans l'ordre :

```bash
# 1. se placer dans le dossier du projet (celui qui contient docker-compose.yml)
cd bollengier-alexis

# 2. copier les deux fichiers de l'archive dans data/ (ils ne sont pas dans le zip)
cp /chemin/vers/forme-comtoise.sqlite /chemin/vers/passages-2024-2026.csv data/

# 3. tout demarrer : mongo, redis, migration, api, worker
docker compose up -d --build

# 4. verifier (la migration passe a "Exited (0)" au bout d'une trentaine de secondes)
docker compose ps -a
curl http://localhost:3000/sante

# 5. rejouer la collection Postman, rapport compris (newman tourne dans un conteneur)
docker run --rm --network host -v "$PWD/postman:/etc/newman" postman/newman run forme-comtoise.postman_collection.json

# 6. lancer les mesures de charge (voir la section 4)
sh bench/lancer.sh

# 7. tout arreter (ajouter -v pour supprimer aussi les volumes)
docker compose down
```

Quelques remarques :

- `docker compose up` sans `-d` marche aussi, les logs de tous les services s'affichent.
- La migration est rejouee a chaque `docker compose up` : elle vide puis reconstruit les cinq collections.
  Les reservations ou adherents ajoutes pendant les tests disparaissent donc au redemarrage suivant.
- Avec Docker Desktop, seuls les dossiers partages peuvent etre montes (par defaut le dossier personnel). Si compose
  repond `mounts denied ... is not shared from the host`, deplacer le projet dans le dossier personnel (pas dans /tmp).
- Sous Windows ou macOS (Docker Desktop), `--network host` ne donne pas acces au localhost de la machine.
  Pour newman, ajouter `--env-var baseUrl=http://host.docker.internal:3000`.
- Le PDF d'un rapport se recupere avec la collection Postman, ou avec
  `curl -o rapport.pdf http://localhost:3000/rapports/<id>/pdf` (l'id est donne par `POST /rapports`).

## 2. Decisions de modelisation

8 tables SQLite -> 5 collections MongoDB. Le but etait de partir des retours des clubs
(mail d'Helene Cattin) plutot que de juste copier les tables telles quelles.

Les remontees des clubs sont notees (a) a (i), dans l'ordre du mail :
(a) prix signe, (b) formule actuelle et historique, (c) liste d'appel de 30 places,
(d) plus de 550 reservations pour un adherent, (e) nom du coach qui change,
(f) coach jamais supprime, (g) une activite ne change jamais de nom,
(h) capacite d'un club qui change, (i) specialites saisies a la main.

| Table SQLite | Devient | Raison | Remontees |
|---|---|---|---|
| clubs | collection `clubs` ; `horaires` passe de texte JSON a objet | la capacite est un simple champ a mettre a jour, personne ne veut son historique | (h) |
| formules | collection `formules` | le tarif actuel vit a un seul endroit ; le prix paye est ailleurs, fige dans le contrat | (a) |
| adherents | collection `adherents` | c'est le document que l'accueil ouvre en premier | (b) |
| abonnements | imbriques dans `adherents.abonnements` (tableau) | 1,2 contrat par adherent en moyenne, donc tableau borne ; chaque contrat garde son prix signe | (a), (b) |
| coachs | collection `coachs`, referencee par `coach_id` depuis les seances ; `specialites` devient un tableau propre | le nom est lu a la source, jamais copie ailleurs ; un coach qui part passe `actif:false` | (e), (f), (i) |
| activites | copiees dans `seances.activite` (nom, categorie, intensite, duree) | une activite ne change jamais de nom, la copie ne peut pas devenir fausse | (g) |
| seances | collection `seances` | un cours est lu avec sa liste d'appel | (c) |
| reservations | imbriquees dans `seances.reservations` (tableau) | borne par `places` (30 au plus) ; dans `adherents` le tableau grossirait sans limite | (c), (d) |

8 tables, 5 collections : `clubs`, `formules`, `adherents`, `coachs`, `seances`.

### clubs -> collection `clubs`

Presque identique a la table de depart. Le seul changement : le champ `horaires`
qui etait du texte JSON dans SQLite (genre `'{"lundi-vendredi": "06:30-22:00"}'`)
devient un vrai objet dans MongoDB, plus besoin de le parser a chaque lecture.

Patrick dit que la capacite d'un club change parfois (travaux, commission de securite),
mais personne ne demande a garder l'historique des anciennes capacites, donc c'est
juste un champ qu'on met a jour, pas besoin de plus complique.

Exemple de document :
```json
{
  "_id": 1,
  "code": "BES-CENTRE",
  "nom": "Besançon Centre",
  "ville": "Besançon",
  "adresse": "14 rue des Granges, 25000 Besançon",
  "capacite": 140,
  "horaires": { "lundi-vendredi": "06:30-22:00", "samedi": "08:00-20:00", "dimanche": "09:00-13:00" },
  "ouvert_le": "2019-09-02"
}
```

### formules -> collection `formules`

Reste separee des autres. Le prix change de temps en temps (Patrick : "on a augmente
Premium l'an dernier"), et plein d'adherents la referencent, donc autant la garder
a un seul endroit qu'on peut mettre a jour facilement.

Exemple :
```json
{ "_id": 3, "code": "PREMIUM", "libelle": "Premium", "prix_mensuel_centimes": 4690,
  "engagement_mois": 12, "cours_collectifs": true, "tous_les_clubs": true }
```

### adherents + abonnements -> collection `adherents`

C'est la fusion la plus importante. Un adherent a en moyenne 1,2 contrat sur toute sa
vie chez Forme Comtoise (13248 abonnements pour 11115 adherents), donc j'ai mis tout
l'historique des contrats directement dans le document de l'adherent, en tableau.

Deux remontees justifient ce choix :
- Sabrina (accueil Pontarlier) veut voir la formule actuelle ET l'historique complet
  sur un seul ecran. Avec l'historique dans le document adherent, c'est une seule
  lecture, pas de jointure a faire.
- Patrick precise que le prix paye reste celui signe au moment du contrat, meme si le
  tarif public a change depuis. Verifie sur un vrai exemple (adherent id 1308) : il a
  paye 2990 centimes pour la formule Confort en 2022, puis 3290 en 2024, alors que
  Confort vaut 3490 aujourd'hui. Donc chaque entree de l'historique garde son propre
  prix, jamais recalcule depuis `formules`.

Exemple (adherent avec plusieurs contrats) :
```json
{
  "_id": 1308,
  "badge": "B0...",
  "prenom": "...",
  "nom": "...",
  "email": "...",
  "club_id": 1,
  "inscrit_le": "2021-01-12",
  "abonnements": [
    { "formule_id": 5, "debut": "2021-01-12", "fin": "2021-02-11", "prix_mensuel_centimes": 1790, "statut": "termine" },
    { "formule_id": 1, "debut": "2021-02-12", "fin": "2022-02-11", "prix_mensuel_centimes": 1990, "statut": "termine" },
    { "formule_id": 2, "debut": "2022-02-12", "fin": "2023-02-11", "prix_mensuel_centimes": 2990, "statut": "termine" },
    { "formule_id": 3, "debut": "2023-02-12", "fin": "2024-02-11", "prix_mensuel_centimes": 4190, "statut": "termine" },
    { "formule_id": 2, "debut": "2024-02-12", "fin": "2025-02-11", "prix_mensuel_centimes": 3290, "statut": "resilie" }
  ]
}
```

### coachs -> collection `coachs`

Reste sa propre collection, presque pareil, sauf le champ `specialites` qui est
nettoye. Dans la base actuelle c'est ecrit n'importe comment (`"Yoga, Pilates ,stretching"`,
`"BOXE;circuit training"`, `"yoga,pilates, Stretching"`...) donc a la migration je
decoupe sur virgule/point-virgule, je passe en minuscules, je supprime les espaces
en trop, et ca devient une liste propre.

Pourquoi elle reste une collection a part : Julie Perrin raconte que quand elle
s'est mariee et a change de nom, le planning a continue d'afficher l'ancien nom
pendant trois semaines. Ca veut dire que le nom d'un coach doit toujours etre lu
directement depuis sa fiche, jamais recopie ailleurs. Et la direction precise
qu'un coach qui part n'est jamais supprime (ses cours passes gardent son nom dans
les stats) donc cette collection doit rester permanente, jamais videe.

Exemple :
```json
{ "_id": 1, "prenom": "Julie", "nom": "Perrin", "email": "julie.perrin@forme-comtoise.fr",
  "club_id": 1, "specialites": ["yoga", "pilates", "stretching"],
  "embauche_le": "2021-02-01", "actif": true }
```

### seances + activites + reservations -> collection `seances`

La plus grosse fusion. Deux idees :

- La direction dit qu'une activite ne change jamais de nom (si le concept change on
  cree une nouvelle activite). Du coup on peut recopier sans risque le nom/categorie/
  duree de l'activite directement dans chaque seance au moment ou elle est creee, pas
  besoin d'une table a part pour ca.
- Julie veut imprimer la liste d'appel 5 minutes avant son cours, donc les reservations
  de cette seance sont mises directement dans le document de la seance.

Le point le plus important pour ce choix : l'accueil de Besancon Centre signale qu'un
adherent (M. Grosjean) a deja reserve plus de 550 cours. Si on avait mis les
reservations dans le document de l'adherent, cette liste grossirait sans jamais
s'arreter, ce qui est deconseille en MongoDB (tableau non borne). En les mettant dans
la seance a la place, elles sont limitees par le nombre de places du cours (entre 16
et 30 dans les donnees actuelles), donc jamais de probleme de taille.

Exemple (verifie sur la vraie seance id 1, 16 places, 14 presents + 2 annulations) :
```json
{
  "_id": 1,
  "club_id": 1,
  "coach_id": 4,
  "salle": "Studio 1",
  "debut": "2024-09-02T17:30:00+02:00",
  "places": 16,
  "annulee": false,
  "activite": { "nom": "Circuit training", "categorie": "renforcement", "intensite": 3, "duree_min": 45 },
  "reservations": [
    { "adherent_id": 666, "reservee_le": "2024-08-28T17:00:22+02:00", "statut": "presente" },
    { "adherent_id": 5770, "reservee_le": "2024-08-28T10:47:36+02:00", "statut": "annulee" }
  ]
}
```

### Resultat

5 collections : `clubs`, `formules`, `adherents`, `coachs`, `seances`.
Les tables `abonnements`, `activites` et `reservations` disparaissent, chacune
absorbee ailleurs pour une raison precise (voir ci-dessus).

## 3. Routes

Toutes les routes repondent en JSON. Les erreurs ont la forme `{ "erreur": "..." }`.

| Methode | Chemin | Role | Codes possibles |
|---|---|---|---|
| GET | `/sante` | verifie que l'API repond | 200 |
| GET | `/clubs` | liste des clubs et de leurs horaires | 200 |
| GET | `/clubs/:id/planning?debut=AAAA-MM-JJ` | planning d'un club pour la semaine commencant le `debut` donne, avec les places restantes par seance | 200, 400 (parametre manquant ou mal formate) |
| GET | `/clubs/:id/chiffre-affaires?mois=AAAA-MM` | chiffre d'affaires du club pour ce mois (contrats en cours le 1er du mois, au prix signe) | 200, 400 |
| GET | `/formules` | liste des formules et de leur prix actuel | 200 |
| PATCH | `/formules/:id` | change le prix d'une formule ; ne touche pas les abonnements deja signes | 200, 400 (prix manquant ou invalide), 404 (formule inconnue) |
| POST | `/seances/:id/reservations` | reserve une place pour un adherent (`adherent_id` dans le corps) | 201, 400 (adherent_id manquant), 403 (pas d'abonnement actif, formule sans cours collectifs, ou club non couvert par la formule), 404 (adherent ou seance inconnue), 409 (seance annulee, deja reserve, ou plus de place) |
| DELETE | `/seances/:id/reservations/:adherentId` | annule une reservation confirmee | 200, 404 (reservation introuvable ou deja annulee/traitee) |
| GET | `/adherents/:id` | fiche d'un adherent : formule actuelle, historique des formules, 10 dernieres seances | 200, 404 |
| POST | `/adherents` | inscrit un nouvel adherent avec sa premiere formule | 201, 400 (champ obligatoire manquant), 404 (club ou formule inconnue) |
| PATCH | `/coachs/:id` | modifie un coach (`email`, `specialites`, `actif`) ; un coach qui part passe `actif:false`, jamais supprime | 200, 400 (aucun champ fourni), 404 |
| PATCH | `/seances/:id/annuler` | annule une seance (coach malade, salle indisponible...) ; elle disparait du planning | 200, 404 |
| GET | `/statistiques/activites?debut=AAAA-MM-JJ&fin=AAAA-MM-JJ` | taux de remplissage et taux d'absence par activite sur la periode | 200, 400 |
| GET | `/statistiques/coachs?debut=AAAA-MM-JJ&fin=AAAA-MM-JJ` | classement des coachs par taux de remplissage de leurs seances sur la periode | 200, 400 |
| POST | `/rapports` | demande le rapport de frequentation (corps facultatif `{debut, fin}`, par defaut 2025-09-01 au 2026-08-31) ; repond tout de suite avec l'id et le lien de suivi | 202, 400 (dates mal formees ou debut apres fin) |
| GET | `/rapports/:id` | etat du rapport : `statut` (`en_attente`, `en_cours`, `termine`, `echoue`), `progression` (0 a 100), `etape`, `erreur` si echec, `duree_s` et lien `pdf` quand il est termine | 200, 404 |
| GET | `/rapports/:id/pdf` | telecharge le PDF | 200, 404 (rapport inconnu), 409 (pas termine, ou echoue) |

Le classement des coachs est fait sur le remplissage plutot que sur le nombre de
seances brut : un coach a temps partiel avec des cours pleins doit pouvoir sortir
devant un coach a temps plein avec des cours a moitie vides.

### Reservations simultanees

Reserver une place est une seule ecriture atomique sur le document de la seance : MongoDB n'y ajoute la reservation que
si la seance n'est pas annulee, si l'adherent n'a pas deja une reservation active et s'il reste de la place. Deux demandes
simultanees ne peuvent donc pas obtenir la meme derniere place (la seconde recoit 409).

`bench/concurrence.mjs` le verifie, avec l'API demarree :

```bash
docker run --rm --network host -v "$PWD/bench:/bench" -w /bench node:22-slim node concurrence.mjs
```

Test 1 : plus d'adherents que de places restantes demandent la meme seance en meme temps ; il doit y avoir exactement
autant de 201 que de places, 409 pour les autres, et la seance doit etre pleine ensuite. Test 2 : le meme adherent envoie
10 demandes en meme temps ; une seule doit passer. Le script cree des adherents de test (ils disparaissent a la prochaine
migration), remet les places comme avant, affiche OK ou ECHEC pour chaque verification et se termine avec un code non nul
en cas d'echec.

## 4. Mesures

### Ce qui est mis en cache

Deux lectures seulement, dans Redis :

| Lecture | Cle | Duree de vie | Pourquoi |
|---|---|---|---|
| planning d'un club pour une semaine | `planning:<club>:<debut>` | 60 s | c'est la page la plus consultee, surtout le dimanche soir : peu de plannings differents (5 clubs, une ou deux semaines) lus tres souvent |
| statistiques de la direction (activites, coachs) | `stats:activites:<debut>:<fin>`, `stats:coachs:<debut>:<fin>` | 300 s | calcul lourd sur toutes les seances, consulte le lundi matin ; un retard de quelques minutes est accepte |

Le reste n'est pas mis en cache : fiche adherent, formules et clubs sont des lectures rares ou deja rapides,
et le chiffre d'affaires est demande de temps en temps seulement.

Le planning change a chaque reservation, donc il est invalide a la main : une reservation, une annulation de
reservation ou une annulation de seance supprime les cles `planning:<club>:*` du club concerne (toutes les semaines,
car la route accepte n'importe quelle date de debut). Les 60 s ne servent que de filet. Les statistiques ne sont pas
invalidees : elles se rafraichissent toutes seules au bout de 5 minutes.

Le cache se coupe avec la variable d'environnement `CACHE_ACTIF=0`, sans toucher au code (par defaut il est actif).
Chaque reponse porte un en-tete `X-Cache: HIT` ou `MISS` (absent quand le cache est coupe). Si Redis ne repond pas,
l'API calcule la reponse comme sans cache.

### Protocole

`bench/charge.mjs` (Node 22, sans dependance) suit l'annexe A : une vingtaine de requetes d'echauffement non comptees,
puis 20 clients simultanes qui envoient chacun 20 requetes l'une apres l'autre, soit 400 requetes. Les indicateurs sont
calcules sur les reponses 200 : moyenne, ecart-type (n-1), p95 (rang ceil(0,95 x n)), echecs, et debit (400 requetes
divisees par la duree de la campagne).

Deux routes :

- le planning du club 1 pour la semaine du 2026-10-05 ;
- `/statistiques/activites` du 2024-09-01 au 2027-03-01, donc sur les 17 398 seances.

`sh bench/lancer.sh` joue les quatre campagnes. Pour chaque valeur du cache, il redemarre seulement le service `api`
(`CACHE_ACTIF=0` puis `1`, avec `docker compose up -d --no-deps --force-recreate api`), attend qu'il reponde, puis vide Redis
(`docker compose exec redis redis-cli FLUSHALL`). Les mesures brutes sont dans `bench/resultats/` :
`planning-sans-cache.csv`, `planning-avec-cache.csv`, `statistique-sans-cache.csv`, `statistique-avec-cache.csv`
(colonnes client, rang, ms, statut).

### Resultats

Mesures sur mon portable (Ubuntu, Docker), le script de charge et l'API sur la meme machine, une seule passe par ligne.

| Route | Cache | Moyenne | Ecart-type | p95 | Echecs | Debit |
|---|---|---|---|---|---|---|
| planning | sans | 300,7 ms | 73,0 ms | 431,6 ms | 0 / 400 | 65,0 req/s |
| planning | avec | 10,2 ms | 3,4 ms | 17,5 ms | 0 / 400 | 1885,4 req/s |
| statistique | sans | 2045,7 ms | 376,7 ms | 2677,3 ms | 0 / 400 | 9,6 req/s |
| statistique | avec | 7,5 ms | 2,1 ms | 10,7 ms | 0 / 400 | 2596,5 req/s |

### Interpretation

Il n'y a aucun echec, meme sans cache : l'API tient la charge, elle est seulement lente.

Le cache divise la moyenne par environ 29 pour le planning et par environ 270 pour la statistique, et le debit
est multiplie par les memes facteurs. Le p95 baisse de la meme facon (environ 25 fois et 250 fois). Le gain est
plus grand pour la statistique parce que son calcul est plus lourd : c'est un agregat sur toutes les seances
de la periode, alors que le planning ne lit qu'une semaine d'un club.

Sans cache, le temps de reponse vient surtout de l'attente. Le debit donne un temps de traitement d'environ 15 ms par
requete pour le planning (1/65 s) et d'environ 100 ms pour la statistique (1/9,6 s), comme si le serveur traitait les
requetes une par une. Avec 20 clients simultanes, chacun attend donc derriere les autres : 20 x 15 ms donne bien les
300 ms mesures. On le verifie avec debit x temps moyen = nombre de clients, qui donne entre 19 et 20 dans les quatre
lignes. Avec le cache, il ne reste que Node et Redis, et la reponse du planning (environ 9 ko) est plus grosse que celle de
la statistique (environ 1,5 ko), ce qui explique les 10,2 ms contre 7,5 ms.

L'ecart-type baisse en valeur absolue (de 73 a 3,4 ms et de 377 a 2,1 ms), mais pas en proportion de la moyenne
(environ 20 % sans cache, 30 % avec) : quand les temps sont de quelques millisecondes, la moindre variation compte
davantage. Le p95 reste entre 1,3 et 1,7 fois la moyenne dans les quatre cas, il n'y a pas de requete isolee tres lente.

Ces chiffres sont le meilleur cas pour le cache : l'echauffement le remplit et les 400 requetes demandent toutes
la meme URL, donc toutes sont des `HIT`. Le dimanche soir, avec peu de plannings differents lus par beaucoup d'adherents,
on se rapproche de ce cas ; avec des plannings tous differents, le gain serait plus faible.

## 5. Rapport

### Fonctionnement

`POST /rapports` ecrit d'abord l'etat du rapport dans Redis (`en_attente`), puis depose la tache `rapports.generer`
dans la file Celery (Redis aussi) et repond `202` avec l'id et le lien de suivi `/rapports/<id>`. La requete dure quelques
millisecondes, la limite de 30 s de l'hebergeur ne s'applique donc plus au calcul.

Le worker Python (Celery, un seul processus : un rapport a la fois) passe l'etat a `en_cours`, met a jour la
`progression` et l'`etape` pendant le calcul, ecrit le PDF dans le volume `rapports` (d'abord sous un nom
temporaire, pour qu'on ne puisse jamais telecharger un PDF a moitie ecrit), puis passe a `termine`.
`GET /rapports/<id>` lit cet etat, `GET /rapports/<id>/pdf` sert le fichier.

Un echec est visible dans le statut : le worker attrape l'exception, passe a `echoue` et garde le message dans
`erreur`. On peut le provoquer avec une periode sans passages :

```bash
curl -X POST -H 'Content-Type: application/json' -d '{"debut":"2030-01-01","fin":"2030-12-31"}' http://localhost:3000/rapports
# puis GET /rapports/<id> : "statut":"echoue","erreur":"aucun passage entre le 01/01/2030 et le 31/12/2030"
```

Le PDF fait 26 pages avec les graphiques : synthese par club (periode et un an plus tot), pour chaque club et chaque
mois l'occupation par jour de la semaine et par heure, le pic de chaque journee compare a la capacite et l'ecart avec
le meme mois de la saison precedente, les journees a risque, les cartes pretees et les adherents inactifs, club par club.

### Duree de generation

Mesure sur mon portable : 6,9 s pour le rapport par defaut (du 2025-09-01 au 2026-08-31), dans deux essais
successifs (champ `duree_s` de `GET /rapports/<id>`). Cette duree comprend la lecture du CSV (1,13 million de lignes),
le nettoyage, les calculs et la mise en page du PDF de 26 pages. Le notebook actuel depasse la minute. Meme si le calcul
tient sous les 30 s de l'hebergeur, il n'est pas fait pendant la requete : `POST /rapports` repond en quelques millisecondes,
et la duree d'un rapport sur une autre periode ou une machine plus lente ne change rien pour l'API.

### Regles de calcul

Elles sont aussi rappelees sur la premiere page du PDF, avec le nombre de passages concernes.

- **Badge de test.** Le badge `B000000` (le technicien du prestataire) est retire avant tout calcul : 380 passages,
  tous vers 6 h du matin, avant l'ouverture.
- **Doubles passages.** Deux passages du meme badge, dans le meme club, dans le meme sens, a moins de 60 secondes l'un de
  l'autre n'en font qu'un (on garde le premier) : 4 381 passages retires. Dans l'export, tous ces doublons sont
  espaces de 2 a 41 secondes, le seuil de 60 s les attrape tous.
- **Visite.** Une entree suivie de sa sortie, meme badge, meme club, meme jour. Apres nettoyage, l'export donne
  570 810 visites.
- **Entrees sans sortie** (17 573, soit 3 %). Je les compte comme des visites : la personne est bien venue, elle compte
  parmi les visiteurs et elle n'est pas inactive. Mais sa duree est inconnue, donc elle n'entre ni dans les durees ni dans
  la mediane. Pour la presence, je la garde presente pendant la duree mediane des visites du club (environ 71 minutes),
  sans depasser minuit. Les ignorer aurait sous-estime les pics, et les laisser jusqu'a la fermeture les aurait surestimes.
- **Sorties sans entree** (5 174). Ce n'est pas une visite : elles sont ignorees.
- **Presence et pic.** La presence est calculee minute par minute ; le pic d'une journee est le plus grand nombre de
  personnes presentes en meme temps ce jour-la. Les journees a risque sont celles ou ce pic atteint 90 % de la capacite du club
  (ou plus, avec une mention quand il depasse 100 %).
- **Cartes pretees.** Deux entrees consecutives du meme badge dans deux clubs differents, a moins de 40 minutes d'ecart.
- **Adherents inactifs.** Contrat en cours le dernier jour de la periode (commence ce jour-la ou avant, et fin vide ou apres
  ce jour) et aucune visite du 2 au 31 aout 2026 (30 jours), dans aucun club. Les contrats suspendus courent toujours, ces
  adherents sont donc comptes. Chaque adherent est range sous son club d'inscription. Sur la derniere saison : 627
  inactifs (203 a Besancon Centre, 161 a Besancon Valentin, 118 a Montbeliard, 92 a Dole, 53 a Pontarlier).
- **Comparaison.** La periode est comparee a la meme periode un an plus tot (mois par mois pour la partie 2).

## 6. Limites connues

- **Suivi des rapports dans Redis.** L'etat d'un rapport (statut, progression, erreur) est dans Redis et pas dans
  MongoDB, pour ne pas ajouter de sixieme collection. Il disparait si Redis est vide (le `FLUSHALL` du bench efface aussi
  les rapports en cours ou termines) ou redemarre, et il expire au bout de 7 jours. Les PDF restent sur le volume
  `rapports`, mais sans leur etat on ne peut plus les retrouver par l'API. Il n'y a pas de nettoyage des vieux PDF.
- **Worker.** Un seul rapport est calcule a la fois, les autres restent `en_attente`. La demande n'est acquittee qu'apres le
  calcul (`task_acks_late`) : si le worker meurt en plein calcul, elle retourne dans la file et un worker relance le
  rapport, qui peut donc etre calcule deux fois (sans dommage, le PDF est simplement reecrit). En attendant, le statut
  reste `en_cours` : il n'y a pas de delai maximum. Si aucun worker ne tourne, il reste `en_attente`. Le depot de la tache dans la file n'est pas confirme a l'API (la
  bibliotheque `celery-node` publie sans attendre de reponse).
- **Demandes en double.** Deux clics sur `POST /rapports` creent deux rapports et deux calculs. On ne deduplique pas :
  une cle par periode demandee permettrait de renvoyer le rapport deja en cours.
- **Redis.** Aucune persistance n'est activee : un redemarrage de Redis perd les demandes en attente (a resoumettre).
  Quand une cle de cache expire, plusieurs requetes simultanees peuvent recalculer la meme reponse (effet de meute) ;
  au volume du projet, cela reste sans consequence.
- **Inscription.** `POST /adherents` prend le plus grand identifiant + 1, il n'y a pas de compteur : deux inscriptions
  strictement simultanees peuvent viser le meme identifiant, et l'une des deux echoue avec une erreur.
- **Migration.** Elle supprime et reconstruit les cinq collections a chaque `docker compose up`. Les adherents et
  reservations crees par l'API pendant les tests sont donc perdus au redemarrage complet.
- **Cache.** Les statistiques peuvent avoir jusqu'a 5 minutes de retard. Si une requete lit le planning juste avant une
  reservation et ecrit son resultat juste apres l'invalidation, un planning perime peut rester jusqu'a 60 s. Si Redis tombe,
  l'API continue sans cache, plus lentement.
- **Rapport.** Il ne couvre que les dates de l'export (du 1er septembre 2024 au 31 aout 2026) ; une periode dont l'annee
  precedente sort de ces dates affiche des tirets pour la comparaison. Les heures de sortie manquantes sont estimees (voir les
  regles), donc les pics qui en dependent sont approximatifs. La presence est calculee a la minute.
- **Mesures.** Une seule passe par ligne du tableau, le script de charge et l'API tournent sur la meme machine et se
  partagent le processeur. Les 400 requetes d'une campagne visent la meme URL, ce qui est le meilleur cas pour le cache.
- **Planning.** Les semaines sont decoupees a minuit UTC et pas a minuit heure de Paris ; comme les clubs sont fermes la nuit,
  cela ne change aucune seance.
- **Pas d'authentification** sur l'API, ce que le cahier des charges ne demande pas.
