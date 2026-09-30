import { Schema, model } from 'mongoose';

const schemaActivite = new Schema({
  nom: String,
  categorie: String,
  intensite: Number,
  duree_min: Number,
}, { _id: false });

const schemaReservation = new Schema({
  adherent_id: Number,
  reservee_le: Date,
  statut: { type: String, enum: ['confirmee', 'annulee', 'presente', 'absente'] },
}, { _id: false });

const schemaSeance = new Schema({
  _id: Number,
  club_id: { type: Number, required: true },
  coach_id: { type: Number, required: true },
  salle: { type: String, required: true },
  debut: { type: Date, required: true },
  places: { type: Number, required: true },
  annulee: { type: Boolean, default: false },
  activite: schemaActivite,
  reservations: [schemaReservation],
}, { versionKey: false });

export const Seance = model('Seance', schemaSeance, 'seances');
