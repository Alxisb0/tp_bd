import { Schema, model } from 'mongoose';

// _id numerique : on garde l'id d'origine de la table SQLite clubs,
// pas un ObjectId genere par Mongo.
const schemaClub = new Schema({
  _id: Number,
  code: { type: String, required: true },
  nom: { type: String, required: true },
  ville: { type: String, required: true },
  adresse: { type: String, required: true },
  capacite: { type: Number, required: true },
  horaires: { type: Schema.Types.Mixed, required: true },
  ouvert_le: { type: Date, required: true },
}, { versionKey: false });

export const Club = model('Club', schemaClub, 'clubs');
