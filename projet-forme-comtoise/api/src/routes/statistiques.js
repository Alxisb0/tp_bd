import { Router } from 'express';
import { Seance } from '../models/Seance.js';
import { avecCache } from '../cache.js';

export const routeurStatistiques = Router();

function periode(req, res) {
  const debut = req.query.debut;
  const fin = req.query.fin;
  if (!debut || !fin || !/^\d{4}-\d{2}-\d{2}$/.test(debut) || !/^\d{4}-\d{2}-\d{2}$/.test(fin)) {
    res.status(400).json({ erreur: 'parametres debut et fin attendus au format AAAA-MM-JJ' });
    return null;
  }
  return { debutDate: new Date(`${debut}T00:00:00Z`), finDate: new Date(`${fin}T00:00:00Z`) };
}

async function calculerActivites(bornes) {
  return Seance.aggregate([
    { $match: { annulee: false, debut: { $gte: bornes.debutDate, $lt: bornes.finDate } } },
    { $project: {
      activite: '$activite.nom',
      places: 1,
      reservees: { $size: { $filter: {
        input: '$reservations', as: 'r', cond: { $ne: ['$$r.statut', 'annulee'] },
      } } },
      presentes: { $size: { $filter: {
        input: '$reservations', as: 'r', cond: { $eq: ['$$r.statut', 'presente'] },
      } } },
      absentes: { $size: { $filter: {
        input: '$reservations', as: 'r', cond: { $eq: ['$$r.statut', 'absente'] },
      } } },
    } },
    { $group: {
      _id: '$activite',
      seances: { $sum: 1 },
      places_totales: { $sum: '$places' },
      reservees: { $sum: '$reservees' },
      presentes: { $sum: '$presentes' },
      absentes: { $sum: '$absentes' },
    } },
    { $project: {
      _id: 0,
      activite: '$_id',
      seances: 1,
      taux_remplissage_pct: { $round: [
        { $multiply: [{ $divide: ['$reservees', '$places_totales'] }, 100] }, 1,
      ] },
      taux_absence_pct: {
        $cond: [
          { $eq: [{ $add: ['$presentes', '$absentes'] }, 0] },
          null,
          { $round: [
            { $multiply: [{ $divide: ['$absentes', { $add: ['$presentes', '$absentes'] }] }, 100] }, 1,
          ] },
        ],
      },
    } },
    { $sort: { activite: 1 } },
  ]);
}

// Taux de remplissage et taux d'absence, par activite, sur une periode.
// Le remplissage est pondere par le nombre de places (pas une simple moyenne
// des pourcentages, pour ne pas sur-representer les petites seances).
// Le taux d'absence ne porte que sur les seances passees ou la presence a
// deja ete pointee (statut presente/absente) ; les seances a venir n'ont pas
// encore ce statut et sont ignorees pour ce calcul.
routeurStatistiques.get('/statistiques/activites', async (req, res, next) => {
  try {
    const bornes = periode(req, res);
    if (!bornes) return;

    // cache 5 min : la direction accepte un retard de quelques minutes
    const corps = await avecCache(res, `stats:activites:${req.query.debut}:${req.query.fin}`, 300, async () => {
      const activites = await calculerActivites(bornes);
      return { debut: bornes.debutDate, fin: bornes.finDate, activites };
    });
    res.json(corps);
  } catch (e) { next(e); }
});

async function calculerCoachs(bornes) {
  return Seance.aggregate([
    { $match: { annulee: false, debut: { $gte: bornes.debutDate, $lt: bornes.finDate } } },
    { $project: {
      coach_id: 1,
      places: 1,
      reservees: { $size: { $filter: {
        input: '$reservations', as: 'r', cond: { $ne: ['$$r.statut', 'annulee'] },
      } } },
    } },
    { $group: {
      _id: '$coach_id',
      seances: { $sum: 1 },
      places_totales: { $sum: '$places' },
      reservees: { $sum: '$reservees' },
    } },
    { $lookup: { from: 'coachs', localField: '_id', foreignField: '_id', as: 'coach' } },
    { $unwind: '$coach' },
    { $project: {
      _id: 0,
      coach_id: '$_id',
      coach: { prenom: '$coach.prenom', nom: '$coach.nom' },
      seances: 1,
      taux_remplissage_pct: { $round: [
        { $multiply: [{ $divide: ['$reservees', '$places_totales'] }, 100] }, 1,
      ] },
    } },
    { $sort: { taux_remplissage_pct: -1 } },
  ]);
}

// Classement des coachs sur une periode, par taux de remplissage de leurs
// seances (pondere par les places, comme pour les activites).
routeurStatistiques.get('/statistiques/coachs', async (req, res, next) => {
  try {
    const bornes = periode(req, res);
    if (!bornes) return;

    // cache 5 min : la direction accepte un retard de quelques minutes
    const corps = await avecCache(res, `stats:coachs:${req.query.debut}:${req.query.fin}`, 300, async () => {
      const classement = await calculerCoachs(bornes);
      return { debut: bornes.debutDate, fin: bornes.finDate, classement };
    });
    res.json(corps);
  } catch (e) { next(e); }
});
