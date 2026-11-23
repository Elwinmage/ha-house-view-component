<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../../custom_components/house_view/brand/dark_logo.png">
    <img src="../../custom_components/house_view/brand/logo.png" alt="House View" width="420">
  </picture>
</p>

# House View

[![GH-release](https://img.shields.io/github/v/release/Elwinmage/ha-house-view-component.svg?style=flat-square)](https://github.com/Elwinmage/ha-house-view-component/releases)
[![GH-last-commit](https://img.shields.io/github/last-commit/Elwinmage/ha-house-view-component.svg?style=flat-square)](https://github.com/Elwinmage/ha-house-view-component/commits/main)
[![HACS](https://img.shields.io/badge/HACS-Custom-41BDF5.svg?style=flat-square)](https://hacs.xyz)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![codecov](https://codecov.io/gh/Elwinmage/ha-house-view-component/branch/main/graph/badge.svg?flag=integration)](https://codecov.io/gh/Elwinmage/ha-house-view-component)
[![Active Installs](https://img.shields.io/badge/dynamic/json?label=Active%20Installs&query=estimated&cacheSeconds=3600&url=https%3A%2F%2Fraw.githubusercontent.com%2FElwinmage%2Fha-house-view-component%2Fmain%2Fbadges%2Fstats.json&color=CE1126&logo=home-assistant)](https://analytics.home-assistant.io/custom_integrations)

**Langues disponibles :**
[<img src="https://flagcdn.com/48x36/fr.png" width="24" height="18" alt="Français" />](README.fr.md)
[<img src="https://flagcdn.com/48x36/gb.png" width="24" height="18" alt="English" />](../../README.md)
[<img src="https://flagcdn.com/48x36/es.png" width="24" height="18" alt="Español" />](../es/README.es.md)
[<img src="https://flagcdn.com/48x36/de.png" width="24" height="18" alt="Deutsch" />](../de/README.de.md)
[<img src="https://flagcdn.com/48x36/pl.png" width="24" height="18" alt="Polski" />](../pl/README.pl.md)
[<img src="https://flagcdn.com/48x36/pt.png" width="24" height="18" alt="Português" />](../pt/README.pt.md)
[<img src="https://flagcdn.com/48x36/it.png" width="24" height="18" alt="Italiano" />](../it/README.it.md)
[<img src="https://flagcdn.com/48x36/nl.png" width="24" height="18" alt="Nederlands" />](../nl/README.nl.md)

📘 **Guide complet** (installation, configuration, utilisation, illustré) : [GUIDE.fr.md](GUIDE.fr.md)

Vue pseudo-3D en direct de votre maison pour Home Assistant : votre plan (**Sweet Home 3D**, IFC ou SVG) posé sur un modèle numérique de terrain, avec lumières, météo, soleil et saisons en temps réel, plus un aspirateur robot, l'arrosage du jardin et les clôtures. Un seul dépôt contient :

- `custom_components/house_view/` : l'**intégration** (stocke le plan, le terrain et vos corrections ; récupère le terrain ; API HTTP) ;
- `card/` : la **carte Lovelace** `house-view-card` (three.js), compilée dans `custom_components/house_view/frontend/`. L'intégration la sert elle-même (`/house_view/house-view-card.js`) et la charge sur tous les tableaux de bord : **aucune ressource Lovelace à déclarer**.

L'interface de la carte et les options de l'intégration existent en anglais, français, italien, allemand, espagnol, polonais, portugais et néerlandais (la carte suit la langue de votre profil Home Assistant). Les traductions sont bienvenues : les textes sont dans `custom_components/house_view/translations/` et `card/src/i18n.js`.

## Aperçu

<p align="center"><img src="../images/four-seasons.webp" alt="La maison de démonstration sur son terrain au fil des quatre saisons : capteurs, arrosage, piscine, arbres" width="440"> <img src="../images/sea.webp" alt="La même maison en bord de mer : vagues animées, marée, plage, bruit du ressac" width="440"></p>
<p align="center"><a href="https://youtu.be/MyXz5AVbtJI">▶ Voir la vidéo</a></p>

House View transforme le plan de votre maison en une image vivante de celle-ci. La plupart des cartes 3D pour Home Assistant chargent un modèle lourd du bâtiment (export GLB / OBJ) et y rattachent des entités, ou superposent des calques transparents sur une image. House View prend un autre chemin : une **scène procédurale légère**, dessinée en direct à partir de votre plan, qui montre aussi le jardin et le ciel, pas seulement les murs. À notre connaissance, rien d'autre ne réunit tout ceci :

- **Légère par construction** : aucun gros export 3D à charger ou à fusionner : murs, mobilier, arbres, eau et volumes de lumière sont générés à partir du plan et d'un petit catalogue, et le rendu s'arrête quand la carte n'est pas visible, avec un `fps_cap` pour les tablettes murales.
- **Votre maison, sur son vrai terrain** : le plan Sweet Home 3D (ou IFC, SVG) est posé sur un modèle numérique du terrain de la parcelle (LiDAR HD et cadastre de l'IGN en France — les clôtures peuvent être tracées d'après les parcelles —, LiDAR ouvert et OpenStreetMap ailleurs), avec le relief, les routes, les arbres voisins et vos clôtures.
- **Soleil, saisons et météo réels** : la lumière suit le soleil de votre latitude, les arbres et l'herbe changent avec les saisons, et pluie, neige, brouillard, orages et vent (la pluie penche du côté où souffle le vent) suivent votre entité météo ou vos propres capteurs. Un mode simulation joue n'importe quel jour, ou une année entière en quelques secondes.
- **Chaque pièce est vivante** : l'état, la couleur et la luminosité réels de vos lumières, les températures des pièces, un tap pour zoomer sur une pièce puis allumer ou éteindre ses lumières ; les lumières placées n'importe où deviennent de vraies sources de lumière.
- **Vos entités, là où elles sont** : capteurs, interrupteurs et listes placés sur le plan, un panneau général, un badge d'alarmes central (fumée, fuite d'eau, intrusion…), des zones cliquables (un lecteur multimédia sur un meuble, un aquarium reeftank montré en direct sur son bac, un lien vers un tableau de bord ou une carte).
- **Portes, fenêtres, volets et portails qui bougent** : liés à vos contacts et à vos volets, ils s'ouvrent et se ferment dans la vue ; un portail (battant ou coulissant, 1 ou 2 vantaux, barreaudé ou plein, droit ou arrondi) suit son volet roulant ou son contact.
- **Aspirateur robot** : nettoyage par pièces en un tap, un robot 3D qui circule sur le plan, des pièces teintées selon leur avancement, plusieurs robots, position Roborock prise en charge.
- **Un jardin qui travaille** : goutte-à-goutte et arroseurs animés par leurs vannes (taches d'humidité, jets), clôtures de toutes sortes (grillage, bois, mur, fer forgé, canisse, gabions et neuf haies : laurier-palme, thuya, Leyland…), zones fleuries dont vous choisissez le nombre et les couleurs des fleurs, piscines et bassins avec leurs poissons.
- **Une mer vivante** : pour une maison en bord de côte, une mer animée aux vagues pilotées par le vent, marée qui suit le calendrier (calée sur une pleine mer réelle de votre port), plages de sable, galets, corail ou roche et bruit du ressac (section *Mer* de l'éditeur).
- **Un catalogue qui grandit** : les arbres, avec jusqu'à quatre rendus par an et des variétés de couleur (pommiers à fruits rouges, jaunes ou verts, cerisier, saule, eucalyptus…), et les objets viennent du [catalogue house-catalog](https://github.com/Elwinmage/house-catalog), ouvert, mis à jour en arrière-plan, utilisable hors ligne et extensible avec l'[éditeur de catalogue](https://github.com/Elwinmage/catalog-editor).
- **La montrer sans montrer sa maison** : un bouton *Charger la démo* ajoute une maison fictive en un lieu quelconque, pour filmer, présenter ou essayer la carte (masqué par défaut : à activer dans les options de l'intégration).
- **Rien à installer que l'intégration** : la carte est servie par l'intégration (aucune ressource Lovelace), tout se modifie depuis la carte elle-même (✎), plusieurs maisons peuvent coexister, vos corrections sont gardées à part du plan : le réimporter ne fait rien perdre ; l'interface parle huit langues (anglais, français, espagnol, allemand, italien, polonais, portugais, néerlandais).

## Installation

1. Installer avec HACS (dépôt personnalisé, type *Intégration*), ou copier `custom_components/house_view/` dans `config/custom_components/`, puis redémarrer Home Assistant.
2. Ajouter l'intégration *House View* : donner un nom au logement et sa position (celle de Home Assistant par défaut). Chaque logement est une entrée à part : ajouter l'intégration une seconde fois pour un autre logement (maison de vacances…), avec son propre plan, son terrain et ses éditions ; la carte affiche un logement, choisi par son option `home`.
3. Ajouter la carte à un tableau de bord (`type: custom:house-view-card`).
4. Ouvrir ⚙ dans la carte (administrateurs uniquement) pour importer votre plan (Sweet Home 3D, IFC ou SVG) ou en dessiner un simple, puis récupérer le terrain (cartes.gouv.fr en France, données ouvertes mondiales ailleurs : voir [Sources du terrain par pays](#sources-du-terrain-par-pays)) ou charger un terrain `.json`.

La version de la carte s'affiche dans la console du navigateur au chargement (`🏠 HOUSE VIEW v0.x.y`). Le nettoyage par pièces et l'icône de l'intégration demandent Home Assistant 2026.3 ou plus récent.

La carte compilée n'est pas versionnée : `release.yml` la construit à chaque release et publie `house_view.zip`, que HACS installe. En développement : `cd card && npm install && npm run build`.

## Configuration de la carte

Les options se règlent dans l'éditeur visuel de la carte (modifier le tableau de bord, puis *Modifier* sur la carte), en quatre sections : heure et météo, affichage, lumières, aspirateur robot. Le plan, le terrain et tout ce qui est placé dans la vue se règlent dans la carte elle-même (✎ et ⚙). En YAML :

```yaml
type: custom:house-view-card
home: 01JXYZ…                         # optionnel, plusieurs logements : l'entrée affichée (choisie dans l'éditeur visuel) ; la première par défaut
weather_entity: weather.maison        # météo en direct (optionnel)
rain_entity: binary_sensor.pluie      # optionnel : détecteur de pluie ou capteur d'intensité (mm/h) de votre station
wind_speed_entity: sensor.vent_vitesse  # optionnel : capteur de vitesse du vent (station météo ou service météo internet)
wind_bearing_entity: sensor.vent_dir   # optionnel : capteur de direction du vent (degrés ou points cardinaux)
mode: live                            # live (heure réelle) | simulation (curseurs heure / date / météo)
view: Vue générale                    # vue de départ (optionnel) : le nom affiché sur son bouton
show_views: true                      # boutons des vues caméra
show_levels: true                     # boutons toit / niveaux (+ 🌡 si des températures par pièce sont connues)
tap_action: zoom                      # clic sur une pièce : zoom (2e clic = lumières) | toggle_lights | none
show_entities: true                   # entités placées dans l'éditeur
show_alarms: true                     # pastille centrale des alarmes (en haut à droite)
vacuum_entity: vacuum.robot           # optionnel : par défaut le premier vacuum.* trouvé
vacuum_poll: 15                       # secondes entre deux lectures de position (Roborock : action cloud, min 5)
vacuum_show_floor: false              # true = pendant un nettoyage, montre l'étage du robot vu de dessus
vacuum_rate: 1                        # m²/min, pour le trajet estimé d'un robot sans position
vacuum_progress_entity: sensor.xxx    # optionnel : avancement (%) ; détecté seul pour Roborock
movable_camera: true                  # caméra mobile (rotation, zoom, déplacement) ; false = figée sur les vues
height: fill                          # fill (hauteur de l'écran sous le haut de la carte) | aspect (16/10) | 600 | "70vh"
min_height: 320                       # hauteur minimale en mode fill (px)
fps_cap: 30                           # limite d'images par seconde (écrans muraux, tablettes)
year_seconds: 10                      # 📅 : fait défiler les saisons d'une année entière en ce nombre de secondes (5 à 60)
toolbar_buttons: [preview]            # outils gardés dans la barre (preview, year, camera, sim, edit, setup) ; les autres sont dans le menu ⋮
hide_menu: false                      # true : pas de menu ⋮ pour les utilisateurs non administrateurs (écran mural)
light_entities: [light.salon, ...]    # optionnel : restreint les lumières prises en compte
```

## Vue en direct

- **Barre** (en haut à droite) : le badge d'alarme, les robots aspirateurs et le menu ⋮, qui regroupe les outils occasionnels (aperçu saison / météo / heure, simuler une année, verrou de la caméra, simulation, démo) et, pour les administrateurs, l'éditeur ✎ et la configuration ⚙. L'option `toolbar_buttons` en garde certains dans la barre ; `hide_menu` masque le menu aux utilisateurs non administrateurs.
- **Latitude, longitude, fuseau horaire** : ceux du logement (choisis à son ajout ; la configuration de Home Assistant par défaut). Les saisons de la végétation et de l'herbe suivent le climat de la latitude : quatre saisons en zone tempérée ; à partir de 50° vers les pôles, un hiver de plus en plus long et un été court (encore l'hiver fin avril à 68°) ; entre les tropiques, pas d'hiver mais une saison des pluies et une saison sèche (les arbres gardent leurs feuilles, l'herbe jaunit un peu en saison sèche, moins près de l'équateur), que l'aperçu des saisons propose à la place des quatre saisons. Tout s'inverse dans l'hémisphère sud.
- **Pièces ↔ areas** : une pièce du plan est liée à l'area Home Assistant de même nom (accents et casse ignorés). ⚙ liste les pièces sans area correspondante ; ✎ → *Pièces ↔ areas Home Assistant* permet de choisir une autre area, ou aucune, pièce par pièce.
- **Lumières** : état, couleur et intensité des `light.*` de l'area de chaque pièce.
- **Météo** : l'entité météo `weather_entity` décide du temps affiché : pluie (`rainy`, `pouring`, `hail`), neige (`snowy`, `snowy-rainy`), orage (`lightning`, `lightning-rainy`), brouillard, nuages ; sa température, son vent et sa nébulosité sont repris s'ils sont fournis. Avec `rain_entity` (détecteur de pluie `binary_sensor`, ou capteur d'intensité en mm/h), la pluie suit ce qui tombe réellement chez vous : il pleut sur le capteur → pluie, plus ou moins dense selon l'intensité mesurée ; le service météo annonce de la pluie mais le capteur est sec → ciel couvert sans pluie (orage : éclairs sans pluie). La neige et l'orage restent décidés par le service météo, un pluviomètre ne les distinguant pas ; un cumul (« pluie du jour » en mm) est ignoré, car il ne dit pas s'il pleut maintenant.
- **Vent et intensité de la pluie** : la pluie et la neige tombent penchées quand le vent souffle, dans le sens où il souffle : plus le vent est fort, plus elles penchent (calme → verticale, 60 km/h et plus → environ 50°). La direction suit le nord du plan : un vent d'ouest pousse donc la pluie vers le côté est de votre maison. Vitesse et direction viennent de l'entité météo (`wind_speed`, `wind_bearing`), ou de vos propres capteurs avec `wind_speed_entity` (km/h, m/s, mph, kn, ft/s, Beaufort) et `wind_bearing_entity` (degrés, ou points cardinaux comme `NO`) : une station météo, ou les capteurs d'un service météo internet. La quantité de pluie règle l'aspect de la pluie : une bruine est clairsemée, lente et courte, une averse dense, rapide et longue. Elle vient de l'intensité de `rain_entity` (mm/h ; 8 mm/h et plus = averse), sinon de l'entité météo (`pouring` est plus fort que `rainy`). Un capteur indisponible laisse la main à l'entité météo.
- **Zoom sur une pièce** : un clic zoome sur la pièce (toit et étages supérieurs masqués) ; un deuxième clic sur la même pièce bascule ses lumières ; *← pièce* revient à la vue précédente.
- **Aperçu** (bouton météo) : force une saison (printemps, été, automne, hiver), une météo (dégagé, nuageux, pluie, orage, neige, brouillard) ou un moment (matin, midi, crépuscule, nuit), combinables ; retour au direct par le bouton *Aperçu … ✕*, ou automatiquement après 3 minutes. En mode simulation, ce sont des raccourcis vers les curseurs.
- **Caméra** : le bouton en haut à droite débloque ou bloque la caméra sans toucher à la configuration.
- **Températures** : capteur de température de l'area (réglage de l'area dans Home Assistant), sinon premier `sensor.*` de `device_class: temperature` de l'area ; affichées au survol et en calque (🌡).
- **Mode simulation** : ☀ ouvre heure (avec défilement), date, préréglage météo, nuages, précipitations, vent (force et direction), température et neige.
- **Routes** : dessinées en enrobé sur le relief (désactivables dans ⚙).
- **Performances** : le rendu s'arrête quand la carte n'est pas visible ; les volumes de lumière ne sont recalculés que si un état utile change.

## Aspirateur robot

- **Nettoyage par pièces** : si une entité `vacuum.*` existe, son icône apparaît en haut à droite. Un clic ouvre la sélection des pièces (l'étage du robot s'affiche vu de dessus) : chaque pièce touchée, si elle est liée à une area, est surlignée, puis *Nettoyer* appelle `vacuum.clean_area` avec les areas choisies (action générique de Home Assistant 2026.3+ ; la correspondance entre les pièces du robot et les areas se fait une fois dans les réglages de l'entité aspirateur). *Démarrer*, *Pause* et *Base* aussi.
- **Suivi du nettoyage** (✎ → *Aspirateur robot*) : un robot 3D (couleur au choix, blanc par défaut) se déplace sur le plan, la pièce en cours est teintée (couleur au choix) avec son pourcentage, les pièces à venir sont teintées plus clair, une pièce terminée scintille une minute, et une jauge circulaire autour de l'icône du robot donne l'avancement total. En anomalie (`error`), la pièce et le robot clignotent en rouge avec un panneau ⚠.
- **Base** : *Placer la base*, puis clic sur le sol ; c'est le point de calage entre la carte du robot et le plan. Son **orientation** se règle en degrés (0° = face vers le haut du plan, 90° vers la droite, valeur par défaut), par quarts de tour (⟲ / ⟳) ou avec *Orienter d'un clic* : on clique devant la base, là où le robot en sort. Le robot au repos se gare devant la base, dans le même sens.
- **Position du robot** : *Roborock* (action officielle `roborock.get_vacuum_current_position`, base en 25500 / 25500 ; elle passe par le cloud, d'où une lecture toutes les `vacuum_poll` secondes, ralentie après une erreur), *attributs d'une entité* (`vacuum_position {x, y}` et `charger`, comme en fournissent les extracteurs de carte), ou *aucune* : le robot suit alors un trajet estimé (allers-retours, pièce par pièce), signalé « position estimée ».
- **Calage** : rotation, miroir et échelle ; *Caler d'un clic* calcule la rotation quand on clique la position réelle du robot sorti de sa base ; *mémoriser* enregistre les coordonnées de la base pour les autres marques.
- **Alignement sur la carte du robot** : *Afficher la carte du robot sur le plan* pose l'image que le robot dessine du sol (une entité `image.*` ou `camera.*` de son appareil) sur le sol de la base, à demi transparente, les étages du dessus étant masqués. La base est le point fixe : on tourne l'image avec le curseur de rotation jusqu'à ce que ses murs suivent ceux du plan ; la rotation trouvée est celle appliquée au robot. Si l'entité fournit des `calibration_points` (extracteurs de carte, *Roborock Custom Map*), l'image se place seule. Sinon (entités image de l'intégration Roborock officielle), on clique l'endroit où l'image dessine la base (*La base est ici sur la carte*), on la décale par pas de 5 cm, et on règle la taille d'un pixel si les pièces sont trop grandes ou trop petites (12,5 mm par défaut pour Roborock, 50 mm sinon).
- **Pourcentage d'une pièce** : part du sol parcourue par le robot (estimation : 80 % du sol est supposé accessible) ; l'avancement total vient du capteur du robot quand il existe (Roborock : `cleaning_progress`).
- *Tester l'animation* joue un nettoyage accéléré (avec ou sans anomalie) sans lancer le robot.
- **Plusieurs robots** : chaque `vacuum.*` a son bouton dans la barre d'outils, sa sélection de pièces, son robot 3D, son tracé et ses couleurs de pièces. Dans ✎ → *Robot aspirateur*, la liste *Robot* choisit celui qu'on règle (base, position, calibrage, carte sont propres à chaque robot) ; *Afficher ce robot* le retire de la vue et de la barre (un robot d'un autre logement, par exemple).

## Catalogue : arbres et objets

Les arbres et les meubles ne sont pas codés dans la carte : ils viennent du [catalogue de la maison](https://github.com/Elwinmage/house-catalog), où ajouter une espèce ou un objet est une pull request, pas une nouvelle version de cette intégration.

- **Arbres** : chaque espèce a jusqu'à quatre rendus, un par saison : couleur et densité du feuillage, floraison, fruits, feuilles au sol. La vue passe d'une saison à la suivante jour après jour (chêne, pin, if, cerisier et abricotier pour commencer, puis cerisier du Japon, sureau noir, pommier, poirier, eucalyptus et saule pleureur, puis palmiers dattier, des Canaries et cocotier, sapin pectiné et épicéa commun). Une espèce peut avoir des **variétés** de couleur (pommes rouges, jaunes ou vertes), proposées sous la forme `Pommier - Gala (rouge)` dans la liste de plantation. Ce sont les espèces proposées quand vous plantez un arbre dans l'éditeur, dans les hauteurs que donne le catalogue.
- **Objets** : un meuble du plan dont le nom contient un mot-clé d'un objet du catalogue (`Chaise`, `Chair`, `Stuhl`…) est dessiné avec lui, à la place et à la taille du meuble, au lieu d'une simple boîte ; quand le plan donne une couleur au meuble, l'objet la prend sur ses parties teintables. De même, une plante du plan nommée comme un arbre du catalogue (`Cerisier`, `Yew`) est dessinée comme cet arbre.
- **Poissons** : les poissons des étangs (la carpe koï pour commencer), chacun avec ses variétés de couleurs ; la carte les dessine elle-même, vus de dessus.
- **Mises à jour** : l'intégration télécharge le catalogue depuis GitHub en arrière-plan (la carte n'appelle jamais le réseau) et fonctionne hors ligne avec la copie qu'elle embarque. L'appareil *House view catalog* a une entité de mise à jour par section (arbres, objets), un interrupteur *Mise à jour automatique* (activé par défaut) et un bouton *Mettre à jour maintenant*.
- **Vos propres entrées** : avec l'[éditeur de catalogues](https://github.com/Elwinmage/catalog-editor), un arbre ou un objet que vous enregistrez est utilisé par la vue aussitôt, avant de le proposer au catalogue (ou sans le proposer).

## Éditeur (✎)

Réservé aux administrateurs. L'éditeur est un menu de sections : une section s'ouvre dans sa propre fenêtre par-dessus le menu, et un élément d'une liste (une ligne d'arrosage, une zone, une entité du panneau général, une porte…) ouvre sa fenêtre d'édition par-dessus la section ; la flèche ← d'une fenêtre revient à celle du dessous. Tout est sauvegardé dans le fichier d'éditions, séparé du plan et du terrain ; Échap annule le tracé en cours.

- **Entités placées** (capteurs, lumières, interrupteurs, select…) : posées d'un clic, puis déplacées en glissant leur étiquette (éditeur ouvert). Fixation au sol (par défaut : l'étiquette reste dans sa pièce quel que soit l'angle), au mur (côté pièce, cachée quand le mur est vu de dos) ou libre en hauteur ; une étiquette cachée par un étage supérieur ou le toit n'est pas affichée, sauf une étiquette *visible par-dessus le toit* ; quand *Entités placées* est ouvert dans l'éditeur, toutes les étiquettes s'affichent (estompées quand la maison les cache), pour placer et déplacer une entité n'importe où, pièces comprises. Pastille (icône + valeur) ou icône seule ; couleur, libellé, icône (sélecteur d'icônes de Home Assistant avec aperçu) ; visible dans la vue générale (toujours, ou sur la vue de son étage ; *Visible par-dessus le toit* permet de lire de loin la température d'une pièce) ; clic = fiche de l'entité, bascule ou rien. Dans l'éditeur, la liste est repliée : seule l'entité choisie est dépliée. Les entités se choisissent parmi celles de la pièce courante, groupées par appareil (toute la maison à une case près, avec une recherche) ; les icônes s'affichent pendant qu'on tape leur nom.
- **Panneau général** (à gauche, sous les boutons des niveaux) : capteurs et actionneurs de toute la maison (température extérieure, centrale d'alarme…), dans l'ordre choisi, avec leur libellé et leur icône ; un clic bascule ce qui peut l'être et ouvre la fiche des autres (ou au choix : basculer, fiche, rien).
- **Alarmes** : une pastille en haut à droite, verte avec une coche quand tout va bien, rouge avec une cloche et le nombre entre parenthèses quand des alarmes sont levées ; un clic ouvre leur liste (clic sur l'une = sa fiche). Détectées automatiquement : capteurs de problème, fumée, gaz, monoxyde de carbone, fuite d'eau, chaleur, froid et sabotage, et centrales d'alarme déclenchées (dont les alarmes reeftank) ; on peut ajouter des entités à la main, et ignorer une alarme depuis la liste elle-même (cloche barrée) ou depuis l'éditeur. Chaque pièce où des alarmes sont levées (pièce liée à une area Home Assistant) affiche aussi une cloche rouge avec leur nombre ; un clic ouvre la liste de cette pièce (*Toutes* revient à toute la maison) ; ces pastilles de pièce se désactivent dans l'éditeur. Option `show_alarms`.
- **Zones cliquables** : un lecteur multimédia sur un meuble du plan (cliqué dans l'éditeur) ou sur un rectangle posé sur un mur ou un sol ; un aquarium reeftank sur un rectangle aux dimensions du bac (sa face avant au mur, son dessus au sol). Un clic ouvre le lecteur, ou la vue de l'aquarium de ha-reef-card dans une fenêtre ; le rectangle d'un aquarium affiche cette vue en direct, poissons en mouvement (option par zone), dans la vue de l'aquarium choisie pour la zone (sa vue par défaut sinon). Pendant la pose, le mur ou le sol survolé s'éclaire et le rectangle s'y dessine ; une zone se déplace en la faisant glisser sur sa surface. Largeur, hauteur, hauteur du centre (mur) ou rotation (sol) se règlent. Un **lien** (*Ajouter un lien*) ouvre, dans le même type de fenêtre, un tableau de bord de Home Assistant (un chemin comme `/lovelace/cameras`, ou une adresse complète, affichée dans un cadre) ou n'importe quelle carte Lovelace (sa configuration en JSON, p. ex. `{"type": "picture-entity", "entity": "camera.garden"}`) ; sur un rectangle il apparaît comme une tuile avec son icône et son nom (icône et tuile facultatives).
- **Lumières placées** : une `light.*` placée devient une source lumineuse à cet endroit de la pièce (spot, suspension, lampe, réglette ou invisible ; hauteur et portée réglables ; au mur : une applique à la hauteur cliquée), pilotée par son propre état et sa couleur. Les autres lumières de l'area continuent d'éclairer la pièce entière.
- **Entités d'une pièce** : en zoom sur une pièce, seules les entités de cette pièce s'affichent ; celles de la vue générale disparaissent (le robot aspirateur bouge toujours s'il est là). Dans l'éditeur, un clic sur une pièce zoome dessus et l'édition devient celle de la pièce (bandeau rouge en haut) : les entités ajoutées alors se placent sur son sol, sur un mur ou en l'air, et n'appartiennent qu'à cette pièce. Elles disparaissent quand on choisit une autre pièce ou qu'on revient à la vue générale. Une entité de la vue générale posée dans une pièce passe dans cette pièce avec son réglage *Sa pièce seulement*.
- **Portes et fenêtres** (*Portes et fenêtres*) : les ouvertures du plan Sweet Home 3D, listées par niveau et par pièce, ou choisies d'un clic sur la vue (l'ouverture sous le pointeur s'allume). Chacune peut être liée à un capteur ouvert / fermé (`binary_sensor`), à un ouvrant motorisé (`cover` de la fenêtre) et, pour les fenêtres et baies vitrées, à un volet roulant (`cover`). Une pièce qui n'a qu'une fenêtre est liée toute seule au capteur de fenêtre, à l'ouvrant et au volet de sa zone quand il y en a un de chaque ; une pièce qui n'a qu'une porte, à son capteur de porte ; un lien choisi à la main l'emporte, et un lien automatique peut être retiré. Dans la vue, les battants (un, deux au-delà de 1,10 m) s'ouvrent vers l'intérieur, une baie coulisse, une porte pivote (une porte intérieure reçoit son vantail une fois liée), et le volet roulant descend sur la face extérieure jusqu'à la position du `cover` (`current_position`, en douceur).
- **Piscines et étangs** (*Piscines et étangs*) : dessinés vus de dessus, en rectangle (deux coins opposés) ou en forme libre (point par point, *Terminer*), avec un nom, une couleur d'eau et une profondeur (0,2 à 6 m). Le terrain est creusé : une piscine a des parois verticales, un fond plat et une margelle, un étang un fond en pente et une berge de galets ; le sol autour est mis à niveau et l'eau bouge. Un robot nettoyeur peut être lié à une entité (`binary_sensor`, `switch`, `input_boolean`, `vacuum`, `light`, `fan`, `sensor`, ou n'importe quelle autre entité tapée par son identifiant) : il parcourt le fond tant qu'elle est active, et reste garé sinon. Des **lampes** peuvent être encastrées dans la paroi d'un côté (position le long du côté, profondeur, une entité chacune) : une lumière de couleur donne la sienne, une prise la couleur choisie dans l'éditeur, et les lampes allumées teintent l'eau et le bassin, d'autant plus la nuit. Un **volet roulant** déroule ses lames sur l'eau depuis un côté, enrouleur sur la plage ou immergé, d'après une entité `cover` (sa position) ou n'importe quoi disant ouvert ou fermé ; un clic sur le tablier dans la vue l'ouvre ou le ferme. Volet ouvert, c'est l'enrouleur qui répond au clic. La piscine du plan importé reste telle quelle. Un étang peut avoir des **îles** (dessinées comme le contour : le sol reste un peu au-dessus de l'eau, avec une berge de galets ; on y plante des arbres, on y place des entités) et des **poissons** du catalogue de la maison : des groupes d'un poisson (la carpe koï pour commencer), d'une variété (kohaku rouge et blanc, benigoi rouge, yamabuki ogon jaune, showa…) ou de couleurs personnalisées (corps, taches, motif, écailles brillantes), avec un nombre et une taille : 3 rouges, 1 rouge et blanche et 2 jaunes font trois groupes. Chaque poisson a sa propre robe, se promène dans l'eau autour des îles, prend la couleur de l'eau quand il descend et reste au fond quand l'eau est froide.
- **Vue par pièce** : en zoom sur une pièce, éditeur ouvert, *📷 Vue de la pièce* enregistre la caméra et les niveaux visibles ; un clic sur cette pièce ouvre ensuite cette vue au lieu du zoom automatique. *Vue automatique* y revient.
- **Clôtures** (*Clôtures*) : chaque côté a son type (grillage, bois, mur, fer forgé, panneaux rigides, canisse, lames composites, gabions, neuf haies par espèce — laurier-palme, thuya, cyprès de Leyland, charmille, photinia, troène, bambou, buis, haie champêtre — ou ouvert là où il n'y a pas de clôture) et sa hauteur. Deux façons d'en créer une : *Clôturer d'après le cadastre* (les parcelles de la maison sont présélectionnées, clic pour ajouter ou retirer les parcelles voisines du même terrain ; le contour de l'ensemble est clôturé) ou *Tracer une clôture* (clics successifs, la vue « Dessus » est conseillée ; chaque côté prend le type choisi dans la palette, une couleur par type). *Modifier les côtés* : changer le type d'un côté d'un clic, couper un côté en deux (un morceau en mur, l'autre en grillage), supprimer un point.
- **Portails** (*Portails*) : *Ajouter un portail*, puis clic sur une clôture à l'endroit voulu : la clôture s'ouvre toute seule dessous. Autant de portails que l'on veut, sur n'importe quelle clôture ; *Déplacer* puis un clic ailleurs le fait glisser, *Supprimer* le retire (la clôture se referme). Réglages : ouverture (battant 1 ou 2 vantaux, coulissant 1 ou 2 vantaux), remplissage (barreaudé, plein, mixte), haut (droit ou arrondi), largeur, hauteur, couleur, piliers, **côté de la clôture vers lequel il s'ouvre** et, pour un seul vantail, l'extrémité où il est articulé ou coulisse. Un `cover` (position) ou un `binary_sensor` (on = ouvert) l'anime, en 6 s ; *Tester l'animation* l'ouvre sans entité.
- **Zones fleuries** (*Zones fleuries*) : tracez une zone point par point, puis choisissez le **nombre de fleurs** et une **liste de couleurs avec poids** (3 rouges pour 1 blanche donne trois fleurs rouges pour une blanche). Les fleurs sont plantées au hasard mais toujours de la même façon (*Replanter autrement* en tire une autre) ; la floraison suit la saison : aucune en hiver, les trois quarts au printemps, toutes en été, un tiers en automne.
- **Arrosage** (*Arrosage*) :
  - **Goutte-à-goutte** : une ligne par vanne (`switch`, `valve`, `input_boolean`), tracée point par point et arrondie au rendu ; tuyau noir, marron, vert ou masqué. Vanne ouverte, la ligne passe au bleu, des reflets y circulent, une goutte grossit puis rétrécit en boucle sous chaque goutteur (espacés de 30 cm par défaut, avec un léger décalage d'un goutteur à l'autre : la ligne scintille) et une tache humide grandit jusqu'à former une bande. La largeur de la tache suit le modèle de Schwartzman & Zur (1986), selon le débit du goutteur, la durée d'ouverture et le type de sol ; elle s'efface en 30 minutes après la fermeture.
  - **Arroseurs** : un circuit par vanne, avec un ou plusieurs arroseurs (modèle du catalogue : Hunter Pro-Spray PSU-04 8A à 17A, SRM-04, PGJ-04, PGP Ultra, MP Rotator, ou générique ; distances minimale / maximale, orientation et angle préremplis et modifiables ; *Viser* d'un clic). Vanne ouverte, le secteur arrosé estimé s'affiche et le jet est animé (balayage pour une turbine, éventail pour une tuyère).
  - *Tester l'animation* joue 30 secondes d'arrosage accéléré (30 s = 1 h 30) sur toutes les lignes et tous les circuits, sans ouvrir aucune vanne : la tache humide grandit, les jets tournent, puis tout revient à l'état réel. Le bouton *Tester* d'une ligne ou d'un circuit fait la même chose pour lui seul ; fermer l'éditeur arrête le test.
- **Autres outils** : objets extérieurs (masquer, hauteur, décalage, rotation), niveau de la piscine, arbres (supprimer, ajouter avec essence et hauteur, annuler, tout rétablir), corrections du sol (muret, terrasse, pinceaux, coupe, liste des corrections modifiables), vues.

## Configuration (⚙)

- **Démo** (pour filmer ou présenter la vue sans montrer votre maison ni votre emplacement ; masquée par défaut, voir *Afficher la démo* plus bas) : *Charger la démo* ajoute un logement « Démo » avec une maison fictive à étage (le fichier Sweet Home 3D `custom_components/house_view/demo/demo-maison.sh3d` peut être ouvert et retravaillé), un terrain en trois plateaux avec un verger, une piscine, un étang, une clôture, l'arrosage, un robot aspirateur et des volets, à un emplacement fictif (45° N). Vos logements ne sont pas touchés. Ses entités sont simulées par la carte (rien n'est créé dans Home Assistant, et rien de votre maison n'apparaît) : un scénario de la journée, à 1 h toutes les 2 s, ouvre et ferme les volets, allume les lumières, arrose à l'aube, lance l'aspirateur le matin et le robot de piscine l'après-midi, déclenche une fuite d'eau avant le dîner… Le bouton 🎬 de la barre le met en pause, règle l'heure et déclenche un événement à la main (volets, lumières, aspirateur, arrosage, robots, fuite, fumée) ; un clic sur une entité simulée la bascule. *Remettre la démo à zéro* la remet comme livrée, *Quitter la démo* revient à votre logement ; le logement de démo se supprime comme une autre entrée. Vos vrais aquariums (reeftank) peuvent y être placés. Les fichiers sont générés par `npm run demo` dans `card/`. Le logement de démo démarre vide et plat, pour être filmé depuis le début : importez `demo-maison.sh3d` (*Télécharger demo-maison.sh3d* dans ⚙) avec *Importer un .sh3d*, puis *Récupérer le terrain* : la récupération passe par ses étapes et apporte le terrain de la démo, sans aucun accès réseau.
- **Plan** : *Importer un plan* lit dans le navigateur un fichier Sweet Home 3D (`.sh3d`), un fichier IFC (`.ifc`, BIM : ArchiCAD, Revit, FreeCAD, BlenderBIM : étages, espaces, murs, portes et fenêtres) ou un plan SVG (`.svg`, comme ceux dessinés pour ha-floorplan ou avec Inkscape : chaque forme nommée est une pièce, un calque Inkscape un niveau ; *Échelle : unités SVG par mètre* corrige la taille), et liste ce qui a été trouvé. Sans fichier : *Créer un plan simple* ouvre un éditeur de pièces rectangulaires, niveau par niveau (glisser une pièce pour la déplacer, ses poignées pour la redimensionner, les bords se collent aux pièces voisines ; nom et zone Home Assistant, portes, fenêtres et baies cliquées sur un mur avec leur largeur, hauteur et allège ; hauteur sous plafond par niveau, un nouveau niveau reprend le contour de celui du dessous ; toit automatique, deux pans ou plat), la vue 3D se mettant à jour derrière. *Plan depuis la carte du robot* en part des pièces de la carte d'un robot aspirateur (extracteurs de carte qui donnent `rooms`). Un SVG de rectangles et les pièces du robot s'ouvrent dans le plan simple, pour ajouter portes et fenêtres. Chaque pièce reçoit un plafonnier allumé par les lumières de sa zone. Les meubles d'un plan Sweet Home 3D sont dessinés avec leurs propres modèles 3D (modèles OBJ du fichier, allégés : quelques milliers de triangles au plus, une couleur par matériau, la couleur moyenne d'une texture), à leur taille, tournés et en miroir comme dans le plan ; *Meubles dessinés avec leurs modèles 3D du plan* revient aux formes simples.
- **Récupération du terrain** (*Terrain (MNT)*) : l'intégration récupère elle-même le relief et ce qui l'entoure, autour des coordonnées de Home Assistant (modifiables). La source suit le pays de la configuration de Home Assistant (*Automatique*), ou est imposée dans le formulaire :
  - **France : cartes.gouv.fr (IGN)** : sol LiDAR HD à 0,5 m (RGE ALTI à 1 m à défaut), modèle de surface (calage automatique, arbres), bâtiments, routes et cadastre (BD TOPO, parcellaire), photo aérienne ou plan IGN plaqué au sol. Si l'IGN n'a pas de donnée à cet endroit, les sources mondiales prennent le relais ;
  - **Monde : Mapterhorn + OpenStreetMap** : relief des tuiles [Mapterhorn](https://mapterhorn.com) (LiDAR ouverts de nombreux pays, 30 m ailleurs ; à défaut, les Terrain Tiles de Mapzen hébergées par AWS, plus grossières), bâtiments et routes d'OpenStreetMap. Pas de modèle de surface, de cadastre ni de photo aérienne : les arbres se placent avec l'éditeur, la clôture se trace à la main.

  Dans les deux cas : recalage facultatif sur le bâtiment le plus proche (la position de Home Assistant est souvent approximative), calage automatique du plan à la fin, et source affichée sous le formulaire.
- **Sauvegarde GitHub** : options de l'intégration, menu *Sauvegarde GitHub* (dépôt privé `propriétaire/nom`, jeton fine-grained avec *Contents : read and write*, branche, dossier) ; boutons *Sauvegarder sur GitHub* / *Restaurer depuis GitHub* dans ⚙. Seuls les fichiers modifiés sont commités ; un dépôt public est refusé (il contient le plan de votre maison).
- **Protection de l'édition** : seuls les administrateurs de Home Assistant peuvent modifier la vue. Pour éviter en plus les modifications par erreur (écran partagé resté connecté avec un compte administrateur), un mot de passe peut être demandé avant d'ouvrir l'éditeur ✎ et la configuration ⚙ :
  - il se règle dans les options de l'intégration (Paramètres → Appareils et services → House View → Configurer → *Protection de l'édition*) : 4 caractères ou plus, champ vide pour garder l'actuel, case à cocher pour supprimer la protection. Il est conservé sous forme d'empreinte salée, jamais en clair ;
  - la carte le demande à l'ouverture de ✎ ou ⚙ (le crayon porte alors un cadenas), puis de nouveau après 10 minutes sans modification, après un rechargement de la page ou un redémarrage de Home Assistant. Le bouton 🔒 en tête du panneau reverrouille tout de suite ;
  - le contrôle est fait par l'intégration : sans mot de passe valide, toute écriture est refusée (code HTTP 423), même hors de la carte. Après 5 mots de passe faux, il faut attendre 1 minute ;
  - mot de passe oublié : le changer ou le supprimer dans les options de l'intégration ;
  - consulter la vue, zoomer, commander les lumières ou l'aspirateur et l'aperçu saison / météo restent libres.
- **Afficher la démo** : elle est masquée par défaut. Options de l'intégration → *Démo* → décocher *Masquer la démo* pour obtenir la section *Charger la démo* dans la configuration de la carte (un logement de démonstration déjà chargé garde ses propres boutons dans les deux cas).

## Sources du terrain par pays

La France utilise les services de l'IGN. Partout ailleurs, le relief vient de [Mapterhorn](https://mapterhorn.com), qui pose les LiDAR nationaux ouverts sur un modèle mondial à 30 m, et les bâtiments et routes viennent d'[OpenStreetMap](https://www.openstreetmap.org). La finesse indiquée est celle annoncée par Mapterhorn en novembre 2026 ; elle progresse à chaque version du projet (carte de couverture à jour sur mapterhorn.com).

| | Pays | Relief | Bâtiments, routes | Cadastre, photo aérienne | Testé |
|---|---|---|---|---|---|
| 🇫🇷 | France | IGN LiDAR HD 0,5 m (RGE ALTI 1 m à défaut) | IGN BD TOPO | IGN (parcellaire, photo aérienne ou plan) | ✅ |
| 🇩🇪 | Allemagne | Mapterhorn : 0,25 m (Bade-Wurtemberg), 1 m (la plupart des Länder) | OpenStreetMap | — | ❌ |
| 🇦🇹 | Autriche | Mapterhorn : 1 m | OpenStreetMap | — | ❌ |
| 🇧🇪 | Belgique | Mapterhorn : 0,5 m (Wallonie) | OpenStreetMap | — | ❌ |
| 🇩🇰 | Danemark | Mapterhorn : 0,4 m | OpenStreetMap | — | ❌ |
| 🇪🇸 | Espagne | Mapterhorn : 0,5 m (couverture partielle) | OpenStreetMap | — | ❌ |
| 🇪🇪 | Estonie | Mapterhorn : 1 m | OpenStreetMap | — | ❌ |
| 🇮🇹 | Italie | Mapterhorn : LiDAR en Sicile et sur une partie de la Sardaigne | OpenStreetMap | — | ❌ |
| 🇱🇺 | Luxembourg | Mapterhorn : 0,5 m | OpenStreetMap | — | ❌ |
| 🇳🇴 | Norvège | Mapterhorn : 1 m | OpenStreetMap | — | ❌ |
| 🇳🇱 | Pays-Bas | Mapterhorn : LiDAR national | OpenStreetMap | — | ❌ |
| 🇵🇱 | Pologne | Mapterhorn : LiDAR national | OpenStreetMap | — | ❌ |
| 🇵🇹 | Portugal | Mapterhorn : 0,5 m (couverture partielle) | OpenStreetMap | — | ❌ |
| 🇷🇴 | Roumanie | Mapterhorn : 0,5 m (couverture partielle) | OpenStreetMap | — | ❌ |
| 🇬🇧 | Royaume-Uni | Mapterhorn : 1 m (Angleterre, Écosse, pays de Galles) | OpenStreetMap | — | ❌ |
| 🇸🇰 | Slovaquie | Mapterhorn : 1 m | OpenStreetMap | — | ❌ |
| 🇸🇮 | Slovénie | Mapterhorn : 0,5 m | OpenStreetMap | — | ❌ |
| 🇸🇪 | Suède | Mapterhorn : 1 m | OpenStreetMap | — | ❌ |
| 🇨🇭 | Suisse | Mapterhorn : 0,25 m (canton de Zurich), 0,5 m (couverture partielle) | OpenStreetMap | — | ❌ |
| 🌍 | Reste du monde | Mapterhorn : 30 m (Copernicus GLO-30) ; à défaut, Terrain Tiles (Mapzen / AWS) | OpenStreetMap | — | ❌ |

> **Non testé hors de France.** Les sources mondiales ont été écrites d'après leur documentation et vérifiées sur des données simulées, sans pouvoir les essayer en conditions réelles. Si la récupération échoue ou donne un relief incohérent chez vous, merci d'[ouvrir une issue](https://github.com/elwinmage/ha-house-view-component/issues) en indiquant le pays, la source choisie et le message affiché sous le formulaire. Un retour positif est bienvenu aussi : il permettra de passer le pays en « testé ».

Avec un modèle à 30 m, le terrain n'est qu'un plan incliné : les corrections du sol de l'éditeur (✎) permettent de redessiner terrasses et talus. Le cadastre et la photo aérienne n'existent que pays par pays ; ils pourront être ajoutés sur demande, une issue par pays.

## API HTTP (utilisée par la carte)

| Route | GET | POST | DELETE |
|---|---|---|---|
| `/api/house_view/homes` | logements configurés : `[{id, title}]` | | |
| `/api/house_view/demo` | plan de la maison de démo (admin) | crée le logement de démo ou le remet comme livré → `{home}` (admin) | |
| `/api/house_view/info` | état, nom et position du logement | | |
| `/api/house_view/scene` | plan | remplace (admin) | |
| `/api/house_view/terrain` | grille de hauteurs | remplace (admin) | supprime (admin) |
| `/api/house_view/edits` | corrections | remplace (admin) | supprime (admin) |
| `/api/house_view/ortho` | photo / plan au sol | remplace (admin) | supprime (admin) |
| `/api/house_view/fetch` | état de la récupération | lance la récupération du terrain, `provider` : `auto` \| `ign` \| `world` (admin) | |
| `/api/house_view/github` | | `{"action": "backup" \| "restore"}` (admin) | |
| `/api/house_view/unlock` | `{locked, unlocked}` | `{"password"}` → jeton (admin) | reverrouille |

Avec plusieurs logements, chaque route prend `?home=<id de l'entrée>` (le premier logement sans lui).

Quand un mot de passe d'édition est défini, les écritures (POST / DELETE ci-dessus) exigent en plus l'en-tête `X-House-View-Unlock` avec le jeton rendu par `/unlock` ; sinon elles répondent 423.

Chaque document est validé (`validate.py`) et conservé dans `.storage/house_view.<clé>` (logement créé avant la version 0.2) ou `.storage/house_view.<id du logement>.<clé>` ; chaque écriture déclenche l'événement `house_view_updated` (`key`, `updated`, `home`). Supprimer un logement supprime ses documents. Les documents sont volumineux (un terrain fait plusieurs Mo) : ils passent en HTTP (limite Home Assistant de 16 Mo par requête), et non par le websocket.

## Développement et tests

```bash
pip install pre-commit
# (optionnel) cd card && npm install pour lancer le build et les tests à la main
pre-commit install            # ruff, prettier, vitest, traductions, pytest (100 % de couverture) ; pre-commit gère les dépendances des hooks
pre-commit run --all-files
```

- **Intégration** : `pytest` (vrai serveur HTTP de Home Assistant via `pytest-homeassistant-custom-component`, couverture de 100 % exigée).
- **Carte** : `cd card && npm test` (vitest) ; `npm run build` écrit `custom_components/house_view/frontend/house-view-card.js` ; `npm run format` (prettier).
- **Traductions** : `scripts/check_translations.py` vérifie que chaque langue de l'intégration (en, fr, it, de, es, pl, pt, nl) et de la carte (`card/src/i18n.js`) a exactement les clés de l'anglais. Ce README existe dans les mêmes huit langues (`doc/<langue>/README.<langue>.md`).
- **Page de test sans Home Assistant** : `python3 card/test/harness/server.py` (faux serveur de l'API), puis http://localhost:8765/card/test/harness/index.html
- **Images de marque** : `custom_components/house_view/brand/` (icône et logo, clair et sombre), servies par Home Assistant 2026.3+ sans passer par le dépôt `home-assistant/brands`. Sources vectorielles dans `assets/brand/` ; `scripts/build_brand.sh` régénère les PNG (`rsvg-convert`, ImageMagick, police Inter).
- **CI** (`.github/workflows/`) : `validate.yml` (hassfest + HACS), `tests.yml` (pre-commit, pytest, vitest + build), `release.yml` (lancé à la main avec la version : met à jour `manifest.json` et `card/package.json`, compile la carte, tague, publie la release avec `house_view.zip`).
- **Client du catalogue** : `catalog_pack.py` et `catalog_runtime.py` sont des copies de `reeftech-catalog/client/` (le client ne connaît que ses propres sections : `catalog.py` lui déclare celles de la maison) ; `house_catalog_sections.py` et `catalog_builtin*/` sont des copies de la description et des entrées de `house-catalog`. Tous sont écrits par le `scripts/sync_client.py` de ces dépôts : on les modifie là-bas, jamais ici.

`card/src/engine.js` est le moteur 3D (une instance par carte, sans dépendance à Home Assistant) ; `card/src/ha-bridge.js` convertit l'état de Home Assistant en données pour le moteur ; `card/src/engine/` contient les modules du prototype (géométrie, végétation, terrain, lumières…).

## Feuille de route

1. ✅ Phase 1 : intégration + carte, import du plan, terrain, calage, lumières et météo en direct.
2. ✅ Éditeurs dans la carte : objets extérieurs, arbres, corrections du sol, vues personnalisées.
3. ✅ Récupération du terrain par l'intégration pour la France (IGN), routes, photo au sol, clôtures, entités placées, aspirateur robot, zoom sur une pièce, aperçu saison / météo, sauvegarde GitHub.
4. ✅ Autres pays : relief Mapterhorn, bâtiments et routes OpenStreetMap (à confirmer pays par pays). Ensuite : cadastre et photo aérienne des pays qui les publient en données ouvertes.
5. ✅ Catalogue (arbres à quatre saisons, objets) lu depuis `house-catalog` et édité avec `catalog_editor`. Ensuite : davantage d'espèces et d'objets, modèles d'arroseurs.
6. ✅ Plusieurs logements, plusieurs robots aspirateurs, entités d'une pièce en zoom, portes / fenêtres / volets roulants liés à Home Assistant, piscines et étangs creusés dans le terrain, éditeur en fenêtres.

## Licence

Code sous licence [MIT](../../LICENSE) © Elwinmage. L'icône et le logo (`assets/brand/`) sont des créations originales du projet, sous la même licence.

- **Bibliothèques incluses dans la carte compilée** : [three.js](https://threejs.org) (MIT), [Lit](https://lit.dev) (BSD-3-Clause) et [fflate](https://github.com/101arrowz/fflate) (MIT) ; leurs mentions de licence sont conservées à la fin du fichier compilé.
- **Données** : le dépôt ne contient aucune donnée cartographique ; chaque utilisateur télécharge celles de son terrain, et la source est rappelée dans ⚙ → *Terrain (MNT)*. En cas de publication d'une capture, mentionner cette source :
  - France : services de l'IGN (cartes.gouv.fr), sous [Licence Ouverte Etalab 2.0](https://www.etalab.gouv.fr/licence-ouverte-open-licence/) ;
  - relief hors de France : [Mapterhorn](https://mapterhorn.com/attribution) et les jeux de données ouverts qu'il assemble, ou les [Terrain Tiles](https://registry.opendata.aws/terrain-tiles) de Mapzen ;
  - bâtiments et routes hors de France : © les contributeurs d'[OpenStreetMap](https://www.openstreetmap.org/copyright), sous licence ODbL.
- Les noms de marques (Hunter, Roborock, Sweet Home 3D…) appartiennent à leurs propriétaires et ne sont cités que pour décrire la compatibilité.
