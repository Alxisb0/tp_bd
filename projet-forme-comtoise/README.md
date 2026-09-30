# Forme Comtoise — nouvelle API des clubs

## 1. Lancement

A completer une fois que docker compose fonctionne chez moi (probleme de virtualisation
en cours de resolution, dual-boot Linux prevu). Pour l'instant developpement et tests
en local avec MongoDB installe directement sur la machine.

## 2. Decisions de modelisation

8 tables SQLite -> 5 collections MongoDB. Le but etait de partir des retours des clubs
(mail d'Helene Cattin) plutot que de juste copier les tables telles quelles.

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

Le classement des coachs est fait sur le remplissage plutot que sur le nombre de
seances brut : un coach a temps partiel avec des cours pleins doit pouvoir sortir
devant un coach a temps plein avec des cours a moitie vides.

## 4. Mesures

A completer une fois le protocole de charge lance (necessite Docker).

## 5. Rapport

A completer une fois le worker teste.

## 6. Limites connues

A completer a la fin.
