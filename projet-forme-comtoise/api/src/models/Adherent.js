import { Schema, model } from 'mongoose';

const schemaAbonnement = new Schema({
  formule_id: { type: Number, required: true },
  debut: { type: Date, required: true },
  fin: Date,
  prix_mensuel_centimes: { type: Number, required: true },
  statut: { type: String, enum: ['actif', 'suspendu', 'termine', 'resilie'], required: true },
}, { _id: false });

const schemaAdherent = new Schema({
  _id: Number,
  badge: { type: String, required: true },
  prenom: { type: String, required: true },
  nom: { type: String, required: true },
  email: { type: String, required: true },
  telephone: String,
  date_naissance: Date,
  club_id: { type: Number, required: true },
  inscrit_le: { type: Date, required: true },
  abonnements: [schemaAbonnement],
}, { versionKey: false });

export const Adherent = model('Adherent', schemaAdherent, 'adherents');
