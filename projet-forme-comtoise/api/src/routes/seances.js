import { Router } from 'express';
import { Seance } from '../models/Seance.js';

export const routeurSeances = Router();

// coach malade, salle indisponible... la seance disparait du planning
// (la route planning ne renvoie que les seances avec annulee:false)
routeurSeances.patch('/seances/:id/annuler', async (req, res, next) => {
  try {
    const seanceId = Number(req.params.id);
    const seance = await Seance.findByIdAndUpdate(
      seanceId,
      { annulee: true },
      { new: true }
    ).select('_id club_id debut annulee').lean();
    if (!seance) return res.status(404).json({ erreur: 'seance inconnue' });
    res.json(seance);
  } catch (e) { next(e); }
});
