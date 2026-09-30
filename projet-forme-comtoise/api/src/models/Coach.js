import { Schema, model } from 'mongoose';

const schemaCoach = new Schema({
  _id: Number,
  prenom: { type: String, required: true },
  nom: { type: String, required: true },
  email: { type: String, required: true },
  club_id: { type: Number, required: true },
  specialites: [String],
  embauche_le: { type: Date, required: true },
  actif: { type: Boolean, default: true },
}, { versionKey: false });

export const Coach = model('Coach', schemaCoach, 'coachs');
