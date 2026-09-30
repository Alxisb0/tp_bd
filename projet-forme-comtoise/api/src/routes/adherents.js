import { Router } from 'express';
import { Adherent } from '../models/Adherent.js';
import { Club } from '../models/Club.js';
import { Formule } from '../models/Formule.js';
import { Seance } from '../models/Seance.js';

export const routeurAdherents = Router();

routeurAdherents.get('/adherents/:id', async (req, res, next) => {
  try {
    const adherentId = Number(req.params.id);
    const adherent = await Adherent.findById(adherentId).lean();
    if (!adherent) return res.status(404).json({ erreur: 'adherent inconnu' });

    // la formule actuelle est l'abonnement actif, ou a defaut le dernier en date
    const abonnementActuel = adherent.abonnements.find((a) => a.statut === 'actif')
      ?? adherent.abonnements[adherent.abonnements.length - 1]
      ?? null;
    const formuleActuelle = abonnementActuel
      ? await Formule.findById(abonnementActuel.formule_id).lean()
      : null;

    // les 10 dernieres seances reservees par l'adherent : les reservations
    // sont dans les seances, pas dans l'adherent, donc on part de Seance
    const dernieresSeances = await Seance.aggregate([
      { $match: { 'reservations.adherent_id': adherentId } },
      { $unwind: '$reservations' },
      { $match: { 'reservations.adherent_id': adherentId } },
      { $sort: { debut: -1 } },
      { $limit: 10 },
      { $lookup: { from: 'clubs', localField: 'club_id', foreignField: '_id', as: 'club' } },
      { $unwind: '$club' },
      { $lookup: { from: 'coachs', localField: 'coach_id', foreignField: '_id', as: 'coach' } },
      { $unwind: '$coach' },
      { $project: {
        _id: 0,
        seance_id: '$_id',
        debut: 1,
        activite: '$activite.nom',
        club: '$club.nom',
        coach: { prenom: '$coach.prenom', nom: '$coach.nom' },
        statut_reservation: '$reservations.statut',
      } },
    ]);

    res.json({
      adherent: { ...adherent, abonnements: undefined },
      formule_actuelle: formuleActuelle,
      historique_abonnements: adherent.abonnements,
      dernieres_seances: dernieresSeances,
    });
  } catch (e) { next(e); }
});

routeurAdherents.post('/adherents', async (req, res, next) => {
  try {
    const { badge, prenom, nom, email, telephone, date_naissance, club_id, formule_id } = req.body ?? {};
    if (!badge || !prenom || !nom || !email || !club_id || !formule_id) {
      return res.status(400).json({ erreur: 'badge, prenom, nom, email, club_id et formule_id sont obligatoires' });
    }

    const club = await Club.findById(Number(club_id)).lean();
    if (!club) return res.status(404).json({ erreur: 'club inconnu' });
    const formule = await Formule.findById(Number(formule_id)).lean();
    if (!formule) return res.status(404).json({ erreur: 'formule inconnue' });

    // pas d'auto-increment mongo : on prend le plus grand id existant + 1
    const dernier = await Adherent.findOne().sort({ _id: -1 }).select('_id').lean();
    const nouvelId = (dernier?._id ?? 0) + 1;

    const nouvelAdherent = await Adherent.create({
      _id: nouvelId,
      badge,
      prenom,
      nom,
      email,
      telephone: telephone ?? null,
      date_naissance: date_naissance ? new Date(date_naissance) : null,
      club_id: Number(club_id),
      inscrit_le: new Date(),
      abonnements: [{
        formule_id: Number(formule_id),
        debut: new Date(),
        fin: null,
        // le prix est fige au moment de la souscription, meme si la formule
        // change de tarif plus tard
        prix_mensuel_centimes: formule.prix_mensuel_centimes,
        statut: 'actif',
      }],
    });

    res.status(201).json(nouvelAdherent);
  } catch (e) { next(e); }
});
