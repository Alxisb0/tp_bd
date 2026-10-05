# Enchaine les etapes du rapport : lecture, nettoyage, calculs, PDF.
import os
import pandas as pd

import calculs
import donnees
import mise_en_page
import passages

CSV = os.environ.get('CSV_PATH', '/data/passages-2024-2026.csv')


def construire(debut, fin, chemin_pdf, progres):
    debut, fin = pd.Timestamp(debut), pd.Timestamp(fin)
    debut_avant = debut - pd.DateOffset(years=1)
    fin_avant = fin - pd.DateOffset(years=1)

    progres(5, 'lecture des passages')
    brut = passages.lire_passages(CSV)
    progres(15, 'nettoyage des passages')
    propres, compteurs = passages.nettoyer(brut)
    progres(25, 'reconstitution des visites')
    visites, appariement = passages.apparier(propres)
    compteurs.update(appariement)
    compteurs['visites'] = len(visites)
    if not calculs.entre(visites.entree, debut, fin).any():
        raise ValueError(f'aucun passage entre le {debut:%d/%m/%Y} et le {fin:%d/%m/%Y}')

    progres(35, 'lecture des clubs et des contrats')
    clubs = donnees.charger_clubs()
    contrats = donnees.charger_contrats()
    capacites = {code: club['capacite'] for code, club in clubs.items()}

    progres(45, 'calcul de la presence minute par minute')
    origine = visites.entree.min().normalize()
    nb_jours = (visites.entree.max().normalize() - origine).days + 1
    medianes = calculs.duree_mediane_par_club(visites)
    presence = calculs.presence_par_minute(visites, origine, nb_jours, medianes)
    pics = calculs.pics_par_jour(presence, origine)

    progres(55, 'synthese, journees a risque, cartes pretees, inactifs')
    contexte = {
        'debut': debut, 'fin': fin, 'debut_avant': debut_avant, 'fin_avant': fin_avant,
        'clubs': clubs, 'contrats': contrats, 'compteurs': compteurs,
        'origine': origine, 'presence': presence, 'pics': pics,
        'synth': calculs.synthese(visites, pics, debut, fin),
        'synth_avant': calculs.synthese(visites, pics, debut_avant, fin_avant),
        'mensuel': calculs.tableau_mensuel(visites, pics, debut, fin, capacites),
        'risque': calculs.jours_a_risque(pics, debut, fin, capacites),
        'pretees': calculs.cartes_pretees(propres, debut, fin),
        'inactifs': calculs.inactifs(visites, contrats, fin),
    }
    mise_en_page.construire_pdf(chemin_pdf, contexte, progres)
