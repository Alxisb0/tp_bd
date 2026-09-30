import { Schema, model } from 'mongoose';

const schemaFormule = new Schema({
  _id: Number,
  code: { type: String, required: true },
  libelle: { type: String, required: true },
  prix_mensuel_centimes: { type: Number, required: true },
  engagement_mois: { type: Number, required: true },
  cours_collectifs: { type: Boolean, required: true },
  tous_les_clubs: { type: Boolean, required: true },
}, { versionKey: false });

export const Formule = model('Formule', schemaFormule, 'formules');
