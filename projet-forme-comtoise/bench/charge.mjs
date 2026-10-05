// Test de charge : 20 clients simultanes, 20 requetes chacun (400 par campagne).
// Usage : node charge.mjs <url> <fichier.csv> ["etiquette"]
// Node 22, sans dependance.
import { writeFileSync } from 'node:fs';

const url = process.argv[2];
const fichier = process.argv[3];
const etiquette = process.argv[4] || '';
const CLIENTS = 20;
const REQUETES = 20;

if (!url || !fichier) {
  console.error('usage : node charge.mjs <url> <fichier.csv> ["etiquette"]');
  process.exit(1);
}

const mesures = [];

async function envoyer() {
  const debut = performance.now();
  let statut = 0; // 0 : pas de reponse
  try {
    const reponse = await fetch(url);
    await reponse.arrayBuffer(); // lire le corps : on mesure la reponse entiere
    statut = reponse.status;
  } catch {} // connexion refusee ou coupee
  return { ms: performance.now() - debut, statut };
}

async function client(numero) {
  for (let rang = 1; rang <= REQUETES; rang++) {
    const { ms, statut } = await envoyer();
    mesures.push({ client: numero, rang, ms, statut });
  }
}

// Echauffement : 20 requetes en parallele, non comptees. Elles ouvrent les
// connexions et, cache actif, remplissent Redis.
await Promise.all(Array.from({ length: 20 }, () => envoyer()));

const t0 = performance.now();
await Promise.all(Array.from({ length: CLIENTS }, (_, i) => client(i + 1)));
const duree = (performance.now() - t0) / 1000; // secondes

// indicateurs, sur les requetes reussies (200) seulement
const temps = mesures.filter((m) => m.statut === 200).map((m) => m.ms).sort((a, b) => a - b);
const n = temps.length;
const echecs = mesures.length - n;
const moyenne = temps.reduce((s, x) => s + x, 0) / n;
const ecartType = Math.sqrt(temps.reduce((s, x) => s + (x - moyenne) ** 2, 0) / (n - 1));
const p95 = temps[Math.ceil(0.95 * n) - 1]; // rang ceil(0,95 x n), le premier rang est 1
const debit = mesures.length / duree;

// mesures brutes
mesures.sort((a, b) => a.client - b.client || a.rang - b.rang);
const lignes = mesures.map((m) => `${m.client},${m.rang},${m.ms.toFixed(2)},${m.statut}`);
writeFileSync(fichier, ['client,rang,ms,statut', ...lignes].join('\n') + '\n');

console.log(url);
console.log(`  reussies ${n}, echecs ${echecs}, duree ${duree.toFixed(2)} s`);
console.log(`  moyenne ${moyenne.toFixed(1)} ms, ecart-type ${ecartType.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, debit ${debit.toFixed(1)} req/s`);
console.log(`| ${etiquette} | ${moyenne.toFixed(1)} ms | ${ecartType.toFixed(1)} ms | ${p95.toFixed(1)} ms | ${echecs} / ${mesures.length} | ${debit.toFixed(1)} req/s |`);
