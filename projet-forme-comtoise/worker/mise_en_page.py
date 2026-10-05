# Mise en page du PDF avec reportlab. Les graphiques viennent de graphiques.py.
from datetime import datetime
import pandas as pd
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.lib.utils import ImageReader
from reportlab.platypus import Image, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

import calculs
import graphiques

STYLES = getSampleStyleSheet()
PETIT = ParagraphStyle('petit', parent=STYLES['BodyText'], fontSize=7, leading=8)
LARGEUR = 17 * cm


def nombre(n):
    return f'{int(n):,}'.replace(',', ' ')


def date(d):
    return d.strftime('%d/%m/%Y')


def p(texte, style='BodyText'):
    return Paragraph(texte, STYLES[style])


def image(tampon, largeur=LARGEUR):
    largeur_px, hauteur_px = ImageReader(tampon).getSize()
    tampon.seek(0)
    return Image(tampon, width=largeur, height=largeur * hauteur_px / largeur_px)


def tableau(entete, lignes, largeurs, taille=8, alignement='RIGHT'):
    t = Table([entete] + lignes, colWidths=[l * cm for l in largeurs], repeatRows=1)
    t.setStyle(TableStyle([
        ('FONTSIZE', (0, 0), (-1, -1), taille),
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#cde2fb')),
        ('LINEBELOW', (0, 0), (-1, -1), 0.25, colors.HexColor('#cccccc')),
        ('ALIGN', (1, 0), (-1, -1), alignement),
        ('TOPPADDING', (0, 0), (-1, -1), 2),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
    ]))
    return t


def ecart(valeur, signe='%'):
    if pd.isna(valeur):
        return '-'
    return f'{valeur:+.1f} {signe}'.replace('.', ',')


def minutes(valeur):
    return '-' if pd.isna(valeur) else f'{valeur:.0f} min'


def entier(valeur):
    return '-' if pd.isna(valeur) else nombre(valeur)


def page_titre(c):
    c_ = c['compteurs']
    return [
        p('Forme Comtoise : rapport de fréquentation', 'Title'),
        p(f"Période : du {date(c['debut'])} au {date(c['fin'])}, comparée à la même période un an plus tôt "
          f"(du {date(c['debut_avant'])} au {date(c['fin_avant'])}). "
          f"Rapport produit le {datetime.now():%d/%m/%Y à %H:%M}."),
        Spacer(1, 0.3 * cm),
        p('Règles de calcul', 'Heading2'),
        p("L'export des tourniquets est nettoyé avant tout calcul. Une visite est une entrée suivie de sa sortie, "
          "pour le même badge, dans le même club, le même jour."),
        tableau(['Traitement', 'Passages'], [
            ['Lignes lues dans l\'export', nombre(c_['lignes_lues'])],
            ['Badge de test B000000 (technicien), exclu', nombre(c_['technicien'])],
            ['Doubles passages retirés (même badge, club et sens, à moins de 60 secondes)', nombre(c_['doublons'])],
            ['Visites reconstituées (entrée suivie de sa sortie, ou entrée seule)', nombre(c_['visites'])],
            ['dont entrées sans sortie', nombre(c_['entrees_sans_sortie'])],
            ['Sorties sans entrée, ignorées', nombre(c_['sorties_sans_entree'])],
        ], [14, 3]),
        Spacer(1, 0.2 * cm),
        p("Une entrée sans sortie est comptée comme une visite (la personne est bien venue), mais sa durée est "
          "inconnue : elle n'entre pas dans les durées et la médiane. Pour la présence, on suppose qu'elle reste la "
          "durée médiane du club, sans dépasser minuit. Une sortie sans entrée n'est pas une visite : elle est ignorée."),
        p("La présence est calculée minute par minute. Le pic d'une journée est le plus grand nombre de personnes "
          "présentes en même temps ce jour-là."),
    ]


