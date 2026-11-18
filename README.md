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
puis ouvrir ⚙ (administrateur) pour importer le plan `.sh3d` et un terrain `.json`.

La carte compilée n'est pas versionnée : `release.yml` la construit à chaque release et publie `house_view.zip`, que HACS
installe. En développement : `cd card && npm install && npm run build`.

## Carte : configuration

```yaml
type: custom:house-view-card
weather_entity: weather.maison        # météo en direct (optionnel)
mode: live                            # live (heure réelle) | simulation (curseurs heure / date / météo)
view: Vue générale                    # vue de départ (optionnel)
show_views: true                      # boutons des vues caméra
tap_action: toggle_lights             # clic sur une pièce : bascule les lumières de son area (ou none)
interactive: false                    # true = caméra orbitale libre
fps_cap: 30                           # limite d'images/s (écrans muraux, tablettes)
light_entities: [light.salon, ...]    # optionnel : restreint les lumières prises en compte
```

- **Latitude / longitude / fuseau** : lus dans la configuration de Home Assistant. Les saisons de la végétation
  s'inversent dans l'hémisphère sud.
- **Pièces ↔ areas** : une pièce du plan est liée à l'area HA de même nom (accents et casse ignorés). ⚙ liste les pièces
  sans area correspondante.
- **Lumières** : état, couleur et intensité des `light.*` de l'area de chaque pièce.
- **Météo** : l'état de `weather_entity` (`rainy`, `snowy`, `fog`…) + température, vent et nébulosité si fournis.
- **Performances** : le rendu s'arrête quand la carte n'est pas visible ; les volumes de lumière ne sont recalculés que
  si un état utile change.

## API HTTP (utilisée par la carte)

| Route | GET | POST | DELETE |
|---|---|---|---|
| `/api/house_view/info` | état + position HA | | |
| `/api/house_view/scene` | plan | remplace (admin) | |
| `/api/house_view/terrain` | grille de hauteurs | remplace (admin) | supprime (admin) |
| `/api/house_view/edits` | corrections | remplace (admin) | supprime (admin) |

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
- **CI** (`.github/workflows/`) : `validate.yml` (hassfest + HACS), `tests.yml` (pre-commit, pytest, vitest + build),
  `release.yml` (lancé à la main avec la version : met à jour `manifest.json` et `card/package.json`, compile la carte,
  tague, publie la release avec `house_view.zip`).

`card/src/engine.js` est le moteur 3D (une instance par carte, sans dépendance à HA) ; `card/src/ha-bridge.js` convertit
l'état de HA en données pour le moteur ; `card/src/engine/` reprend les modules du prototype (géométrie, végétation,
terrain, lumières…).

## Feuille de route

1. ✅ Phase 1 : intégration + carte, import du plan, terrain, calage, lumières et météo en direct.
2. Éditeurs dans la carte : objets extérieurs, arbres, corrections du sol (déjà faits dans le prototype), vues personnalisées.
3. Récupération du terrain côté intégration, par pays (IGN d'abord), à partir de `hass.config.latitude/longitude`.
4. Catalogue (arbres à 4 saisons, objets) géré par `catalog_editor`.
