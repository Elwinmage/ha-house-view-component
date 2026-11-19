<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../../custom_components/house_view/brand/dark_logo.png">
    <img src="../../custom_components/house_view/brand/logo.png" alt="House View" width="420">
  </picture>
</p>

# House View

**Langues disponibles :**
[<img src="https://flagicons.lipis.dev/flags/4x3/fr.svg" style="width: 5%;"/>](README.fr.md)
[<img src="https://flagicons.lipis.dev/flags/4x3/gb.svg" style="width: 5%;"/>](../../README.md)
[<img src="https://flagicons.lipis.dev/flags/4x3/es.svg" style="width: 5%;"/>](../es/README.es.md)
[<img src="https://flagicons.lipis.dev/flags/4x3/de.svg" style="width: 5%;"/>](../de/README.de.md)
[<img src="https://flagicons.lipis.dev/flags/4x3/pl.svg" style="width: 5%;"/>](../pl/README.pl.md)
[<img src="https://flagicons.lipis.dev/flags/4x3/pt.svg" style="width: 5%;"/>](../pt/README.pt.md)
[<img src="https://flagicons.lipis.dev/flags/4x3/it.svg" style="width: 5%;"/>](../it/README.it.md)

Vue pseudo-3D en direct de votre maison pour Home Assistant : votre plan **Sweet Home 3D** posé sur un modèle numérique de terrain, avec lumières, météo, soleil et saisons en temps réel, plus un aspirateur robot, l'arrosage du jardin et les clôtures. Un seul dépôt contient :

- `custom_components/house_view/` : l'**intégration** (stocke le plan, le terrain et vos corrections ; récupère le terrain ; API HTTP) ;
- `card/` : la **carte Lovelace** `house-view-card` (three.js), compilée dans `custom_components/house_view/frontend/`. L'intégration la sert elle-même (`/house_view/house-view-card.js`) et la charge sur tous les tableaux de bord : **aucune ressource Lovelace à déclarer**.

L'interface de la carte existe en anglais et en français ; les options de l'intégration en anglais, français, italien, allemand, espagnol, polonais et portugais. Les traductions sont bienvenues : les textes sont dans `custom_components/house_view/translations/` et `card/src/i18n.js`.

## Installation

