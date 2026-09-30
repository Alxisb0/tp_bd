import { creerApp } from './app.js';
import { connecterMongo } from './mongo.js';

const PORT = Number(process.env.PORT || 3000);

await connecterMongo();

creerApp().listen(PORT, () => {
  console.log(`[api] http://127.0.0.1:${PORT}`);
});
