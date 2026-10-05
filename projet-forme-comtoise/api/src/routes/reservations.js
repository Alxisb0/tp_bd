import { Router } from 'express';
import { Seance } from '../models/Seance.js';
import { Adherent } from '../models/Adherent.js';
import { Formule } from '../models/Formule.js';
import { invaliderPlanning } from '../cache.js';

export const routeurReservations = Router();

routeurReservations.post('/seances/:id/reservations', async (req, res, next) => {
  try {
    const seanceId = Number(req.params.id);
    const adherentId = Number(req.body?.adherent_id);
    if (!adherentId) return res.status(400).json({ erreur: 'adherent_id attendu' });

    const adherent = await Adherent.findById(adherentId).lean();
    if (!adherent) return res.status(404).json({ erreur: 'adherent inconnu' });

    const abonnementActif = adherent.abonnements.find((a) => a.statut === 'actif');
    if (!abonnementActif) return res.status(403).json({ erreur: 'aucun abonnement actif' });

    const formule = await Formule.findById(abonnementActif.formule_id).lean();
    if (!formule.cours_collectifs) {
      return res.status(403).json({ erreur: 'la formule ne donne pas acces aux cours collectifs' });
    }

    const seance = await Seance.findById(seanceId).lean();
    if (!seance) return res.status(404).json({ erreur: 'seance inconnue' });
    if (seance.annulee) return res.status(409).json({ erreur: 'seance annulee' });

    if (seance.club_id !== adherent.club_id && !formule.tous_les_clubs) {
      return res.status(403).json({ erreur: "formule limitee au club de l'adherent" });
    }

    // ecriture atomique : refuse si deja reserve ou plus de place, meme si
    // deux demandes arrivent exactement en meme temps sur la meme seance
    const resultat = await Seance.collection.findOneAndUpdate(
      {
        _id: seanceId,
        annulee: false,
        // une reservation annulee ne compte pas comme deja reserve : on ne bloque
        // que s'il existe une reservation active (confirmee, presente ou absente)
        reservations: { $not: { $elemMatch: { adherent_id: adherentId, statut: { $ne: 'annulee' } } } },
        $expr: {
          $lt: [
            { $size: { $filter: {
              input: '$reservations', as: 'r', cond: { $ne: ['$$r.statut', 'annulee'] },
            } } },
            '$places',
          ],
        },
      },
      { $push: { reservations: { adherent_id: adherentId, reservee_le: new Date(), statut: 'confirmee' } } },
      { returnDocument: 'after', includeResultMetadata: true }
    );

    if (!resultat.value) {
      const dejaReserve = seance.reservations.some((r) => r.adherent_id === adherentId && r.statut !== 'annulee');
      if (dejaReserve) return res.status(409).json({ erreur: 'deja reserve pour cette seance' });
      return res.status(409).json({ erreur: 'plus de place disponible' });
    }

    await invaliderPlanning(seance.club_id);
    res.status(201).json({ seance_id: seanceId, adherent_id: adherentId, statut: 'confirmee' });
  } catch (e) { next(e); }
});

routeurReservations.delete('/seances/:id/reservations/:adherentId', async (req, res, next) => {
  try {
    const seanceId = Number(req.params.id);
    const adherentId = Number(req.params.adherentId);

    // on recupere aussi le club de la seance, pour vider son planning en cache
    const resultat = await Seance.collection.findOneAndUpdate(
      { _id: seanceId, reservations: { $elemMatch: { adherent_id: adherentId, statut: 'confirmee' } } },
      { $set: { 'reservations.$.statut': 'annulee' } },
      { projection: { club_id: 1 }, includeResultMetadata: true }
    );

    if (!resultat.value) {
      return res.status(404).json({ erreur: 'reservation introuvable ou deja traitee' });
    }
    await invaliderPlanning(resultat.value.club_id);
    res.json({ seance_id: seanceId, adherent_id: adherentId, statut: 'annulee' });
  } catch (e) { next(e); }
});
