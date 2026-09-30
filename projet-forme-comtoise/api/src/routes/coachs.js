import { Router } from 'express';
import { Coach } from '../models/Coach.js';

export const routeurCoachs = Router();

// un coach qui quitte n'est jamais supprime, on le passe juste inactif
routeurCoachs.patch('/coachs/:id', async (req, res, next) => {
  try {
    const coachId = Number(req.params.id);
    const { email, specialites, actif } = req.body ?? {};
    const modifs = {};
    if (email !== undefined) modifs.email = email;
    if (specialites !== undefined) modifs.specialites = specialites;
    if (actif !== undefined) modifs.actif = Boolean(actif);

    if (Object.keys(modifs).length === 0) {
      return res.status(400).json({ erreur: 'aucun champ a modifier (email, specialites, actif)' });
    }

    const coach = await Coach.findByIdAndUpdate(coachId, modifs, { new: true }).lean();
    if (!coach) return res.status(404).json({ erreur: 'coach inconnu' });
    res.json(coach);
  } catch (e) { next(e); }
});
