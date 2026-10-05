# Les graphiques du PDF, dessines avec matplotlib et rendus en images PNG.
import io
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.colors import LinearSegmentedColormap

BLEU = '#2a78d6'      # periode du rapport
ORANGE = '#eb6834'    # meme periode, un an plus tot
ROUGE = '#d03b3b'     # capacite
JAUNE = '#c98500'     # 90 % de la capacite
TEXTE = '#52514e'
GRILLE = '#e5e4e0'
DEGRADE = LinearSegmentedColormap.from_list('bleu', ['#cde2fb', '#86b6ef', '#2a78d6', '#184f95', '#0d366b'])

MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']
JOURS = ['L', 'M', 'M', 'J', 'V', 'S', 'D']

plt.rcParams.update({
    'font.size': 8, 'axes.edgecolor': GRILLE, 'axes.labelcolor': TEXTE,
    'xtick.color': TEXTE, 'ytick.color': TEXTE, 'text.color': TEXTE,
    'axes.spines.top': False, 'axes.spines.right': False,
})


def libelle_mois(mois):
    return f'{MOIS[mois.month - 1]} {mois.year}'


def en_png(fig):
    tampon = io.BytesIO()
    fig.savefig(tampon, format='png', dpi=150, bbox_inches='tight')
    plt.close(fig)
    tampon.seek(0)
    return tampon


def _legende(ax):
    ax.set_ylim(top=ax.get_ylim()[1] * 1.25)   # de la place au-dessus des barres pour la legende
    ax.legend(frameon=False, loc='upper left', ncol=2)


# Visites par club : la periode et l'annee precedente cote a cote.
def barres_visites(noms, visites, visites_avant, libelle, libelle_avant):
    fig, ax = plt.subplots(figsize=(7, 2.8))
    x = range(len(noms))
    ax.bar([i - 0.2 for i in x], visites_avant, width=0.38, color=ORANGE, label=libelle_avant)
    ax.bar([i + 0.2 for i in x], visites, width=0.38, color=BLEU, label=libelle)
    ax.set_xticks(list(x), noms)
    ax.set_ylabel('visites')
    ax.yaxis.grid(True, color=GRILLE)
    ax.set_axisbelow(True)
    _legende(ax)
    return en_png(fig)


# Occupation moyenne (personnes presentes) par jour de la semaine et par heure,
# un petit carre par mois, avec la meme echelle de couleur pour tous.
def grille_occupation(nom_club, cartes):
    vmax = max(c[1].max() for c in cartes)
    fig, axes = plt.subplots(3, 4, figsize=(7, 6.2), sharex=True, sharey=True)
    for ax, (mois, matrice) in zip(axes.flat, cartes):
        image = ax.imshow(matrice[:, 6:22], aspect='auto', cmap=DEGRADE, vmin=0, vmax=vmax)
        ax.set_title(libelle_mois(mois), fontsize=8)
        ax.set_xticks([0, 6, 12], ['6 h', '12 h', '18 h'])
        ax.set_yticks(range(7), JOURS)
    fig.suptitle(f'{nom_club} : personnes présentes en moyenne, par jour et par heure', fontsize=9)
    fig.colorbar(image, ax=axes, shrink=0.6, label='personnes présentes')
    return en_png(fig)


# En haut : le pic de chaque journee, avec la capacite et le seuil de 90 %.
# En bas : les visites de chaque mois, comparees a l'annee precedente.
def pics_et_visites(nom_club, jours, pics, capacite, mois, visites, visites_avant, libelle, libelle_avant):
    fig, (haut, bas) = plt.subplots(2, 1, figsize=(7, 5.4))
    haut.plot(jours, pics, color=BLEU, linewidth=1)
    haut.axhline(capacite, color=ROUGE, linestyle='--', linewidth=1)
    haut.axhline(0.9 * capacite, color=JAUNE, linestyle=':', linewidth=1)
    haut.text(jours.iloc[0], capacite + 1, f'capacité : {capacite}', color=ROUGE, fontsize=7, va='bottom')
    haut.text(jours.iloc[0], 0.9 * capacite - 1, '90 % de la capacité', color=JAUNE, fontsize=7, va='top')
    haut.set_ylim(0, max(pics.max(), capacite) * 1.15)
    haut.set_ylabel('pic de la journée')
    haut.set_title(f'{nom_club} : pic de présence de chaque journée', fontsize=9)
    haut.yaxis.grid(True, color=GRILLE)

    x = range(len(mois))
    bas.bar([i - 0.2 for i in x], visites_avant, width=0.38, color=ORANGE, label=libelle_avant)
    bas.bar([i + 0.2 for i in x], visites, width=0.38, color=BLEU, label=libelle)
    bas.set_xticks(list(x), [MOIS[m.month - 1] for m in mois])
    bas.set_ylabel('visites')
    bas.set_title('Visites par mois', fontsize=9)
    bas.yaxis.grid(True, color=GRILLE)
    bas.set_axisbelow(True)
    _legende(bas)
    fig.tight_layout(h_pad=2.5)
    return en_png(fig)
