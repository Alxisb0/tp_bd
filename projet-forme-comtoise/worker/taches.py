# La tache Celery : produit le PDF et tient l'etat du rapport a jour dans Redis.
import logging
import os
import time

from app import app
from etat import Etat
import rapport

DOSSIER = os.environ.get('RAPPORTS_DIR', '/rapports')
journal = logging.getLogger(__name__)


@app.task(name='rapports.generer')
def generer(rapport_id, debut, fin):
    etat = Etat(rapport_id)
    depart = time.time()
    try:
        etat.maj(statut='en_cours', progression=1, etape='demarrage')
        chemin = os.path.join(DOSSIER, f'{rapport_id}.pdf')
        rapport.construire(debut, fin, chemin + '.tmp',
                           lambda pct, etape: etat.maj(progression=pct, etape=etape))
        os.replace(chemin + '.tmp', chemin)   # le PDF n'apparait que complet
        etat.maj(statut='termine', progression=100, etape='termine', duree_s=round(time.time() - depart, 1))
    except Exception as e:
        journal.exception('rapport %s en echec', rapport_id)
        etat.maj(statut='echoue', erreur=str(e) or type(e).__name__, duree_s=round(time.time() - depart, 1))