def section_synthese(c):
    lignes = []
    for code, club in c['clubs'].items():
        for nom, s in (('période', c['synth']), ('un an plus tôt', c['synth_avant'])):
            if code not in s.index:
                continue
            r = s.loc[code]
            lignes.append([f"{club['nom']} ({nom})", nombre(r.visites), nombre(r.visiteurs),
                           minutes(r.duree_mediane), nombre(r['pic']), date(r.jour_pic)])
    noms = [club['nom'] for club in c['clubs'].values()]
    graphique = graphiques.barres_visites(
        noms,
        [c['synth'].loc[k].visites if k in c['synth'].index else 0 for k in c['clubs']],
        [c['synth_avant'].loc[k].visites if k in c['synth_avant'].index else 0 for k in c['clubs']],
        f"{date(c['debut'])} au {date(c['fin'])}", f"{date(c['debut_avant'])} au {date(c['fin_avant'])}")
    return [
        PageBreak(),
        p('1. Synthèse par club', 'Heading1'),
        tableau(['Club', 'Visites', 'Visiteurs distincts', 'Durée médiane', 'Pic de présence', 'Jour du pic'],
                lignes, [5.2, 2.2, 2.6, 2.4, 2.4, 2.2]),
        Spacer(1, 0.4 * cm),
        image(graphique),
    ]


def lignes_mensuelles(mensuel_club):
    lignes = []
    for r in mensuel_club.itertuples():
        lignes.append([graphiques.libelle_mois(r.mois), entier(r.visites), entier(r.visites_avant),
                       ecart(r.ecart_visites_pct), minutes(r.duree), minutes(r.duree_avant),
                       entier(r.pic), entier(r.pic_avant), str(r.jours_a_risque)])
    return lignes


def section_club(c, code, rang, progres):
    club = c['clubs'][code]
    debut, fin = c['debut'], c['fin']
    progres(65 + 5 * rang, f"graphiques de {club['nom']}")

    cartes = [(m, calculs.occupation_mois(c['presence'][code], c['origine'], m))
              for m in pd.period_range(debut, fin, freq='M')]
    pics = c['pics'][c['pics'].club == code]
    pics = pics[calculs.entre(pics.jour, debut, fin)]
    mensuel = c['mensuel'][c['mensuel'].club == code]

    graphique = graphiques.pics_et_visites(
        club['nom'], pics.jour, pics.pic, club['capacite'], list(mensuel.mois),
        list(mensuel.visites), list(mensuel.visites_avant),
        f"{date(debut)} au {date(fin)}", f"{date(c['debut_avant'])} au {date(c['fin_avant'])}")

    return [
        PageBreak(),
        p(f"2. {club['nom']} (capacité {club['capacite']})", 'Heading1'),
        image(graphiques.grille_occupation(club['nom'], cartes), 15.5 * cm),
        PageBreak(),
        image(graphique, 15.5 * cm),
        Spacer(1, 0.3 * cm),
        tableau(['Mois', 'Visites', 'Un an plus tôt', 'Écart', 'Durée médiane', 'Un an plus tôt', 'Pic', 'Pic an passé',
                 'Jours à 90 %'], lignes_mensuelles(mensuel), [2.3, 1.7, 2.0, 1.7, 2.2, 2.0, 1.2, 2.0, 1.9], 7.5),
    ]


def section_risque(c):
    risque = c['risque']
    noms = {k: v['nom'] for k, v in c['clubs'].items()}
    resume = []
    for code, club in c['clubs'].items():
        r = risque[risque.club == code]
        resume.append([club['nom'], nombre(club['capacite']), nombre(len(r)), nombre((r.taux > 1).sum())])
    detail = [[noms[r.club], date(r.jour), nombre(r.pic), nombre(r.capacite), f'{100 * r.taux:.0f} %']
              for r in risque.itertuples()]
    elements = [
        PageBreak(),
        p('3. Journées à risque', 'Heading1'),
        p("Journées où le pic de présence atteint 90 % de la capacité du club ou plus. "
          "Au-dessus de 100 %, la capacité fixée par la commission de sécurité est dépassée."),
        Spacer(1, 0.2 * cm),
        tableau(['Club', 'Capacité', 'Jours à 90 % ou plus', 'dont au-dessus de 100 %'], resume, [6, 3, 4, 4]),
        Spacer(1, 0.4 * cm),
    ]
    if detail:
        elements.append(tableau(['Club', 'Jour', 'Pic', 'Capacité', 'Taux'], detail, [6, 3, 2, 2.5, 2.5]))
    return elements


