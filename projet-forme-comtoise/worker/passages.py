# Lecture de l'export des tourniquets, nettoyage et appariement entree/sortie.
import pandas as pd

TECHNICIEN = 'B000000'   # badge du prestataire, qui teste les tourniquets
SEUIL_DOUBLON = 60       # secondes : deux passages identiques plus proches = un seul


def lire_passages(chemin):
    return pd.read_csv(chemin, sep=';', parse_dates=['horodatage'])


# Retire le technicien et les doubles passages.
# Renvoie les passages propres, tries par club, badge et heure, et des compteurs.
def nettoyer(passages):
    compteurs = {'lignes_lues': len(passages)}

    sans_technicien = passages[passages.badge != TECHNICIEN]
    compteurs['technicien'] = len(passages) - len(sans_technicien)

    tries = sans_technicien.sort_values(['club', 'badge', 'horodatage']).reset_index(drop=True)
    # ecart avec le passage precedent du meme badge, dans le meme club et le meme sens
    ecart = tries.groupby(['club', 'badge', 'sens']).horodatage.diff().dt.total_seconds()
    doublon = ecart <= SEUIL_DOUBLON
    compteurs['doublons'] = int(doublon.sum())

    return tries[~doublon].reset_index(drop=True), compteurs


# Une visite = une entree suivie de sa sortie (meme badge, meme club, meme jour).
# Une entree qui n'est pas suivie d'une sortie reste une visite, sans heure de sortie.
# Une sortie qui ne suit pas une entree est ignoree.
def apparier(propres):
    p = propres.copy()
    p['jour'] = p.horodatage.dt.normalize()
    groupe = p.groupby(['club', 'badge', 'jour'])
    sens_suivant = groupe.sens.shift(-1)
    sens_precedent = groupe.sens.shift(1)
    heure_suivante = groupe.horodatage.shift(-1)

    est_entree = p.sens == 'E'
    avec_sortie = est_entree & (sens_suivant == 'S')
    sortie_orpheline = (p.sens == 'S') & (sens_precedent != 'E')

    entrees = p[est_entree]
    visites = pd.DataFrame({
        'club': entrees.club,
        'badge': entrees.badge,
        'entree': entrees.horodatage,
        'sortie': heure_suivante[est_entree].where(avec_sortie[est_entree]),
    }).reset_index(drop=True)
    visites['duree_min'] = (visites.sortie - visites.entree).dt.total_seconds() / 60

    compteurs = {
        'sorties_sans_entree': int(sortie_orpheline.sum()),
        'entrees_sans_sortie': int(visites.sortie.isna().sum()),
    }
    return visites, compteurs
