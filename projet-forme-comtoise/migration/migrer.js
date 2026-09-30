// Migration de la base SQLite (livree par le prestataire) vers MongoDB.
// Idempotente : chaque collection cible est videe puis reconstruite en entier,
// donc relancer le script ne cree jamais de doublons.
import { DatabaseSync } from 'node:sqlite';
import { MongoClient } from 'mongodb';

const SQLITE_PATH = process.env.SQLITE_PATH || '../data/forme-comtoise.sqlite';
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/forme-comtoise';

const db = new DatabaseSync(SQLITE_PATH, { readOnly: true });

// Les heures de seances et de reservations sont en heure de Paris (ete/hiver).
// On convertit en UTC en regardant de combien Paris est decale par rapport a
// UTC pour cette date precise, sans dependance externe.
function parisVersUtc(chaineLocale) {
  if (!chaineLocale) return null;
  const [datePart, timePart] = chaineLocale.split(' ');
  const [an, mois, jour] = datePart.split('-').map(Number);
  const [h, m, s] = timePart.split(':').map(Number);
  const essai = new Date(Date.UTC(an, mois - 1, jour, h, m, s || 0));

  const formate = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(essai);
  const [dP, tP] = formate.replace(',', '').split(' ');
  const [jP, moP, anP] = dP.split('/').map(Number);
  const [hP, mP, sP] = tP.split(':').map(Number);
  const commeParisEnUtc = Date.UTC(anP, moP - 1, jP, hP, mP, sP);

  const ecart = commeParisEnUtc - essai.getTime();
  return new Date(essai.getTime() - ecart);
}

function dateSimple(texte) {
  return texte ? new Date(`${texte}T00:00:00Z`) : null;
}

// "Yoga, Pilates ,stretching" -> ["yoga", "pilates", "stretching"]
function nettoyerSpecialites(texte) {
  if (!texte) return [];
  const morceaux = texte.split(/[,;]/).map((m) => m.trim().toLowerCase()).filter(Boolean);
  return [...new Set(morceaux)];
}

async function remplacerCollection(mongo, nom, documents) {
  await mongo.collection(nom).drop().catch((e) => {
    if (e.codeName !== 'NamespaceNotFound') throw e;
  });
  if (documents.length) await mongo.collection(nom).insertMany(documents);
  console.log(`${nom} : ${documents.length} documents`);
}

async function migrerClubs(mongo) {
  const documents = db.prepare('SELECT * FROM clubs').all().map((c) => ({
    _id: c.id,
    code: c.code,
    nom: c.nom,
    ville: c.ville,
    adresse: c.adresse,
    capacite: c.capacite,
    horaires: JSON.parse(c.horaires),
    ouvert_le: dateSimple(c.ouvert_le),
  }));
  await remplacerCollection(mongo, 'clubs', documents);
}

async function migrerFormules(mongo) {
  const documents = db.prepare('SELECT * FROM formules').all().map((f) => ({
    _id: f.id,
    code: f.code,
    libelle: f.libelle,
    prix_mensuel_centimes: f.prix_mensuel_centimes,
    engagement_mois: f.engagement_mois,
    cours_collectifs: f.cours_collectifs === 1,
    tous_les_clubs: f.tous_les_clubs === 1,
  }));
  await remplacerCollection(mongo, 'formules', documents);
}

async function migrerAdherents(mongo) {
  const requeteAbonnements = db.prepare('SELECT * FROM abonnements WHERE adherent_id = ? ORDER BY debut');
  const documents = db.prepare('SELECT * FROM adherents').all().map((a) => ({
    _id: a.id,
    badge: a.badge,
    prenom: a.prenom,
    nom: a.nom,
    email: a.email,
    telephone: a.telephone,
    date_naissance: dateSimple(a.date_naissance),
    club_id: a.club_id,
    inscrit_le: dateSimple(a.inscrit_le),
    abonnements: requeteAbonnements.all(a.id).map((ab) => ({
      formule_id: ab.formule_id,
      debut: dateSimple(ab.debut),
      fin: dateSimple(ab.fin),
      prix_mensuel_centimes: ab.prix_mensuel_centimes,
      statut: ab.statut,
    })),
  }));
  await remplacerCollection(mongo, 'adherents', documents);
}

async function migrerCoachs(mongo) {
  const documents = db.prepare('SELECT * FROM coachs').all().map((c) => ({
    _id: c.id,
    prenom: c.prenom,
    nom: c.nom,
    email: c.email,
    club_id: c.club_id,
    specialites: nettoyerSpecialites(c.specialites),
    embauche_le: dateSimple(c.embauche_le),
    actif: c.actif === 1,
  }));
  await remplacerCollection(mongo, 'coachs', documents);
}

async function migrerSeances(mongo) {
  const activites = new Map(db.prepare('SELECT * FROM activites').all().map((a) => [a.id, a]));
  const requeteReservations = db.prepare('SELECT * FROM reservations WHERE seance_id = ?');
  const documents = db.prepare('SELECT * FROM seances').all().map((s) => {
    const activite = activites.get(s.activite_id);
    return {
      _id: s.id,
      club_id: s.club_id,
      coach_id: s.coach_id,
      salle: s.salle,
      debut: parisVersUtc(s.debut),
      places: s.places,
      annulee: s.annulee === 1,
      activite: activite ? {
        nom: activite.nom,
        categorie: activite.categorie,
        intensite: activite.intensite,
        duree_min: activite.duree_min,
      } : null,
      reservations: requeteReservations.all(s.id).map((r) => ({
        adherent_id: r.adherent_id,
        reservee_le: parisVersUtc(r.reservee_le),
        statut: r.statut,
      })),
    };
  });
  await remplacerCollection(mongo, 'seances', documents);
}

async function main() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const mongo = client.db();

  await migrerClubs(mongo);
  await migrerFormules(mongo);
  await migrerAdherents(mongo);
  await migrerCoachs(mongo);
  await migrerSeances(mongo);

  await client.close();
  console.log('migration terminee');
}

main().catch((e) => {
  console.error('erreur pendant la migration :', e);
  process.exit(1);
});