def section_cartes(c):
    pretees = c['pretees']
    noms = {k: v['nom'] for k, v in c['clubs'].items()}
    adherents = c['contrats'].drop_duplicates('adherent_id').set_index('badge')
    lignes = []
    for badge, g in pretees.groupby('badge'):
        qui = f"{adherents.loc[badge].prenom} {adherents.loc[badge].nom}" if badge in adherents.index else '-'
        trajets = sorted({f"{noms[a]} puis {noms[b]}" for a, b in zip(g.club_avant, g.club)})
        lignes.append([badge, qui, str(len(g)), f"{g.minutes.median():.0f} min", date(g.horodatage.min()),
                       date(g.horodatage.max()), Paragraph(' ; '.join(trajets), PETIT)])
    lignes.sort(key=lambda l: -int(l[2]))
    return [
        PageBreak(),
        p('4. Cartes prêtées', 'Heading1'),
        p(f"Un même badge qui entre dans un second club moins de 40 minutes après être entré dans un premier : "
          f"{nombre(len(pretees))} cas, pour {nombre(pretees.badge.nunique())} badges."),
        Spacer(1, 0.2 * cm),
        tableau(['Badge', 'Adhérent', 'Cas', 'Délai médian', 'Premier', 'Dernier', 'Clubs'], lignes,
                [1.8, 3.2, 0.9, 1.8, 1.9, 1.9, 5.5], 7, 'LEFT'),
    ]


def deux_colonnes(lignes):
    moitie = (len(lignes) + 1) // 2
    gauche, droite = lignes[:moitie], lignes[moitie:]
    droite = droite + [['', '', '']] * (len(gauche) - len(droite))
    return [g + d for g, d in zip(gauche, droite)]


def section_inactifs(c):
    fin = c['fin']
    en_cours = calculs.contrats_en_cours(c['contrats'], fin)
    resume, listes = [], []
    for code, club in c['clubs'].items():
        total = (en_cours.club_id == club['id']).sum()
        perdus = c['inactifs'][c['inactifs'].club_id == club['id']]
        resume.append([club['nom'], nombre(total), nombre(len(perdus)), f"{100 * len(perdus) / total:.1f} %"])
        lignes = [[f"{r.nom} {r.prenom}", r.badge, date(r.derniere_visite) if pd.notna(r.derniere_visite) else 'aucune']
                  for r in perdus.itertuples()]
        listes += [PageBreak(), p(f"{club['nom']} : {len(perdus)} adhérents inactifs", 'Heading2'),
                   tableau(['Adhérent', 'Badge', 'Dernière visite'] * 2, deux_colonnes(lignes),
                           [3.6, 1.6, 2.2] * 2, 7, 'LEFT')]
    return [
        PageBreak(),
        p('5. Adhérents inactifs', 'Heading1'),
        p(f"Adhérents dont un contrat court le {date(fin)}, sans aucune visite du {date(fin - 29 * calculs.JOUR)} "
          f"au {date(fin)} (30 jours), tous clubs confondus. Un adhérent est rattaché à son club d'inscription. "
          f"Un contrat suspendu court toujours : ces adhérents sont comptés."),
        tableau(['Club', 'Contrats en cours', 'Inactifs', 'Part'], resume, [6, 3.5, 3, 3]),
    ] + listes


def numeroter(canvas, document):
    canvas.setFont('Helvetica', 8)
    canvas.drawRightString(A4[0] - 2 * cm, 1 * cm, f'Forme Comtoise - rapport de fréquentation - page {document.page}')


def construire_pdf(chemin, c, progres):
    elements = page_titre(c) + section_synthese(c)
    for rang, code in enumerate(c['clubs']):
        elements += section_club(c, code, rang, progres)
    progres(92, "mise en page du PDF")
    elements += section_risque(c) + section_cartes(c) + section_inactifs(c)
    document = SimpleDocTemplate(chemin, pagesize=A4, leftMargin=2 * cm, rightMargin=2 * cm,
                                 topMargin=1.8 * cm, bottomMargin=1.8 * cm, title='Rapport de fréquentation')
    document.build(elements, onFirstPage=numeroter, onLaterPages=numeroter)
