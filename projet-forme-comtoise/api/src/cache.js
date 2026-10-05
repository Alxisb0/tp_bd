// Cache Redis. Se desactive avec CACHE_ACTIF=0, sans toucher au code.
// Si Redis ne repond pas, on calcule la reponse comme sans cache.
import { redis as connexion } from './redis.js';

const ACTIF = process.env.CACHE_ACTIF !== '0';
const redis = ACTIF ? connexion : null;

async function lire(cle) {
  if (!redis) return null;
  try {
    const texte = await redis.get(cle);
    return texte ? JSON.parse(texte) : null;
  } catch { return null; }
}

async function ecrire(cle, valeur, secondes) {
  if (!redis) return;
  try {
    await redis.set(cle, JSON.stringify(valeur), 'EX', secondes);
  } catch { /* tant pis, la prochaine requete recalculera */ }
}

// Renvoie la valeur en cache, sinon la calcule, la garde et la renvoie.
// L'en-tete X-Cache dit si la reponse vient du cache (HIT) ou non (MISS).
export async function avecCache(res, cle, secondes, calculer) {
  const trouve = await lire(cle);
  if (trouve !== null) {
    res.set('X-Cache', 'HIT');
    return trouve;
  }
  const valeur = await calculer();
  await ecrire(cle, valeur, secondes);
  if (redis) res.set('X-Cache', 'MISS');
  return valeur;
}

// Efface tous les plannings d'un club (toutes les semaines demandees).
export async function invaliderPlanning(clubId) {
  if (!redis) return;
  try {
    const cles = [];
    for await (const lot of redis.scanStream({ match: `planning:${clubId}:*` })) {
      cles.push(...lot);
    }
    if (cles.length) await redis.del(cles);
  } catch { /* la duree de vie de la cle finira par la supprimer */ }
}
