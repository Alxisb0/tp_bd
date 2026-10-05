# Application Celery : la file d'attente est Redis.
import os
from celery import Celery

REDIS_URL = os.environ.get('REDIS_URL', 'redis://127.0.0.1:6379/0')

app = Celery('worker', broker=REDIS_URL, include=['taches'])
app.conf.task_ignore_result = True   # l'etat du rapport est suivi dans Redis, pas par Celery

# une demande n'est acquittee qu'apres le calcul : si le worker meurt, elle retourne dans la file
app.conf.task_acks_late = True
app.conf.task_reject_on_worker_lost = True
app.conf.worker_prefetch_multiplier = 1   # un worker ne reserve pas de taches a l'avance
