<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="custom_components/house_view/brand/dark_logo.png">
    <img src="custom_components/house_view/brand/logo.png" alt="House View" width="420">
  </picture>
</p>

# House View

Vue pseudo-3D dynamique de la maison pour Home Assistant : plan **Sweet Home 3D** + modèle numérique de terrain,
avec lumières, météo, soleil et saisons en direct. Un seul dépôt contient :

- `custom_components/house_view/` : l'**intégration** (stockage du plan, du terrain et des corrections ; API HTTP) ;
- `card/` : la **carte Lovelace** `house-view-card` (three.js), compilée dans `custom_components/house_view/frontend/`.
  L'intégration la sert elle-même (`/house_view/house-view-card.js`) et la charge sur tous les tableaux de bord :
  **aucune ressource Lovelace à déclarer**.

## Installation

HACS (dépôt personnalisé, type *Intégration*) ou copie de `custom_components/house_view/` dans
`config/custom_components/`, puis redémarrer et ajouter l'intégration *House View* (aucun réglage : la position vient
de la configuration de Home Assistant). Ajouter ensuite la carte au tableau de bord (`type: custom:house-view-card`),
puis ouvrir ⚙ (administrateur) pour importer le plan `.sh3d`, puis récupérer le terrain depuis cartes.gouv.fr (France)
ou charger un terrain `.json`.

La version de la carte s'affiche dans la console du navigateur au chargement (`🏠 HOUSE VIEW v0.x.y`).

La carte compilée n'est pas versionnée : `release.yml` la construit à chaque release et publie `house_view.zip`, que HACS
installe. En développement : `cd card && npm install && npm run build`.

## Carte : configuration

```yaml
type: custom:house-view-card
weather_entity: weather.maison        # météo en direct (optionnel)
mode: live                            # live (heure réelle) | simulation (curseurs heure / date / météo)
view: Vue générale                    # vue de départ (optionnel)
show_views: true                      # boutons des vues caméra
show_levels: true                     # boutons toit / niveaux (+ 🌡 si des températures par pièce sont connues)
tap_action: zoom                      # clic sur une pièce : zoom (2e clic = lumières) | toggle_lights | none
show_sensors: true                    # capteurs placés dans l'éditeur
vacuum_entity: vacuum.robot           # optionnel : par défaut le premier vacuum.* trouvé
vacuum_poll: 15                       # s entre deux lectures de position (Roborock : action cloud, min 5)
vacuum_show_floor: false              # true = pendant un nettoyage, montre l'étage du robot vu de dessus
vacuum_rate: 1                        # m²/min, pour le trajet estimé d'un robot sans position
vacuum_progress_entity: sensor.xxx    # optionnel : avancement (%) ; détecté seul pour Roborock
movable_camera: true                  # caméra mobile (rotation, zoom, déplacement) ; false = figée sur les vues
height: fill                          # fill (hauteur de l'écran sous le haut de la carte) | aspect (16/10) | 600 | "70vh"
min_height: 320                       # hauteur minimale en mode fill (px)
fps_cap: 30                           # limite d'images/s (écrans muraux, tablettes)
light_entities: [light.salon, ...]    # optionnel : restreint les lumières prises en compte
```

- **Latitude / longitude / fuseau** : lus dans la configuration de Home Assistant. Les saisons de la végétation
  s'inversent dans l'hémisphère sud.
- **Pièces ↔ areas** : une pièce du plan est liée à l'area HA de même nom (accents et casse ignorés). ⚙ liste les pièces
  sans area correspondante.
- **Lumières** : état, couleur et intensité des `light.*` de l'area de chaque pièce.
- **Météo** : l'état de `weather_entity` (`rainy`, `snowy`, `fog`…) + température, vent et nébulosité si fournis.
- **Zoom sur une pièce** : un clic zoome sur la pièce (toit et étages supérieurs masqués) ; un 2e clic sur la même pièce
  bascule ses lumières ; « ← pièce » revient à la vue d'avant.
- **Aperçu** (bouton météo) : force une saison (printemps, été, automne, hiver), une météo (dégagé, nuageux, pluie, orage,
  neige, brouillard) ou un moment (matin, midi, crépuscule, nuit), combinables ; retour au direct par le bouton
  « Aperçu ✕ » ou automatiquement après 3 min. En mode simulation, ce sont des raccourcis vers les curseurs.