1. Installer avec HACS (dépôt personnalisé, type *Intégration*), ou copier `custom_components/house_view/` dans `config/custom_components/`, puis redémarrer Home Assistant.
2. Ajouter l'intégration *House View*. Il n'y a rien à régler : la position vient de la configuration de Home Assistant.
3. Ajouter la carte à un tableau de bord (`type: custom:house-view-card`).
4. Ouvrir ⚙ dans la carte (administrateurs uniquement) pour importer votre plan `.sh3d`, puis récupérer le terrain (cartes.gouv.fr en France, données ouvertes mondiales ailleurs : voir [Sources du terrain par pays](#sources-du-terrain-par-pays)) ou charger un terrain `.json`.

La version de la carte s'affiche dans la console du navigateur au chargement (`🏠 HOUSE VIEW v0.x.y`). Le nettoyage par pièces et l'icône de l'intégration demandent Home Assistant 2026.3 ou plus récent.

La carte compilée n'est pas versionnée : `release.yml` la construit à chaque release et publie `house_view.zip`, que HACS installe. En développement : `cd card && npm install && npm run build`.

## Configuration de la carte

Les options se règlent dans l'éditeur visuel de la carte (modifier le tableau de bord, puis *Modifier* sur la carte), en quatre sections : heure et météo, affichage, lumières, aspirateur robot. Le plan, le terrain et tout ce qui est placé dans la vue se règlent dans la carte elle-même (✎ et ⚙). En YAML :

```yaml
type: custom:house-view-card
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
vacuum_entity: vacuum.robot           # optionnel : par défaut le premier vacuum.* trouvé
vacuum_poll: 15                       # secondes entre deux lectures de position (Roborock : action cloud, min 5)
vacuum_show_floor: false              # true = pendant un nettoyage, montre l'étage du robot vu de dessus
vacuum_rate: 1                        # m²/min, pour le trajet estimé d'un robot sans position
vacuum_progress_entity: sensor.xxx    # optionnel : avancement (%) ; détecté seul pour Roborock
movable_camera: true                  # caméra mobile (rotation, zoom, déplacement) ; false = figée sur les vues
height: fill                          # fill (hauteur de l'écran sous le haut de la carte) | aspect (16/10) | 600 | "70vh"
min_height: 320                       # hauteur minimale en mode fill (px)
fps_cap: 30                           # limite d'images par seconde (écrans muraux, tablettes)
light_entities: [light.salon, ...]    # optionnel : restreint les lumières prises en compte
```

## Vue en direct

- **Latitude, longitude, fuseau horaire** : lus dans la configuration de Home Assistant. Les saisons de la végétation s'inversent dans l'hémisphère sud.
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
- **Pourcentage d'une pièce** : part du sol parcourue par le robot (estimation : 80 % du sol est supposé accessible) ; l'avancement total vient du capteur du robot quand il existe (Roborock : `cleaning_progress`).
- *Tester l'animation* joue un nettoyage accéléré (avec ou sans anomalie) sans lancer le robot.

## Catalogue : arbres et objets

Les arbres et les meubles ne sont pas codés dans la carte : ils viennent du [catalogue de la maison](https://github.com/Elwinmage/house-catalog), où ajouter une espèce ou un objet est une pull request, pas une nouvelle version de cette intégration.

- **Arbres** : chaque espèce a jusqu'à quatre rendus, un par saison : couleur et densité du feuillage, floraison, fruits, feuilles au sol. La vue passe d'une saison à la suivante jour après jour (chêne, pin, if, cerisier et abricotier pour commencer). Ce sont les espèces proposées quand vous plantez un arbre dans l'éditeur, dans les hauteurs que donne le catalogue.
- **Objets** : un meuble du plan dont le nom contient un mot-clé d'un objet du catalogue (`Chaise`, `Chair`, `Stuhl`…) est dessiné avec lui, à la place et à la taille du meuble, au lieu d'une simple boîte ; quand le plan donne une couleur au meuble, l'objet la prend sur ses parties teintables. De même, une plante du plan nommée comme un arbre du catalogue (`Cerisier`, `Yew`) est dessinée comme cet arbre.
- **Mises à jour** : l'intégration télécharge le catalogue depuis GitHub en arrière-plan (la carte n'appelle jamais le réseau) et fonctionne hors ligne avec la copie qu'elle embarque. L'appareil *House view catalog* a une entité de mise à jour par section (arbres, objets), un interrupteur *Mise à jour automatique* (activé par défaut) et un bouton *Mettre à jour maintenant*.
- **Vos propres entrées** : avec l'[éditeur de catalogues](https://github.com/Elwinmage/catalog-editor), un arbre ou un objet que vous enregistrez est utilisé par la vue aussitôt, avant de le proposer au catalogue (ou sans le proposer).

## Éditeur (✎)

Réservé aux administrateurs. Une seule section est dépliée à la fois ; tout est sauvegardé dans le fichier d'éditions, séparé du plan et du terrain ; Échap annule le tracé en cours.

- **Entités placées** (capteurs, lumières, interrupteurs, select…) : posées d'un clic, puis déplacées en glissant leur étiquette (éditeur ouvert). Fixation au sol (par défaut : l'étiquette reste dans sa pièce quel que soit l'angle), au mur (côté pièce, cachée quand le mur est vu de dos) ou libre en hauteur ; une étiquette cachée par un étage supérieur ou le toit n'est pas affichée. Pastille (icône + valeur) ou icône seule ; couleur, libellé, icône (sélecteur d'icônes de Home Assistant avec aperçu) ; visible toujours, sur la vue de son étage ou en zoom sur sa pièce ; clic = fiche de l'entité, bascule ou rien. Dans l'éditeur, la liste est repliée : seule l'entité choisie est dépliée.
- **Lumières placées** : une `light.*` placée devient une source lumineuse à cet endroit de la pièce (spot, suspension, lampe, réglette ou invisible ; hauteur et portée réglables ; au mur : une applique à la hauteur cliquée), pilotée par son propre état et sa couleur. Les autres lumières de l'area continuent d'éclairer la pièce entière.
- **Vue par pièce** : en zoom sur une pièce, éditeur ouvert, *📷 Vue de la pièce* enregistre la caméra et les niveaux visibles ; un clic sur cette pièce ouvre ensuite cette vue au lieu du zoom automatique. *Vue automatique* y revient.
- **Clôtures** (*Clôtures*) : chaque côté a son type (grillage, bois, mur, haie, ou ouvert pour un portail) et sa hauteur. Deux façons d'en créer une : *Clôturer d'après le cadastre* (les parcelles de la maison sont présélectionnées, clic pour ajouter ou retirer les parcelles voisines du même terrain ; le contour de l'ensemble est clôturé) ou *Tracer une clôture* (clics successifs, la vue « Dessus » est conseillée ; chaque côté prend le type choisi dans la palette, une couleur par type). *Modifier les côtés* : changer le type d'un côté d'un clic, couper un côté en deux (un morceau en mur, l'autre en grillage), supprimer un point.
- **Arrosage** (*Arrosage*) :
  - **Goutte-à-goutte** : une ligne par vanne (`switch`, `valve`, `input_boolean`), tracée point par point et arrondie au rendu ; tuyau noir, marron, vert ou masqué. Vanne ouverte, la ligne passe au bleu, des reflets y circulent, une goutte grossit puis rétrécit en boucle sous chaque goutteur (espacés de 30 cm par défaut, avec un léger décalage d'un goutteur à l'autre : la ligne scintille) et une tache humide grandit jusqu'à former une bande. La largeur de la tache suit le modèle de Schwartzman & Zur (1986), selon le débit du goutteur, la durée d'ouverture et le type de sol ; elle s'efface en 30 minutes après la fermeture.
  - **Arroseurs** : un circuit par vanne, avec un ou plusieurs arroseurs (modèle du catalogue : Hunter Pro-Spray PSU-04 8A à 17A, SRM-04, PGJ-04, PGP Ultra, MP Rotator, ou générique ; distances minimale / maximale, orientation et angle préremplis et modifiables ; *Viser* d'un clic). Vanne ouverte, le secteur arrosé estimé s'affiche et le jet est animé (balayage pour une turbine, éventail pour une tuyère).
  - *Tester l'animation* joue 30 secondes d'arrosage accéléré (30 s = 1 h 30) sur toutes les lignes et tous les circuits, sans ouvrir aucune vanne : la tache humide grandit, les jets tournent, puis tout revient à l'état réel. Le bouton *Tester* d'une ligne ou d'un circuit fait la même chose pour lui seul ; fermer l'éditeur arrête le test.
- **Autres outils** : objets extérieurs (masquer, hauteur, décalage, rotation), niveau de la piscine, arbres (supprimer, ajouter avec essence et hauteur, annuler, tout rétablir), corrections du sol (muret, terrasse, pinceaux, coupe, liste des corrections modifiables), vues.

## Configuration (⚙)

- **Plan** : *Importer un .sh3d* lit votre fichier Sweet Home 3D dans le navigateur et liste ce qui a été trouvé (niveaux, pièces, murs, lumières…).
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
| `/api/house_view/info` | état + position de Home Assistant | | |
| `/api/house_view/scene` | plan | remplace (admin) | |
| `/api/house_view/terrain` | grille de hauteurs | remplace (admin) | supprime (admin) |
| `/api/house_view/edits` | corrections | remplace (admin) | supprime (admin) |
| `/api/house_view/ortho` | photo / plan au sol | remplace (admin) | supprime (admin) |
| `/api/house_view/fetch` | état de la récupération | lance la récupération du terrain, `provider` : `auto` \| `ign` \| `world` (admin) | |
| `/api/house_view/github` | | `{"action": "backup" \| "restore"}` (admin) | |
| `/api/house_view/unlock` | `{locked, unlocked}` | `{"password"}` → jeton (admin) | reverrouille |

Quand un mot de passe d'édition est défini, les écritures (POST / DELETE ci-dessus) exigent en plus l'en-tête `X-House-View-Unlock` avec le jeton rendu par `/unlock` ; sinon elles répondent 423.

Chaque document est validé (`validate.py`) et conservé dans `.storage/house_view.<clé>` ; chaque écriture déclenche l'événement `house_view_updated` (`key`, `updated`). Les documents sont volumineux (un terrain fait plusieurs Mo) : ils passent en HTTP (limite Home Assistant de 16 Mo par requête), et non par le websocket.

## Développement et tests

```bash
pip install pre-commit
# (optionnel) cd card && npm install pour lancer le build et les tests à la main
pre-commit install            # ruff, prettier, vitest, traductions, pytest (100 % de couverture) ; pre-commit gère les dépendances des hooks
pre-commit run --all-files
```

- **Intégration** : `pytest` (vrai serveur HTTP de Home Assistant via `pytest-homeassistant-custom-component`, couverture de 100 % exigée).
- **Carte** : `cd card && npm test` (vitest) ; `npm run build` écrit `custom_components/house_view/frontend/house-view-card.js` ; `npm run format` (prettier).
- **Traductions** : `scripts/check_translations.py` vérifie que chaque langue de l'intégration (en, fr, it, de, es, pl, pt) et de la carte (`card/src/i18n.js`) a exactement les clés de l'anglais. Ce README existe dans les mêmes sept langues (`doc/<langue>/README.<langue>.md`).
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

## Licence

Code sous licence [MIT](../../LICENSE) © Elwinmage. L'icône et le logo (`assets/brand/`) sont des créations originales du projet, sous la même licence.

- **Bibliothèques incluses dans la carte compilée** : [three.js](https://threejs.org) (MIT), [Lit](https://lit.dev) (BSD-3-Clause) et [fflate](https://github.com/101arrowz/fflate) (MIT) ; leurs mentions de licence sont conservées à la fin du fichier compilé.
- **Données** : le dépôt ne contient aucune donnée cartographique ; chaque utilisateur télécharge celles de son terrain, et la source est rappelée dans ⚙ → *Terrain (MNT)*. En cas de publication d'une capture, mentionner cette source :
  - France : services de l'IGN (cartes.gouv.fr), sous [Licence Ouverte Etalab 2.0](https://www.etalab.gouv.fr/licence-ouverte-open-licence/) ;
  - relief hors de France : [Mapterhorn](https://mapterhorn.com/attribution) et les jeux de données ouverts qu'il assemble, ou les [Terrain Tiles](https://registry.opendata.aws/terrain-tiles) de Mapzen ;
  - bâtiments et routes hors de France : © les contributeurs d'[OpenStreetMap](https://www.openstreetmap.org/copyright), sous licence ODbL.
- Les noms de marques (Hunter, Roborock, Sweet Home 3D…) appartiennent à leurs propriétaires et ne sont cités que pour décrire la compatibilité.
