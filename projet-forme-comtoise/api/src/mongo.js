// Connexion MongoDB, via Mongoose.
import mongoose from 'mongoose';

const URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/forme-comtoise';

export async function connecterMongo() {
  await mongoose.connect(URI, { serverSelectionTimeoutMS: 5000 });
  return mongoose.connection;
}

export { mongoose };
