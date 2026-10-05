// Rapport de frequentation : la demande repond tout de suite (202), le worker
// Python (Celery) produit le PDF, et l'etat est suivi dans Redis.
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import celery from 'celery-node';
import { redis, URL_REDIS } from '../redis.js';

export const routeurRapports = Router();

const DOSSIER = process.env.RAPPORTS_DIR || '/rapports';
const SEPT_JOURS = 7 * 24 * 3600;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// la file de Celery est la meme instance Redis
const tache = celery.createClient(URL_REDIS, URL_REDIS).createTask('rapports.generer');

const cle = (id) => `rapport:${id}`;
const identifiantValide = (id) => /^[0-9a-f-]{36}$/.test(id);

routeurRapports.post('/rapports', async (req, res, next) => {
  try {
    const debut = req.body?.debut ?? '2025-09-01';
    const fin = req.body?.fin ?? '2026-08-31';
    if (!DATE.test(debut) || !DATE.test(fin) || debut > fin) {
      return res.status(400).json({ erreur: 'debut et fin attendus au format AAAA-MM-JJ, debut avant fin' });
    }

    const id = randomUUID();
    // l'etat est ecrit AVANT de deposer la tache : le suivi existe des la reponse
    await redis.hset(cle(id), {
      statut: 'en_attente', progression: 0, etape: 'en attente du worker',
      debut, fin, demande_le: new Date().toISOString(),
    });
    await redis.expire(cle(id), SEPT_JOURS);
    tache.applyAsync([id, debut, fin]);

    res.status(202).location(`/rapports/${id}`).json({ id, statut: 'en_attente', suivi: `/rapports/${id}` });
  } catch (e) { next(e); }
});

routeurRapports.get('/rapports/:id', async (req, res, next) => {
  try {
    const id = req.params.id;
    const etat = identifiantValide(id) ? await redis.hgetall(cle(id)) : {};
    if (!etat.statut) return res.status(404).json({ erreur: 'rapport inconnu' });

    const corps = { id, ...etat, progression: Number(etat.progression) };
    if (etat.duree_s) corps.duree_s = Number(etat.duree_s);
    if (etat.statut === 'termine') corps.pdf = `/rapports/${id}/pdf`;
    res.json(corps);
  } catch (e) { next(e); }
});

routeurRapports.get('/rapports/:id/pdf', async (req, res, next) => {
  try {
    const id = req.params.id;
    const statut = identifiantValide(id) ? await redis.hget(cle(id), 'statut') : null;
    if (!statut) return res.status(404).json({ erreur: 'rapport inconnu' });

    const fichier = join(DOSSIER, `${id}.pdf`);
    if (statut !== 'termine' || !existsSync(fichier)) {
      return res.status(409).json({ erreur: `le rapport n'est pas pret (statut : ${statut})` });
    }
    res.download(fichier, `rapport-frequentation-${id.slice(0, 8)}.pdf`);
  } catch (e) { next(e); }
});
