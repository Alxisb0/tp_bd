// Petit script de verification manuelle, pas partie de la migration elle-meme.
import { MongoClient } from 'mongodb';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/forme-comtoise';

const client = new MongoClient(MONGO_URI);
await client.connect();
const mongo = client.db();

console.log('--- adherents._id 1308 ---');
console.log(JSON.stringify(await mongo.collection('adherents').findOne({ _id: 1308 }), null, 2));

console.log('\n--- seances._id 1 ---');
console.log(JSON.stringify(await mongo.collection('seances').findOne({ _id: 1 }), null, 2));

await client.close();
