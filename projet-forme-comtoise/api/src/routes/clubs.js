import { Router } from 'express';
import { Club } from '../models/Club.js';
import { Seance } from '../models/Seance.js';
import { Adherent } from '../models/Adherent.js';

export const routeurClubs = Router();

routeurClubs.get('/clubs', async (req, res, next) => {
  try {
    const clubs = await Club.find().sort({ nom: 1 }).lean();
    res.json({ clubs });
  } catch (e) { next(e); }
});

// Planning d'un club pour une semaine, avec les places restantes de chaque
// cours. "debut" est le lundi de la semaine, au format AAAA-MM-JJ.
routeurClubs.get('/clubs/:id/planning', async (req, res, next) => {
  try {
    const clubId = Number(req.params.id);
    const debut = req.query.debut;
    if (!debut || !/^\d{4}-\d{2}-\d{2}$/.test(debut)) {
      return res.status(400).json({ erreur: 'parametre debut attendu au format AAAA-MM-JJ' });
    }
    const debutSemaine = new Date(`${debut}T00:00:00Z`);
    const finSemaine = new Date(debutSemaine.getTime() + 7 * 24 * 60 * 60 * 1000);

    const seances = await Seance.aggregate([
      { $match: {
        club_id: clubId,
        annulee: false,
        debut: { $gte: debutSemaine, $lt: finSemaine },
      } },
      { $lookup: {
        from: 'coachs',
        localField: 'coach_id',
        foreignField: '_id',
        as: 'coach',
      } },
      { $unwind: '$coach' },
      { $project: {
        _id: 1,
        debut: 1,
        salle: 1,
        places: 1,
        activite: 1,
        coach: { prenom: '$coach.prenom', nom: '$coach.nom' },
        // une place compte comme prise sauf si la reservation a ete annulee
        places_restantes: {
          $subtract: [
            '$places',
            { $size: { $filter: {
              input: '$reservations',
              as: 'r',
              cond: { $ne: ['$$r.statut', 'annulee'] },
            } } },
          ],
        },
      } },
      { $sort: { debut: 1 } },
    ]);

    res.json({ club_id: clubId, debut: debutSemaine, fin: finSemaine, seances });
  } catch (e) { next(e); }
});

// Chiffre d'affaires d'un mois donne : chaque contrat encore en cours le 1er
// du mois (fin vide, deja commence) compte pour un mois plein, a son prix signe.
routeurClubs.get('/clubs/:id/chiffre-affaires', async (req, res, next) => {
  try {
    const clubId = Number(req.params.id);
    const mois = req.query.mois;
    if (!mois || !/^\d{4}-\d{2}$/.test(mois)) {
      return res.status(400).json({ erreur: 'parametre mois attendu au format AAAA-MM' });
    }
    const premierDuMois = new Date(`${mois}-01T00:00:00Z`);

    const resultat = await Adherent.aggregate([
      { $match: { club_id: clubId } },
      { $unwind: '$abonnements' },
      { $match: {
        'abonnements.fin': null,
        'abonnements.debut': { $lte: premierDuMois },
      } },
      { $group: {
        _id: null,
        contrats_en_cours: { $sum: 1 },
        chiffre_affaires_centimes: { $sum: '$abonnements.prix_mensuel_centimes' },
      } },
    ]);

    const { contrats_en_cours = 0, chiffre_affaires_centimes = 0 } = resultat[0] ?? {};
    res.json({ club_id: clubId, mois, contrats_en_cours, chiffre_affaires_centimes });
  } catch (e) { next(e); }
});
