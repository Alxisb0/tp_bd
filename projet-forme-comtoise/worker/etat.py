# Etat d'un rapport dans Redis : un hash "rapport:<id>", lu par l'API.
# Champs : statut, progression, etape, erreur, duree_s, debut, fin, demande_le.
import os
import redis

REDIS_URL = os.environ.get('REDIS_URL', 'redis://127.0.0.1:6379/0')


class Etat:
    def __init__(self, rapport_id):
        self.cle = f'rapport:{rapport_id}'
        self.redis = redis.Redis.from_url(REDIS_URL, decode_responses=True)

    def maj(self, **champs):
        self.redis.hset(self.cle, mapping={nom: str(valeur) for nom, valeur in champs.items()})
