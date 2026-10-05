# Lecture des clubs et des contrats dans MongoDB (les collections migrees).
import os
import pandas as pd
from pymongo import MongoClient

MONGO_URI = os.environ.get('MONGO_URI', 'mongodb://127.0.0.1:27017/forme-comtoise')


def _base():
    return MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000).get_default_database()


# {'BES-CENTRE': {'id': 1, 'nom': 'Besancon Centre', 'capacite': 140}, ...}
def charger_clubs():
    return {
        c['code']: {'id': c['_id'], 'nom': c['nom'], 'capacite': c['capacite']}
        for c in _base().clubs.find()
    }


# Un contrat par ligne, avec l'adherent. Sert aux cartes pretees et aux inactifs.
def charger_contrats():
    lignes = _base().adherents.aggregate([
        {'$unwind': '$abonnements'},
        {'$project': {
            'badge': 1, 'prenom': 1, 'nom': 1, 'club_id': 1,
            'debut': '$abonnements.debut', 'fin': '$abonnements.fin',
        }},
    ])
    contrats = pd.DataFrame(list(lignes)).rename(columns={'_id': 'adherent_id'})
    contrats['debut'] = pd.to_datetime(contrats.debut)
    contrats['fin'] = pd.to_datetime(contrats.fin)
    return contrats
