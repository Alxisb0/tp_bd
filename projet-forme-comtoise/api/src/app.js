import express from 'express';
import { routeurClubs } from './routes/clubs.js';
import { routeurFormules } from './routes/formules.js';
import { routeurReservations } from './routes/reservations.js';
import { routeurAdherents } from './routes/adherents.js';
import { routeurCoachs } from './routes/coachs.js';
import { routeurSeances } from './routes/seances.js';
import { routeurStatistiques } from './routes/statistiques.js';
import { routeurRapports } from './routes/rapports.js';

export function creerApp() {
  const app = express();
  app.use(express.json());

  app.get('/sante', (req, res) => res.json({ ok: true }));
  app.use(routeurClubs);
  app.use(routeurFormules);
  app.use(routeurReservations);
  app.use(routeurAdherents);
  app.use(routeurCoachs);
  app.use(routeurSeances);
  app.use(routeurStatistiques);
  app.use(routeurRapports);

  app.use((req, res) => res.status(404).json({ erreur: 'route inconnue' }));
  app.use((err, req, res, next) => {
    res.status(err.statut || 500).json({ erreur: err.message });
  });
  return app;
}
