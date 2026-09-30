import { Router } from 'express';
import { Formule } from '../models/Formule.js';

export const routeurFormules = Router();

routeurFormules.get('/formules', async (req, res, next) => {
  try {
    const formules = await Formule.find().sort({ code: 1 }).lean();
    res.json({ formules });
  } catch (e) { next(e); }
});

// le nouveau prix ne vaut que pour les contrats signes a partir de maintenant :
// les abonnements deja en cours gardent le prix qu'ils ont fige a la souscription
routeurFormules.patch('/formules/:id', async (req, res, next) => {
  try {
    const formuleId = Number(req.params.id);
    const prix = Number(req.body?.prix_mensuel_centimes);
    if (!prix || prix <= 0) {
      return res.status(400).json({ erreur: 'prix_mensuel_centimes attendu (nombre positif, en centimes)' });
    }

    const formule = await Formule.findByIdAndUpdate(
      formuleId,
      { prix_mensuel_centimes: prix },
      { new: true }
    ).lean();
    if (!formule) return res.status(404).json({ erreur: 'formule inconnue' });
    res.json(formule);
  } catch (e) { next(e); }
});