- **Aspirateur** : si une entité `vacuum.*` existe, son icône apparaît en haut à droite. Un clic ouvre la sélection des
  pièces (l'étage du robot s'affiche vu de dessus) : chaque pièce touchée, liée à une area HA, est surlignée, puis
  « Nettoyer » appelle `vacuum.clean_area` avec les areas choisies (action générique de HA 2026.3+ ; la correspondance
  pièces du robot ↔ areas se fait une fois dans les réglages de l'entité aspirateur). Démarrer / pause / base aussi.
- **Suivi du nettoyage** (✎ → Aspirateur robot) : un robot 3D (couleur réglable, blanc par défaut) se déplace sur le
  plan, la pièce en cours est teintée (couleur réglable) avec son pourcentage, les pièces demandées à venir sont
  teintées plus clair, une pièce terminée scintille une minute, et une jauge circulaire autour de l'icône du robot
  donne l'avancement total. En anomalie (`error`), la pièce et le robot clignotent en rouge avec un panneau ⚠.
  - **Base** : « Placer la base » puis clic sur le sol ; c'est le point de calage entre la carte du robot et le plan.
    Son **orientation** se règle en degrés (0° = face vers le haut du plan, 90° vers la droite, valeur par défaut),
    par quarts de tour (⟲ / ⟳) ou avec « Orienter d'un clic » : on clique devant la base, là où le robot en sort.
    Le robot au repos se gare devant la base, dans le même sens.
  - **Position du robot** : *Roborock* (action officielle `roborock.get_vacuum_current_position`, base en 25500 /
    25500 ; elle passe par le cloud, d'où une lecture toutes les `vacuum_poll` secondes, ralentie après une erreur),
    *attributs d'une entité* (`vacuum_position {x, y}` et `charger`, comme les extracteurs de carte), ou *aucune* :
    le robot suit alors un trajet estimé (allers-retours pièce par pièce), signalé « position estimée ».
  - **Calage** : rotation, miroir et échelle ; « Caler d'un clic » calcule la rotation quand on clique la position
    réelle du robot sorti de sa base ; « mémoriser » enregistre les coordonnées de la base pour les autres marques.
  - **Pourcentage d'une pièce** : part du sol parcourue par le robot (estimation : 80 % du sol est supposé
    accessible) ; l'avancement total vient du capteur du robot quand il existe (Roborock : `cleaning_progress`).
  - « Tester l'animation » joue un nettoyage accéléré (avec ou sans anomalie) sans lancer le robot.
- **Pièces ↔ areas** (✎ → Pièces) : une pièce du plan est liée à l'area HA de même nom ; cette section permet de
  choisir une autre area, ou aucune, pièce par pièce (survol = la pièce s'allume sur le plan).
- **Arrosage** (✎ → Arrosage) :
  - **Goutte-à-goutte** : une ligne par vanne (`switch`, `valve`, `input_boolean`), tracée par points et arrondie au
    rendu ; tuyau noir, marron, vert ou masqué. Vanne ouverte, la ligne passe au bleu, des reflets y circulent, une
    goutte grossit puis rétrécit en boucle sous chaque goutteur (espacement 30 cm par défaut, léger décalage d'un
    goutteur à l'autre : la ligne scintille) et une tache humide grandit jusqu'à former une bande. La largeur de la
    tache suit le modèle de Schwartzman & Zur (1986) selon le débit du goutteur, la durée d'ouverture et le type de
    sol ; elle s'efface en 30 min après la fermeture.
  - **Arroseurs** : un circuit par vanne, avec un ou plusieurs arroseurs (modèle du catalogue : Hunter Pro-Spray
    PSU-04 8A à 17A, SRM-04, PGJ-04, PGP Ultra, MP Rotator, ou générique ; distances min / max, orientation et angle
    pré-remplis et modifiables ; « Viser » d'un clic). Vanne ouverte, le secteur arrosé estimé s'affiche et le jet
    est animé (balayage pour une turbine, éventail pour une tuyère).
  - « Tester l'animation » joue 30 s d'arrosage accéléré (30 s = 1 h 30) sur toutes les lignes et tous les circuits,
    sans ouvrir aucune vanne : la tache humide grandit, les jets tournent, puis tout revient à l'état réel. Le bouton
    « Tester » d'une ligne ou d'un circuit fait la même chose pour lui seul ; fermer l'éditeur arrête le test.
- **Entités placées** (capteurs, lumières, interrupteurs, select…) : posées d'un clic puis déplacées en glissant leur
  étiquette (éditeur ouvert). Fixation au sol (par défaut : l'étiquette reste dans sa pièce quel que soit l'angle), au
  mur (côté pièce, cachée quand le mur est vu de dos) ou libre en hauteur ; une étiquette cachée par un étage supérieur
  ou le toit n'est pas affichée. Pastille (icône + valeur) ou icône seule ; couleur, libellé, icône (sélecteur d'icônes
  de HA avec aperçu) ; visible toujours, sur la vue de son étage ou en zoom sur sa pièce ; clic = fiche HA, bascule ou
  rien. Dans l'éditeur, la liste est repliée : seule l'entité choisie est dépliée.
- **Lumières placées** : une `light.*` placée devient une source lumineuse à cet endroit de la pièce (spot, suspension,
  lampe, réglette ou invisible ; hauteur et portée réglables ; au mur : applique à la hauteur cliquée), pilotée par son
  propre état et sa couleur. Les autres lumières de l'area continuent d'éclairer la pièce entière.
- **Vue par pièce** : en zoom sur une pièce (éditeur ouvert), « 📷 Vue de la pièce » enregistre la caméra et les niveaux
  visibles ; un clic sur cette pièce ouvre ensuite cette vue au lieu du zoom automatique.
- **Caméra** : le bouton ✥ / 🔒 en haut à droite débloque ou fige la caméra sans toucher à la configuration.
- **Températures** : capteur de température de l'area (réglage de l'area dans HA), sinon premier `sensor.*` de
  `device_class: temperature` de l'area ; affichées au survol et en calque (🌡).
- **Mode simulation** : ☀ ouvre heure (avec défilement), date, préréglage météo, nuages, précipitations, vent,
  température et neige.
- **Éditeur (admin, ✎)** : objets extérieurs (masquer, hauteur, décalage, rotation), niveau de la piscine, arbres
  (supprimer, ajouter avec essence et hauteur, annuler, tout rétablir), corrections du sol (muret, terrasse, pinceaux,
  coupe, liste des corrections modifiables), clôtures, entités placées, pièces ↔ areas, aspirateur, arrosage, vues.
  Une seule section est dépliée à la fois. Tout est sauvegardé dans le fichier d'éditions, séparé du
  plan et du terrain. Échap annule le tracé en cours.
- **Terrain depuis cartes.gouv.fr** (⚙ → Terrain, France) : l'intégration récupère elle-même, autour des coordonnées
  de HA (modifiables) : sol LiDAR HD 0,5 m (RGE ALTI 1 m à défaut), modèle de surface (calage automatique, arbres),
  bâtiments, routes et cadastre (BD TOPO, parcellaire), et la photo aérienne ou le plan IGN plaqué au sol. Option de
  recalage sur le bâtiment BD TOPO le plus proche (la position de HA est souvent approximative). Le calage automatique
  est lancé à la fin.
- **Routes** : dessinées en enrobé sur le relief (désactivables dans ⚙).
- **Clôtures** (✎ → Clôtures) : chaque côté a son type — grillage, bois, mur, haie, ou ouvert (portail) — et sa
  hauteur. Deux façons de créer : « Clôturer d'après le cadastre » (parcelles de la maison présélectionnées, clic pour
  ajouter ou retirer les parcelles voisines du même terrain ; le contour de l'ensemble est clôturé) ou « Tracer une
  clôture » (clics successifs, vue « Dessus » conseillée ; chaque côté prend le type choisi dans la palette, une
  couleur par type). « Modifier les côtés » : changer le type d'un côté au clic, couper un côté en deux (un morceau en
  mur, l'autre en grillage), supprimer un point.
- **Sauvegarde GitHub** : options de l'intégration (dépôt privé `propriétaire/nom`, jeton fine-grained avec
  *Contents : read and write*, branche, dossier) ; boutons « Sauvegarder » / « Restaurer » dans ⚙. Seuls les fichiers
  modifiés sont commités ; un dépôt public est refusé (il contient le plan de la maison).
- **Performances** : le rendu s'arrête quand la carte n'est pas visible ; les volumes de lumière ne sont recalculés que
  si un état utile change.

## API HTTP (utilisée par la carte)

| Route | GET | POST | DELETE |
|---|---|---|---|
| `/api/house_view/info` | état + position HA | | |
| `/api/house_view/scene` | plan | remplace (admin) | |
| `/api/house_view/terrain` | grille de hauteurs | remplace (admin) | supprime (admin) |
| `/api/house_view/edits` | corrections | remplace (admin) | supprime (admin) |
| `/api/house_view/ortho` | photo / plan au sol | remplace (admin) | supprime (admin) |
| `/api/house_view/fetch` | état de la récupération | lance la récupération cartes.gouv.fr (admin) | |
| `/api/house_view/github` | | `{"action": "backup" \| "restore"}` (admin) | |

Chaque document est validé (`validate.py`) et conservé dans `.storage/house_view.<clé>` ; chaque écriture déclenche
l'événement `house_view_updated` (`key`, `updated`). Les documents sont volumineux (un terrain fait plusieurs Mo) : ils
passent en HTTP (limite HA de 16 Mo par requête) et non par le websocket.

## Développement et tests

```bash
pip install pre-commit
# (optionnel) cd card && npm install pour lancer le build et les tests à la main
pre-commit install            # ruff, prettier, vitest, traductions, pytest (100 % de couverture) ; les dépendances des hooks sont gérées par pre-commit
pre-commit run --all-files
```

- **Intégration** : `pytest` (vrai serveur HTTP de Home Assistant via `pytest-homeassistant-custom-component`,
  couverture 100 % exigée).
- **Carte** : `cd card && npm test` (vitest : liaison HA, météo, areas, lumières, horloge solaire) ;
  `npm run build` écrit `custom_components/house_view/frontend/house-view-card.js` ; `npm run format` (prettier).
- **Traductions** : `scripts/check_translations.py` vérifie que chaque langue de l'intégration (en, fr, it, de, es, pl, pt)
  et de la carte (`card/src/i18n.js`) a exactement les clés de l'anglais.
- **Page de test sans Home Assistant** : `python3 card/test/harness/server.py` (faux serveur de l'API), puis
  http://localhost:8765/card/test/harness/index.html
- **Images de marque** : `custom_components/house_view/brand/` (icône et logo, clair et sombre), servies par Home
  Assistant 2026.3+ sans passer par le dépôt `home-assistant/brands`. Sources vectorielles dans `assets/brand/` ;
  `scripts/build_brand.sh` régénère les PNG (`rsvg-convert`, ImageMagick, police Inter).
- **CI** (`.github/workflows/`) : `validate.yml` (hassfest + HACS), `tests.yml` (pre-commit, pytest, vitest + build),
  `release.yml` (lancé à la main avec la version : met à jour `manifest.json` et `card/package.json`, compile la carte,
  tague, publie la release avec `house_view.zip`).

`card/src/engine.js` est le moteur 3D (une instance par carte, sans dépendance à HA) ; `card/src/ha-bridge.js` convertit
l'état de HA en données pour le moteur ; `card/src/engine/` reprend les modules du prototype (géométrie, végétation,
terrain, lumières…).

## Feuille de route

1. ✅ Phase 1 : intégration + carte, import du plan, terrain, calage, lumières et météo en direct.
2. ✅ Éditeurs dans la carte : objets extérieurs, arbres, corrections du sol, vues personnalisées.
3. ✅ Récupération du terrain côté intégration pour la France (IGN), routes, photo au sol, clôtures, capteurs placés,
   aspirateur, zoom pièce, aperçu saison / météo, sauvegarde GitHub. À venir : autres pays (PDOK, swisstopo…).
4. Catalogue (arbres à 4 saisons, objets) géré par `catalog_editor`.

## Licence

Code sous licence [MIT](LICENSE) © Elwinmage. L'icône et le logo (`assets/brand/`) sont des créations originales du
projet, sous la même licence.

- **Bibliothèques incluses dans la carte compilée** : [three.js](https://threejs.org) (MIT),
  [Lit](https://lit.dev) (BSD-3-Clause) et [fflate](https://github.com/101arrowz/fflate) (MIT) ; leurs mentions de
  licence sont conservées à la fin du fichier compilé.
- **Données** : le dépôt ne contient aucune donnée cartographique. Le terrain, les routes, le cadastre et les
  photos aériennes sont téléchargés par chaque utilisateur depuis les services de l'IGN (cartes.gouv.fr), diffusés
  sous [Licence Ouverte Etalab 2.0](https://www.etalab.gouv.fr/licence-ouverte-open-licence/) : mentionner la source
  (IGN) en cas de publication d'une capture.
- Les noms de marques (Hunter, Roborock, Sweet Home 3D…) appartiennent à leurs propriétaires et ne sont cités que pour
  décrire la compatibilité.
