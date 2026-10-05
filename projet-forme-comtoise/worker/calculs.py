# Les calculs du rapport. Chaque fonction repond a un point de la piece jointe 2.
import numpy as np
import pandas as pd

JOUR = pd.Timedelta(days=1)


def entre(dates, debut, fin):
    return (dates >= debut) & (dates < fin + JOUR)


def minutes_depuis(origine, dates):
    return ((dates - origine).dt.total_seconds() // 60).astype(int).to_numpy()


def duree_mediane_par_club(visites):
    return visites.groupby('club').duree_min.median()


# Nombre de personnes presentes a chaque minute, pour chaque club.
# Resultat : une matrice (jours, 1440) par club, le premier jour etant "origine".
# Une entree sans sortie compte comme presente pendant la duree mediane du club,
# sans depasser minuit.
def presence_par_minute(visites, origine, nb_jours, medianes):
    total = nb_jours * 1440
    presence = {}
    for club, v in visites.groupby('club'):
        entree = minutes_depuis(origine, v.entree)
        sortie_reelle = minutes_depuis(origine, v.sortie.fillna(v.entree))
        sortie = np.where(v.sortie.isna(), entree + int(round(medianes[club])), sortie_reelle)
        sortie = np.minimum(sortie, entree // 1440 * 1440 + 1439)
        arrivees = np.bincount(entree, minlength=total + 1)
        departs = np.bincount(sortie, minlength=total + 1)
        presence[club] = np.cumsum(arrivees - departs)[:total].reshape(nb_jours, 1440)
    return presence


# Le plus grand nombre de presents de chaque journee, pour chaque club.
def pics_par_jour(presence, origine):
    morceaux = []
    for club, matrice in presence.items():
        jours = origine + pd.to_timedelta(np.arange(len(matrice)), unit='D')
        morceaux.append(pd.DataFrame({'club': club, 'jour': jours, 'pic': matrice.max(axis=1)}))
    return pd.concat(morceaux, ignore_index=True)


# 1. Synthese par club sur une periode.
def synthese(visites, pics, debut, fin):
    v = visites[entre(visites.entree, debut, fin)]
    p = pics[entre(pics.jour, debut, fin)]
    lignes = {}
    for club, vc in v.groupby('club'):
        pc = p[p.club == club]
        meilleur = pc.loc[pc.pic.idxmax()]
        lignes[club] = {
            'visites': len(vc),
            'sans_sortie': int(vc.sortie.isna().sum()),
            'visiteurs': vc.badge.nunique(),
            'duree_mediane': vc.duree_min.median(),
            'pic': int(meilleur.pic),
            'jour_pic': meilleur.jour,
        }
    return pd.DataFrame.from_dict(lignes, orient='index')


# 2. Par club et par mois : visites, duree des visites, pic, et ecart avec le
# meme mois de la saison precedente.
def tableau_mensuel(visites, pics, debut, fin, capacites):
    v = visites.assign(mois=visites.entree.dt.to_period('M'))
    par_mois = v.groupby(['club', 'mois']).agg(visites=('badge', 'size'), duree=('duree_min', 'median'))
    p = pics.assign(mois=pics.jour.dt.to_period('M'))
    par_mois['pic'] = p.groupby(['club', 'mois']).pic.max()

    mois_voulus = pd.period_range(debut, fin, freq='M')
    mois_tous = pd.period_range(mois_voulus[0] - 12, mois_voulus[-1], freq='M')
    par_mois = par_mois.reindex(pd.MultiIndex.from_product([sorted(capacites), mois_tous]))

    risque = jours_a_risque(pics, debut, fin, capacites)
    risque_par_mois = risque.groupby(['club', risque.jour.dt.to_period('M')]).size()

    lignes = []
    for club in sorted(capacites):
        for mois in mois_voulus:
            a = par_mois.loc[(club, mois)]
            avant = par_mois.loc[(club, mois - 12)]
            lignes.append({
                'club': club, 'mois': mois,
                'visites': a.visites, 'visites_avant': avant.visites,
                'ecart_visites_pct': 100 * (a.visites / avant.visites - 1) if avant.visites > 0 else np.nan,
                'duree': a.duree, 'duree_avant': avant.duree,
                'pic': a['pic'], 'pic_avant': avant['pic'],
                'jours_a_risque': int(risque_par_mois.get((club, mois), 0)),
            })
    return pd.DataFrame(lignes)


# 2. Occupation moyenne par jour de la semaine (lundi = 0) et par heure, pour un mois.
def occupation_mois(matrice_club, origine, mois):
    premier = mois.to_timestamp()
    dernier = mois.to_timestamp(how='end').normalize()
    jours = matrice_club[(premier - origine).days:(dernier - origine).days + 1]
    par_heure = jours.reshape(len(jours), 24, 60).mean(axis=2)
    semaine = (premier + pd.to_timedelta(np.arange(len(jours)), unit='D')).dayofweek
    return np.array([par_heure[semaine == j].mean(axis=0) for j in range(7)])


# 3. Journees ou le pic atteint 90 % de la capacite (taux au-dessus de 1 : depassee).
def jours_a_risque(pics, debut, fin, capacites):
    p = pics[entre(pics.jour, debut, fin)].copy()
    p['capacite'] = p.club.map(capacites)
    p['taux'] = p.pic / p.capacite
    return p[p.taux >= 0.9].sort_values('taux', ascending=False)


# 4. Un meme badge qui entre dans un autre club moins de 40 minutes apres une entree.
def cartes_pretees(propres, debut, fin):
    entrees = propres[(propres.sens == 'E') & entre(propres.horodatage, debut, fin)]
    entrees = entrees.sort_values(['badge', 'horodatage'])
    precedent = entrees.groupby('badge')
    entrees = entrees.assign(club_avant=precedent.club.shift(), heure_avant=precedent.horodatage.shift())
    entrees['minutes'] = (entrees.horodatage - entrees.heure_avant).dt.total_seconds() / 60
    return entrees[(entrees.club != entrees.club_avant) & (entrees.minutes < 40)]


# Adherents dont un contrat court le jour donne (contrat commence, et pas encore fini).
def contrats_en_cours(contrats, jour):
    en_cours = contrats[(contrats.debut <= jour) & (contrats.fin.isna() | (contrats.fin >= jour))]
    return en_cours.drop_duplicates('adherent_id')


# 5. Contrat en cours le dernier jour de la periode et aucune visite dans les 30 derniers jours.
def inactifs(visites, contrats, fin):
    en_cours = contrats_en_cours(contrats, fin)
    recents = set(visites[entre(visites.entree, fin - 29 * JOUR, fin)].badge)
    derniere = visites[visites.entree < fin + JOUR].groupby('badge').entree.max()
    perdus = en_cours[~en_cours.badge.isin(recents)].copy()
    perdus['derniere_visite'] = perdus.badge.map(derniere)
    return perdus.sort_values(['club_id', 'nom', 'prenom'])
